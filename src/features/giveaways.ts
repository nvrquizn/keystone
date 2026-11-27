import { randomBytes } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  Events,
  MessageFlags,
  type Client,
  type Guild,
  type GuildMember,
  type TextChannel,
} from "discord.js";
import { readJson, updateJson } from "../storage/json-store.js";
import {
  DEFAULT_GIVEAWAYS,
  selectWinners,
  type GiveawayRecord,
  type GiveawaysFile,
} from "./giveaways-core.js";

const ENTER_PREFIX = "feral:giveaway:enter:";
const inProgress = new Set<string>();

function recordKey(guildId: string, id: string): string {
  return guildId + ":" + id;
}

export function giveawayUrl(record: GiveawayRecord): string {
  return "https://discord.com/channels/" +
    record.guildId + "/" + record.channelId + "/" + record.messageId;
}

export function giveawayEmbed(record: GiveawayRecord): EmbedBuilder {
  const endTime = Math.floor(record.endsAt / 1000);
  const running = record.status === "active" && Date.now() < record.endsAt;
  const statusText = record.status === "cancelled" ? "Cancelled"
    : record.status === "ended" ? "Ended"
    : running ? "Open for entries" : "Closing";
  const description = [
    record.description || "Join for a chance to win!",
    "",
    "**Hosted by:** <@" + record.creatorId + ">",
    "**Winners:** " + record.winnersCount,
    record.requiredRoleId ? "**Required role:** <@&" + record.requiredRoleId + ">" : "",
    "**Entries:** " + record.entries.length,
    "**Ends:** <t:" + endTime + ":F> (<t:" + endTime + ":R>)",
    "**Status:** " + statusText,
    record.status === "ended"
      ? "**Selected winner(s):** " + (record.winners.length
        ? record.winners.map(id => "<@" + id + ">").join(", ")
        : "No eligible entries")
      : "",
  ].filter(Boolean).join("\n");
  return new EmbedBuilder()
    .setColor(record.status === "cancelled" ? 0x8c8790 : record.status === "ended" ? 0x8cb6a5 : 0xd96a9a)
    .setTitle("🎉 FERAL Giveaway — " + record.prize)
    .setDescription(description)
    .setFooter({ text: "Giveaway ID: " + record.id + " • Prizes are distributed by event staff" })
    .setTimestamp(record.createdAt);
}

function components(record: GiveawayRecord): ActionRowBuilder<ButtonBuilder>[] {
  if (record.status !== "active" || Date.now() >= record.endsAt) return [];
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(ENTER_PREFIX + record.id)
        .setLabel("Enter / Leave Giveaway")
        .setStyle(ButtonStyle.Primary)
        .setEmoji("🎉"),
    ),
  ];
}

export async function getGiveaway(guildId: string, id: string): Promise<GiveawayRecord | null> {
  const data = await readJson<GiveawaysFile>("giveaways", DEFAULT_GIVEAWAYS);
  return data.guilds[guildId]?.[id] ??
    Object.values(data.guilds[guildId] ?? {}).find(record => record.messageId === id) ??
    null;
}

export async function listGiveaways(guildId: string): Promise<GiveawayRecord[]> {
  const data = await readJson<GiveawaysFile>("giveaways", DEFAULT_GIVEAWAYS);
  return Object.values(data.guilds[guildId] ?? {}).sort((a, b) => b.createdAt - a.createdAt);
}

export async function createGiveaway(params: {
  guild: Guild;
  channel: TextChannel;
  creatorId: string;
  prize: string;
  description?: string;
  durationMs: number;
  winnersCount: number;
  requiredRoleId?: string;
}): Promise<GiveawayRecord> {
  const active = (await listGiveaways(params.guild.id))
    .filter(record => record.status === "active" || record.status === "ending");
  if (active.length >= 30) throw new Error("FERAL already has 30 active giveaways. End or cancel one first.");

  const now = Date.now();
  const record: GiveawayRecord = {
    id: randomBytes(8).toString("hex"),
    guildId: params.guild.id,
    channelId: params.channel.id,
    messageId: "",
    creatorId: params.creatorId,
    prize: params.prize,
    description: params.description,
    requiredRoleId: params.requiredRoleId,
    winnersCount: params.winnersCount,
    createdAt: now,
    endsAt: now + params.durationMs,
    status: "active",
    entries: [],
    winners: [],
    pastWinners: [],
    announced: false,
  };

  const message = await params.channel.send({
    embeds: [giveawayEmbed(record)],
    components: components(record),
    allowedMentions: { parse: [] },
  });
  record.messageId = message.id;
  try {
    await updateJson<GiveawaysFile>("giveaways", DEFAULT_GIVEAWAYS, data => {
      data.guilds[params.guild.id] ??= {};
      data.guilds[params.guild.id]![record.id] = record;
    });
  } catch (error) {
    await message.delete().catch(() => undefined);
    throw error;
  }
  console.log("[giveaways] Created " + record.id + " by " + params.creatorId);
  return record;
}

async function editGiveawayMessage(guild: Guild, record: GiveawayRecord): Promise<void> {
  const channel = await guild.channels.fetch(record.channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) return;
  const message = await channel.messages.fetch(record.messageId).catch(() => null);
  if (!message) return;
  await message.edit({
    embeds: [giveawayEmbed(record)],
    components: components(record),
    allowedMentions: { parse: [] },
  });
}

/** Check selected winners still belong to the server and meet any role requirement. */
async function drawEligible(guild: Guild, record: GiveawayRecord, count: number, excluded: string[]): Promise<string[]> {
  const order = selectWinners(record.entries, record.entries.length, excluded);
  const winners: string[] = [];
  for (const userId of order.slice(0, 250)) {
    if (winners.length >= count) break;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member || member.user.bot) continue;
    if (record.requiredRoleId && !member.roles.cache.has(record.requiredRoleId)) continue;
    winners.push(userId);
  }
  return winners;
}

async function announceEnd(guild: Guild, record: GiveawayRecord): Promise<boolean> {
  const channel = await guild.channels.fetch(record.channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) return false;
  await editGiveawayMessage(guild, record).catch(error => {
    console.error("[giveaways] Could not edit giveaway announcement " + record.id, error);
  });
  const content = record.winners.length
    ? "🎉 **Giveaway ended — " + record.prize + "!**\nCongratulations " +
      record.winners.map(id => "<@" + id + ">").join(", ") +
      "!\n" + giveawayUrl(record) + "\nPlease contact event staff to arrange your prize."
    : "🎉 **Giveaway ended — " + record.prize +
      "**\nNo eligible entries were available.\n" + giveawayUrl(record);
  const announcement = await channel.send({
    content,
    allowedMentions: { users: record.winners, roles: [], parse: [] },
  });
  await updateJson<GiveawaysFile>("giveaways", DEFAULT_GIVEAWAYS, data => {
    const current = data.guilds[guild.id]?.[record.id];
    if (current && current.status === "ended" && !current.announced) {
      current.announced = true;
      current.announcementMessageId = announcement.id;
    }
  });
  return true;
}

/** End at the deadline or immediately when authorised staff requests it. */
export async function finishGiveaway(guild: Guild, id: string, force = false, actorId?: string): Promise<GiveawayRecord | null> {
  const existing = await getGiveaway(guild.id, id);
  if (!existing) return null;
  const key = recordKey(guild.id, existing.id);
  if (inProgress.has(key)) return null;
  inProgress.add(key);
  try {
    let record = existing;
    if (record.status === "active" && (force || record.endsAt <= Date.now())) {
      await updateJson<GiveawaysFile>("giveaways", DEFAULT_GIVEAWAYS, data => {
        const current = data.guilds[guild.id]?.[record.id];
        if (current?.status === "active" && (force || current.endsAt <= Date.now())) {
          current.status = "ending";
          if (actorId) current.closedBy = actorId;
        }
      });
      record = (await getGiveaway(guild.id, record.id))!;
    }
    if (record.status === "ending") {
      const winners = await drawEligible(guild, record, record.winnersCount, []);
      await updateJson<GiveawaysFile>("giveaways", DEFAULT_GIVEAWAYS, data => {
        const current = data.guilds[guild.id]?.[record.id];
        if (current?.status !== "ending") return;
        current.winners = winners;
        current.pastWinners = [...new Set([...current.pastWinners, ...winners])];
        current.status = "ended";
      });
      record = (await getGiveaway(guild.id, record.id))!;
    }
    if (record.status === "ended" && !record.announced) {
      try {
        await announceEnd(guild, record);
      } catch (error) {
        console.error("[giveaways] Could not announce giveaway end " + record.id, error);
      }
    }
    return await getGiveaway(guild.id, record.id);
  } finally {
    inProgress.delete(key);
  }
}

export async function cancelGiveaway(guild: Guild, id: string, actorId: string): Promise<GiveawayRecord | null> {
  const record = await getGiveaway(guild.id, id);
  if (!record || record.status !== "active") return null;
  const key = recordKey(guild.id, record.id);
  if (inProgress.has(key)) return null;
  inProgress.add(key);
  try {
    let cancelled = false;
    await updateJson<GiveawaysFile>("giveaways", DEFAULT_GIVEAWAYS, data => {
      const current = data.guilds[guild.id]?.[record.id];
      if (!current || current.status !== "active") return;
      current.status = "cancelled";
      current.closedBy = actorId;
      cancelled = true;
    });
    if (!cancelled) return null;
    const result = (await getGiveaway(guild.id, record.id))!;
    await editGiveawayMessage(guild, result).catch(error =>
      console.error("[giveaways] Could not update cancelled message:", error));
    return result;
  } finally {
    inProgress.delete(key);
  }
}

export async function rerollGiveaway(guild: Guild, id: string, count: number, actorId: string): Promise<GiveawayRecord | null> {
  const record = await getGiveaway(guild.id, id);
  if (!record || record.status !== "ended" || !record.announced) return null;
  const key = recordKey(guild.id, record.id);
  if (inProgress.has(key)) return null;
  inProgress.add(key);
  try {
    const replacements = await drawEligible(guild, record, count, record.pastWinners);
    if (!replacements.length) throw new Error("No new eligible entrants remain to reroll.");
    await updateJson<GiveawaysFile>("giveaways", DEFAULT_GIVEAWAYS, data => {
      const current = data.guilds[guild.id]?.[record.id];
      if (!current || current.status !== "ended") return;
      current.winners = replacements;
      current.pastWinners = [...new Set([...current.pastWinners, ...replacements])];
      current.lastRerollAt = Date.now();
      current.closedBy = actorId;
    });
    const result = (await getGiveaway(guild.id, record.id))!;
    await editGiveawayMessage(guild, result).catch(error =>
      console.error("[giveaways] Could not update rerolled message:", error));
    const channel = await guild.channels.fetch(record.channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
      throw new Error("Reroll saved, but the giveaway channel is no longer accessible.");
    }
    await channel.send({
      content: "🎉 **Giveaway reroll — " + record.prize + "**\nNew winner(s): " +
        replacements.map(userId => "<@" + userId + ">").join(", ") +
        "\n" + giveawayUrl(record) + "\nPlease contact event staff to arrange your prize.",
      allowedMentions: { users: replacements, roles: [], parse: [] },
    });
    return result;
  } finally {
    inProgress.delete(key);
  }
}

async function giveawayWorker(client: Client): Promise<void> {
  const data = await readJson<GiveawaysFile>("giveaways", DEFAULT_GIVEAWAYS);
  for (const [guildId, records] of Object.entries(data.guilds)) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    for (const record of Object.values(records)) {
      const due = record.status === "active" && record.endsAt <= Date.now();
      if (due || record.status === "ending" || (record.status === "ended" && !record.announced)) {
        await finishGiveaway(guild, record.id).catch(error =>
          console.error("[giveaways] Worker failed on " + record.id, error));
      }
    }
  }
}

export function registerGiveaways(client: Client): void {
  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isButton() || !interaction.customId.startsWith(ENTER_PREFIX) ||
        !interaction.inCachedGuild()) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => undefined);
    if (!interaction.deferred) return;
    try {
      const id = interaction.customId.slice(ENTER_PREFIX.length);
      const record = await getGiveaway(interaction.guildId, id);
      if (!record || record.messageId !== interaction.message.id || record.channelId !== interaction.channelId) {
        await interaction.editReply("This giveaway is no longer available.");
        return;
      }
      const member = interaction.member as GuildMember;
      if (member.user.bot) {
        await interaction.editReply("Bots cannot enter giveaways.");
        return;
      }
      if (record.requiredRoleId && !member.roles.cache.has(record.requiredRoleId)) {
        await interaction.editReply("You need <@&" + record.requiredRoleId + "> to enter this giveaway.");
        return;
      }
      let response = "";
      await updateJson<GiveawaysFile>("giveaways", DEFAULT_GIVEAWAYS, data => {
        const current = data.guilds[interaction.guildId]?.[id];
        if (!current || current.status !== "active" || current.endsAt <= Date.now()) {
          response = "This giveaway has already closed.";
          return;
        }
        if (current.entries.includes(interaction.user.id)) {
          current.entries = current.entries.filter(userId => userId !== interaction.user.id);
          response = "You have left the giveaway. Your entry was removed.";
        } else {
          current.entries.push(interaction.user.id);
          response = "You're entered! Good luck! 🎉";
        }
      });
      await interaction.editReply({ content: response, allowedMentions: { parse: [] } });
    } catch (error) {
      console.error("[giveaways] Entry interaction failed:", error);
      await interaction.editReply("Could not update your giveaway entry. Please try again.").catch(() => undefined);
    }
  });

  client.once(Events.ClientReady, () => {
    void giveawayWorker(client).catch(error => console.error("[giveaways] Startup worker failed:", error));
    setInterval(() => {
      void giveawayWorker(client).catch(error => console.error("[giveaways] Worker failed:", error));
    }, 30_000).unref();
  });
}
