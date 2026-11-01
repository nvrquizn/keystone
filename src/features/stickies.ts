import { EmbedBuilder, type Client, type Guild, type Message, type TextBasedChannel } from "discord.js";
import { DEFAULT_STICKIES, type StickyRecord, type StickiesFile } from "../storage/schema.js";
import { readJson, updateJson } from "../storage/json-store.js";

const debounce = new Map<string, NodeJS.Timeout>();
const reposting = new Set<string>();
const ignoredDeletes = new Set<string>();

function channelKey(guildId: string, channelId: string): string {
  return `${guildId}:${channelId}`;
}

function stickyPayload(sticky: StickyRecord) {
  if (!sticky.title && !sticky.color) return { content: sticky.content ?? "" };
  const color = Number.parseInt((sticky.color ?? "#7F9A8C").replace("#", ""), 16);
  const embed = new EmbedBuilder().setColor(Number.isFinite(color) ? color : 0x7f9a8c).setDescription(sticky.content ?? "");
  if (sticky.title) embed.setTitle(sticky.title);
  return { embeds: [embed] };
}

async function deleteStickyMessage(channel: TextBasedChannel, messageId?: string): Promise<void> {
  if (!messageId || channel.isDMBased()) return;
  const old = await channel.messages.fetch(messageId).catch(() => null);
  if (!old) return;

  // Deleting our own sticky emits messageDelete. Mark it so the delete handler
  // knows this was intentional and does not schedule another repost.
  ignoredDeletes.add(old.id);
  const deleted = await old.delete().then(() => true).catch(() => false);
  if (!deleted) ignoredDeletes.delete(old.id);
}

async function repost(guildId: string, channel: TextBasedChannel): Promise<void> {
  if (channel.isDMBased()) return;
  const key = channelKey(guildId, channel.id);

  // Prevent overlapping reposts in the same channel.
  if (reposting.has(key)) return;
  reposting.add(key);

  try {
    const file = await readJson<StickiesFile>("stickies", DEFAULT_STICKIES);
    const sticky = file.guilds[guildId]?.[channel.id];
    if (!sticky) return;

    await deleteStickyMessage(channel, sticky.messageId);

    const sent = await channel.send(stickyPayload(sticky));
    await updateJson<StickiesFile>("stickies", DEFAULT_STICKIES, data => {
      data.guilds[guildId] ??= {};
      const current = data.guilds[guildId]![channel.id];
      if (current) current.messageId = sent.id;
    });
  } finally {
    reposting.delete(key);
  }
}

export async function setSticky(guild: Guild, channel: TextBasedChannel, input: Pick<StickyRecord, "content" | "title" | "color">): Promise<void> {
  await updateJson<StickiesFile>("stickies", DEFAULT_STICKIES, data => {
    data.guilds[guild.id] ??= {};
    const existingMessageId = data.guilds[guild.id]![channel.id]?.messageId;
    data.guilds[guild.id]![channel.id] = { channelId: channel.id, messageId: existingMessageId, ...input };
  });
  await repost(guild.id, channel);
}

export async function removeSticky(guildId: string, channelId: string, channel?: TextBasedChannel): Promise<void> {
  const key = channelKey(guildId, channelId);
  const timer = debounce.get(key);
  if (timer) {
    clearTimeout(timer);
    debounce.delete(key);
  }

  const file = await readJson<StickiesFile>("stickies", DEFAULT_STICKIES);
  const existing = file.guilds[guildId]?.[channelId];

  // Remove the configuration first, so even if a delete event arrives before
  // ignoredDeletes is checked there is no configured sticky to resurrect.
  await updateJson<StickiesFile>("stickies", DEFAULT_STICKIES, data => {
    if (data.guilds[guildId]) delete data.guilds[guildId]![channelId];
  });

  if (existing?.messageId && channel && !channel.isDMBased()) {
    await deleteStickyMessage(channel, existing.messageId);
  }
}

export async function showSticky(guildId: string, channelId: string): Promise<StickyRecord | undefined> {
  const file = await readJson<StickiesFile>("stickies", DEFAULT_STICKIES);
  return file.guilds[guildId]?.[channelId];
}

export function registerStickyEvents(client: Client): void {
  client.on("messageCreate", async (message: Message) => {
    if (!message.guild || message.author.bot || !message.channel.isTextBased()) return;
    const file = await readJson<StickiesFile>("stickies", DEFAULT_STICKIES);
    if (!file.guilds[message.guild.id]?.[message.channelId]) return;

    const key = channelKey(message.guild.id, message.channelId);
    const current = debounce.get(key);
    if (current) clearTimeout(current);

    debounce.set(key, setTimeout(() => {
      debounce.delete(key);
      void repost(message.guild!.id, message.channel);
    }, 1500));
  });

  client.on("messageDelete", async message => {
    if (!message.guild || !message.channel.isTextBased()) return;

    // Ignore deletions Keystone intentionally caused while moving/removing a sticky.
    if (ignoredDeletes.delete(message.id)) return;

    const key = channelKey(message.guild.id, message.channelId);
    if (reposting.has(key)) return;

    const file = await readJson<StickiesFile>("stickies", DEFAULT_STICKIES);
    const sticky = file.guilds[message.guild.id]?.[message.channelId];
    if (sticky?.messageId !== message.id) return;

    setTimeout(() => {
      void repost(message.guild!.id, message.channel);
    }, 1000);
  });
}
