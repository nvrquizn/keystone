import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  Guild,
  GuildMember,
  PermissionFlagsBits,
  type VoiceBasedChannel,
  type VoiceState,
} from "discord.js";
import {
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
  joinVoiceChannel,
  type VoiceConnection,
} from "@discordjs/voice";
import { createRequire } from "node:module";

const OpusScript = createRequire(import.meta.url)("opusscript");
import {
  VC_RETENTION_MS,
  cleanupExpiredVoiceSessions,
  deleteVoiceSession,
  getGuildVoiceSettings,
  getVoiceSession,
  listVoiceSessions,
  markInterruptedVoiceSessions,
  saveVoiceSession,
  updateGuildVoiceSettings,
  type VoiceTranscriptEntry,
  type VoiceTranscriptSessionRecord,
} from "./store.js";

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 2;
const MAX_CHUNK_SECONDS = 30;
const MIN_AUDIO_MS = 250;
const DEEPGRAM_ENDPOINT = "https://api.deepgram.com/v1/listen";

interface RuntimeSession {
  record: VoiceTranscriptSessionRecord;
  connection: VoiceConnection;
  pending: Set<Promise<void>>;
  notified: Set<string>;
  closing: boolean;
}

const sessions = new Map<string, RuntimeSession>();
let clientRef: Client | null = null;

function sessionKey(guildId: string, channelId: string): string {
  return `${guildId}:${channelId}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeSessionId(): string {
  return `vc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function humanMembers(channel: VoiceBasedChannel): GuildMember[] {
  return [...channel.members.values()].filter(member => !member.user.bot);
}

function wavFromPcm(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE;
  const blockAlign = CHANNELS * BYTES_PER_SAMPLE;

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

async function transcribeWav(wav: Buffer): Promise<string> {
  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
  if (!apiKey) throw new Error("DEEPGRAM_API_KEY is not configured.");

  const model = process.env.VC_TRANSCRIBE_MODEL?.trim() || "nova-3";
  const language = process.env.VC_TRANSCRIBE_LANGUAGE?.trim() || "multi";
  const params = new URLSearchParams({
    model,
    language,
    smart_format: "true",
    mip_opt_out: "true",
  });

  const response = await fetch(`${DEEPGRAM_ENDPOINT}?${params.toString()}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "audio/wav",
    },
    body: Uint8Array.from(wav),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Deepgram transcription returned ${response.status}: ${body.slice(0, 300)}`);
  }

  const payload = await response.json() as {
    results?: {
      channels?: Array<{
        alternatives?: Array<{ transcript?: string }>;
      }>;
    };
  };
  return payload.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
}

function upsertParticipant(record: VoiceTranscriptSessionRecord, member: GuildMember): void {
  const displayName = member.displayName || member.user.username;
  const found = record.participants.find(p => p.id === member.id);
  if (found) {
    found.displayName = displayName;
  } else {
    record.participants.push({ id: member.id, displayName });
  }
}

async function notifyParticipant(runtime: RuntimeSession, member: GuildMember): Promise<void> {
  if (runtime.notified.has(member.id) || member.user.bot) return;
  runtime.notified.add(member.id);
  upsertParticipant(runtime.record, member);
  saveVoiceSession(runtime.record);

  const message =
    `🎙️ **Voice transcription is active in #${runtime.record.channelName}.**\n` +
    "Keystone is transcribing this voice session for moderation. Raw audio is not retained after speech-to-text processing. " +
    "The text transcript is kept temporarily for up to 8 hours unless staff preserves it. Machine transcription may contain errors.";

  await member.send(message).catch(() => null);
}

async function sendChannelNotice(channel: VoiceBasedChannel, runtime: RuntimeSession): Promise<void> {
  const maybeSendable = channel as unknown as {
    send?: (payload: unknown) => Promise<unknown>;
  };
  if (typeof maybeSendable.send !== "function") return;

  await maybeSendable.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0x78909c)
        .setTitle("Voice transcription active")
        .setDescription(
          "Keystone is transcribing this voice session for moderation. Raw audio is discarded after speech-to-text processing. " +
          "The text transcript will be available to staff for up to 8 hours unless preserved. Machine transcription may contain errors.",
        )
        .addFields({ name: "Session", value: runtime.record.id })
        .setTimestamp(),
    ],
  }).catch(() => null);
}

async function sendLogEmbed(guild: Guild, embed: EmbedBuilder): Promise<void> {
  const settings = getGuildVoiceSettings(guild.id);
  if (!settings.logChannelId) return;
  const channel = await guild.channels.fetch(settings.logChannelId).catch(() => null);
  if (!channel || !channel.isTextBased() || !("send" in channel)) return;
  await channel.send({ embeds: [embed] }).catch(() => null);
}

async function postReviewCard(runtime: RuntimeSession): Promise<void> {
  const guild = clientRef?.guilds.cache.get(runtime.record.guildId);
  if (!guild) return;
  const settings = getGuildVoiceSettings(guild.id);
  if (!settings.logChannelId) return;

  const channel = await guild.channels.fetch(settings.logChannelId).catch(() => null);
  if (!channel || !channel.isTextBased() || !("send" in channel)) return;

  const record = runtime.record;
  const participants = record.participants.length
    ? record.participants.map(p => p.displayName).join(", ").slice(0, 1024)
    : "None recorded";
  const expiresUnix = record.expiresAt ? Math.floor(Date.parse(record.expiresAt) / 1000) : null;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`vc_view:${record.id}`).setLabel("View Transcript").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`vc_keep:${record.id}`).setLabel("Keep").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`vc_delete:${record.id}`).setLabel("Delete Now").setStyle(ButtonStyle.Danger),
  );

  const message = await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0x78909c)
        .setTitle(`VC session ended — ${record.channelName}`)
        .addFields(
          { name: "Session", value: record.id },
          { name: "Participants", value: participants },
          { name: "Transcript lines", value: String(record.entries.length), inline: true },
          { name: "Started", value: `<t:${Math.floor(Date.parse(record.startedAt) / 1000)}:F>`, inline: true },
          { name: "Ended", value: record.endedAt ? `<t:${Math.floor(Date.parse(record.endedAt) / 1000)}:F>` : "Unknown", inline: true },
          { name: "Temporary retention", value: expiresUnix ? `Expires <t:${expiresUnix}:R> unless staff keeps it.` : "Kept permanently." },
        )
        .setFooter({ text: "Machine-generated transcript; verify context before moderation." })
        .setTimestamp(),
    ],
    components: [row],
  });

  record.logChannelId = channel.id;
  record.logMessageId = message.id;
  saveVoiceSession(record);
}

function transcriptText(record: VoiceTranscriptSessionRecord): string {
  const lines = [
    `Keystone Voice Transcript`,
    `Session: ${record.id}`,
    `Channel: ${record.channelName} (${record.channelId})`,
    `Started: ${record.startedAt}`,
    `Ended: ${record.endedAt ?? "Still active/unknown"}`,
    `Reason: ${record.reason ?? "Automatic moderation transcript"}`,
    `Participants: ${record.participants.map(p => `${p.displayName} (${p.id})`).join(", ") || "None recorded"}`,
    "",
    "Machine-generated transcript. Speech recognition can contain errors; verify context before moderation.",
    "",
  ];

  for (const entry of [...record.entries].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    lines.push(`[${entry.at}] ${entry.displayName} (${entry.userId}): ${entry.text}`);
  }

  if (!record.entries.length) lines.push("[No speech was transcribed during this session.]");
  return lines.join("\n");
}

async function editReviewStatus(record: VoiceTranscriptSessionRecord, status: string): Promise<void> {
  if (!clientRef || !record.logChannelId || !record.logMessageId) return;
  const channel = await clientRef.channels.fetch(record.logChannelId).catch(() => null);
  if (!channel || !channel.isTextBased() || !("messages" in channel)) return;
  const message = await channel.messages.fetch(record.logMessageId).catch(() => null);
  if (!message) return;

  const embed = EmbedBuilder.from(message.embeds[0] ?? new EmbedBuilder())
    .setColor(status === "Kept" ? 0x66bb6a : 0x78909c)
    .addFields({ name: "Review status", value: status })
    .setTimestamp();

  await message.edit({ embeds: [embed], components: [] }).catch(() => null);
}

function queueTranscriptChunk(
  runtime: RuntimeSession,
  member: GuildMember,
  pcm: Buffer,
  spokenAt: number,
): void {
  const durationMs = pcm.length / (SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE) * 1000;
  if (durationMs < MIN_AUDIO_MS) return;

  const job = (async () => {
    try {
      const text = await transcribeWav(wavFromPcm(pcm));
      if (!text || runtime.closing && !getVoiceSession(runtime.record.id)) return;

      const entry: VoiceTranscriptEntry = {
        at: new Date(spokenAt).toISOString(),
        userId: member.id,
        displayName: member.displayName || member.user.username,
        text,
      };
      runtime.record.entries.push(entry);
      upsertParticipant(runtime.record, member);
      saveVoiceSession(runtime.record);
    } catch (error) {
      console.error(`[VC transcript ${runtime.record.id}] transcription failed:`, error);
    }
  })();

  runtime.pending.add(job);
  void job.finally(() => runtime.pending.delete(job));
}

function subscribeSpeaker(runtime: RuntimeSession, guild: Guild, userId: string): void {
  if (runtime.closing) return;
  const member = guild.members.cache.get(userId);
  if (!member || member.user.bot) return;

  upsertParticipant(runtime.record, member);
  saveVoiceSession(runtime.record);

  const stream = runtime.connection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
  });

  const decoder = new OpusScript(SAMPLE_RATE, CHANNELS, OpusScript.Application.AUDIO);
  let buffers: Buffer[] = [];
  let bytes = 0;
  let chunkStartedAt = Date.now();
  const maxBytes = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE * MAX_CHUNK_SECONDS;

  const flush = (): void => {
    if (!bytes) return;
    const pcm = Buffer.concat(buffers, bytes);
    const started = chunkStartedAt;
    buffers = [];
    bytes = 0;
    chunkStartedAt = Date.now();
    queueTranscriptChunk(runtime, member, pcm, started);
  };

  stream.on("data", (packet: Buffer) => {
    try {
      const decoded = Buffer.from(decoder.decode(packet));
      if (!bytes) chunkStartedAt = Date.now();
      buffers.push(decoded);
      bytes += decoded.length;
      if (bytes >= maxBytes) flush();
    } catch (error) {
      console.error(`[VC transcript ${runtime.record.id}] Opus decode failed:`, error);
    }
  });

  stream.once("end", () => {
    flush();
    try { decoder.delete(); } catch { /* no-op */ }
  });

  stream.once("error", (error: Error) => {
    console.error(`[VC transcript ${runtime.record.id}] receive stream failed:`, error);
    flush();
    try { decoder.delete(); } catch { /* no-op */ }
  });
}

export async function startVoiceTranscript(
  channel: VoiceBasedChannel,
  options: { auto: boolean; startedBy?: string | null; reason?: string | null },
): Promise<VoiceTranscriptSessionRecord> {
  if (!clientRef) throw new Error("Voice transcript runtime has not been registered yet.");
  if (!process.env.DEEPGRAM_API_KEY?.trim()) {
    throw new Error("DEEPGRAM_API_KEY is not configured. Add it to Railway variables before starting voice transcription.");
  }

  const key = sessionKey(channel.guild.id, channel.id);
  const existing = sessions.get(key);
  if (existing) return existing.record;

  const settings = getGuildVoiceSettings(channel.guild.id);
  if (!settings.logChannelId) {
    throw new Error("No VC transcript log channel is configured. Use /vctranscript set-log first.");
  }

  const record: VoiceTranscriptSessionRecord = {
    id: makeSessionId(),
    guildId: channel.guild.id,
    channelId: channel.id,
    channelName: channel.name,
    startedAt: nowIso(),
    endedAt: null,
    expiresAt: null,
    keptAt: null,
    startedBy: options.startedBy ?? null,
    auto: options.auto,
    reason: options.reason ?? null,
    participants: [],
    entries: [],
    logChannelId: null,
    logMessageId: null,
  };

  for (const member of humanMembers(channel)) upsertParticipant(record, member);
  saveVoiceSession(record);

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: true,
    group: `keystone-transcript-${channel.id}`,
  });

  const runtime: RuntimeSession = {
    record,
    connection,
    pending: new Set(),
    notified: new Set(),
    closing: false,
  };
  sessions.set(key, runtime);

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  } catch (error) {
    sessions.delete(key);
    connection.destroy();
    deleteVoiceSession(record.id);
    throw new Error(`Keystone could not join ${channel.name}: ${error instanceof Error ? error.message : String(error)}`);
  }

  connection.receiver.speaking.on("start", userId => subscribeSpeaker(runtime, channel.guild, userId));

  connection.on("error", error => {
    console.error(`[VC transcript ${record.id}] voice connection error:`, error);
  });

  await sendChannelNotice(channel, runtime);
  for (const member of humanMembers(channel)) await notifyParticipant(runtime, member);

  await sendLogEmbed(
    channel.guild,
    new EmbedBuilder()
      .setColor(0x78909c)
      .setTitle("VC transcription started")
      .addFields(
        { name: "Channel", value: `${channel}` },
        { name: "Session", value: record.id },
        { name: "Mode", value: record.auto ? "Automatic" : "Manual", inline: true },
        { name: "Reason", value: record.reason ?? "Moderation coverage", inline: true },
      )
      .setTimestamp(),
  );

  return record;
}

export async function stopVoiceTranscript(
  guildId: string,
  channelId: string,
): Promise<VoiceTranscriptSessionRecord | null> {
  const key = sessionKey(guildId, channelId);
  const runtime = sessions.get(key);
  if (!runtime || runtime.closing) return runtime?.record ?? null;
  runtime.closing = true;

  runtime.connection.destroy();

  // Give receive streams a moment to flush their final PCM chunk, then
  // drain transcription jobs until no late jobs remain.
  await new Promise(resolve => setTimeout(resolve, 150));
  while (runtime.pending.size) {
    await Promise.allSettled([...runtime.pending]);
  }

  runtime.record.endedAt = nowIso();
  runtime.record.expiresAt = new Date(Date.now() + VC_RETENTION_MS).toISOString();
  saveVoiceSession(runtime.record);
  sessions.delete(key);
  await postReviewCard(runtime);
  return runtime.record;
}

export function activeVoiceTranscript(guildId: string, channelId: string): VoiceTranscriptSessionRecord | null {
  return sessions.get(sessionKey(guildId, channelId))?.record ?? null;
}

export function configureVoiceLogChannel(guildId: string, channelId: string): void {
  updateGuildVoiceSettings(guildId, current => ({ ...current, logChannelId: channelId }));
}

export async function configureAutoTranscript(
  guild: Guild,
  voiceChannelId: string,
  enabled: boolean,
  actorId: string,
): Promise<void> {
  updateGuildVoiceSettings(guild.id, current => ({
    ...current,
    autoChannelIds: enabled
      ? [...new Set([...current.autoChannelIds, voiceChannelId])]
      : current.autoChannelIds.filter(id => id !== voiceChannelId),
  }));

  const channel = guild.channels.cache.get(voiceChannelId);
  await sendLogEmbed(
    guild,
    new EmbedBuilder()
      .setColor(0x78909c)
      .setTitle(`Automatic VC transcription ${enabled ? "enabled" : "disabled"}`)
      .addFields(
        { name: "Channel", value: channel ? `${channel}` : voiceChannelId },
        { name: "Changed by", value: `<@${actorId}> (${actorId})` },
        { name: "Note", value: enabled ? "Future voice sessions will start transcription automatically." : "Future voice sessions will not start automatically. Any active session continues until stopped or the VC empties." },
      )
      .setTimestamp(),
  );
}

export function isAutoTranscriptEnabled(guildId: string, channelId: string): boolean {
  return getGuildVoiceSettings(guildId).autoChannelIds.includes(channelId);
}

export function getVoiceLogChannelId(guildId: string): string | null {
  return getGuildVoiceSettings(guildId).logChannelId;
}

export function recentVoiceSessions(guildId: string): VoiceTranscriptSessionRecord[] {
  return listVoiceSessions(guildId);
}

export function renderVoiceTranscript(id: string): string | null {
  const record = getVoiceSession(id);
  return record ? transcriptText(record) : null;
}

export async function keepVoiceTranscript(id: string): Promise<VoiceTranscriptSessionRecord | null> {
  const record = getVoiceSession(id);
  if (!record) return null;
  record.keptAt = nowIso();
  record.expiresAt = null;
  saveVoiceSession(record);
  await editReviewStatus(record, "Kept");
  return record;
}

export async function removeVoiceTranscript(id: string): Promise<boolean> {
  const record = getVoiceSession(id);
  if (!record) return false;
  await editReviewStatus(record, "Deleted");
  return deleteVoiceSession(id);
}

function hasTranscriptStaffPermission(memberPermissions: Readonly<{ has: (permission: bigint) => boolean }> | null): boolean {
  if (!memberPermissions) return false;
  return (
    memberPermissions.has(PermissionFlagsBits.Administrator) ||
    memberPermissions.has(PermissionFlagsBits.ModerateMembers) ||
    memberPermissions.has(PermissionFlagsBits.ManageGuild)
  );
}

async function handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
  const oldChannel = oldState.channel;
  const newChannel = newState.channel;

  if (newChannel && !newState.member?.user.bot) {
    const runtime = sessions.get(sessionKey(newState.guild.id, newChannel.id));
    if (runtime) await notifyParticipant(runtime, newState.member!);

    if (!runtime && isAutoTranscriptEnabled(newState.guild.id, newChannel.id) && humanMembers(newChannel).length === 1) {
      try {
        await startVoiceTranscript(newChannel, { auto: true, reason: "Automatic moderation coverage" });
      } catch (error) {
        console.error(`Could not auto-start VC transcription in ${newChannel.id}:`, error);
        await sendLogEmbed(
          newState.guild,
          new EmbedBuilder()
            .setColor(0xe53935)
            .setTitle("VC transcription failed to start")
            .addFields(
              { name: "Channel", value: `${newChannel}` },
              { name: "Error", value: (error instanceof Error ? error.message : String(error)).slice(0, 1024) },
            )
            .setTimestamp(),
        );
      }
    }
  }

  if (oldChannel && !oldState.member?.user.bot && oldChannel.id !== newChannel?.id) {
    const runtime = sessions.get(sessionKey(oldState.guild.id, oldChannel.id));
    if (runtime) {
      setTimeout(() => {
        const current = sessions.get(sessionKey(oldState.guild.id, oldChannel.id));
        if (!current) return;
        if (humanMembers(oldChannel).length === 0) {
          void stopVoiceTranscript(oldState.guild.id, oldChannel.id).catch(error =>
            console.error(`Could not stop empty VC transcription ${oldChannel.id}:`, error),
          );
        }
      }, 2000);
    }
  }
}

export function registerVoiceTranscripts(client: Client): void {
  clientRef = client;
  cleanupExpiredVoiceSessions();

  client.once(Events.ClientReady, readyClient => {
    void (async () => {
      for (const guild of readyClient.guilds.cache.values()) {
        const recovered = markInterruptedVoiceSessions(guild.id);
        if (recovered.length) {
          console.log(`Marked ${recovered.length} interrupted VC transcript(s) for 8-hour review in ${guild.name}.`);
        }

        const settings = getGuildVoiceSettings(guild.id);
        for (const channelId of settings.autoChannelIds) {
          const channel = await guild.channels.fetch(channelId).catch(() => null);
          if (!channel || channel.type !== ChannelType.GuildVoice) continue;
          if (humanMembers(channel).length === 0) continue;
          try {
            await startVoiceTranscript(channel, { auto: true, reason: "Automatic moderation coverage after restart" });
          } catch (error) {
            console.error(`Could not restore auto VC transcription in ${channelId}:`, error);
          }
        }
      }
    })();
  });

  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    void handleVoiceStateUpdate(oldState, newState);
  });

  client.on(Events.InteractionCreate, interaction => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith("vc_")) return;
    if (!hasTranscriptStaffPermission(interaction.memberPermissions)) {
      void interaction.reply({ content: "You do not have permission to review VC transcripts.", ephemeral: true });
      return;
    }

    const [action, id] = interaction.customId.split(":", 2);
    if (!id) return;

    if (action === "vc_view") {
      const text = renderVoiceTranscript(id);
      if (!text) {
        void interaction.reply({ content: "That transcript has expired or was deleted.", ephemeral: true });
        return;
      }
      const file = new AttachmentBuilder(Buffer.from(text, "utf8"), { name: `${id}.txt` });
      void interaction.reply({ content: `Transcript **${id}**`, files: [file], ephemeral: true });
      return;
    }

    if (action === "vc_keep") {
      void keepVoiceTranscript(id).then(record => interaction.reply({
        content: record ? `Kept transcript **${id}** permanently.` : "That transcript has already expired or been deleted.",
        ephemeral: true,
      }));
      return;
    }

    if (action === "vc_delete") {
      void removeVoiceTranscript(id).then(deleted => interaction.reply({
        content: deleted ? `Deleted transcript **${id}**.` : "That transcript has already expired or been deleted.",
        ephemeral: true,
      }));
    }
  });

  const cleanupTimer = setInterval(() => {
    const deleted = cleanupExpiredVoiceSessions();
    if (deleted.length) console.log(`Expired ${deleted.length} temporary VC transcript(s).`);
  }, 10 * 60 * 1000);
  cleanupTimer.unref();
}
