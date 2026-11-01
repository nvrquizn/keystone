import {
  EmbedBuilder,
  Events,
  type Client,
  type Guild,
  type GuildMember,
  type Message,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from "discord.js";
import { DEFAULT_LEVELS, type LevelsFile, type LevelRecord, type LevelTier } from "../storage/schema.js";
import { updateJson } from "../storage/json-store.js";
import { getGuildSettings } from "../storage/settings.js";

const MESSAGE_WINDOW_MS = 60_000;
const MESSAGE_WINDOW_XP_CAP = 45;
const DUPLICATE_WINDOW_MS = 30 * 60_000;
const REACTION_COOLDOWN_MS = 30_000;
const REACTION_MESSAGE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const REACTION_XP = 2;
const VOICE_XP = 10;
const VOICE_AWARD_MINUTES = 5;

const voiceMinutes = new Map<string, number>();

export function xpForNextLevel(level: number): number {
  return 3 * level * level + 35 * level + 80;
}

export function totalXpForLevel(level: number): number {
  let total = 0;
  for (let current = 0; current < Math.max(0, level); current++) total += xpForNextLevel(current);
  return total;
}

export function levelForXp(xp: number): number {
  const safeXp = Math.max(0, Math.floor(xp));
  let level = 0;
  let threshold = xpForNextLevel(0);
  let spent = 0;
  while (spent + threshold <= safeXp) {
    spent += threshold;
    level += 1;
    threshold = xpForNextLevel(level);
  }
  return level;
}

/** Calendar week key using Monday 00:00 UTC. */
export function currentWeekKey(now = Date.now()): string {
  const d = new Date(now);
  const day = d.getUTCDay();
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diffToMonday));
  return monday.toISOString().slice(0, 10);
}

export function currentWeeklyXp(record: LevelRecord, now = Date.now()): number {
  return record.weekKey === currentWeekKey(now) ? (record.weeklyXp ?? 0) : 0;
}

function addXpToRecord(record: LevelRecord, amount: number, now: number): void {
  if (amount <= 0) return;
  const key = currentWeekKey(now);
  if (record.weekKey !== key) {
    record.weekKey = key;
    record.weeklyXp = 0;
  }
  record.xp = Math.max(0, record.xp + amount);
  record.weeklyXp = (record.weeklyXp ?? 0) + amount;
  record.level = levelForXp(record.xp);
}

async function syncTier(member: GuildMember, tiers: LevelTier[], level: number): Promise<LevelTier | undefined> {
  const sorted = [...tiers].sort((a, b) => a.level - b.level);
  const earnedTiers = sorted.filter(t => level >= t.level);
  for (const tier of earnedTiers) {
    if (!member.roles.cache.has(tier.roleId)) await member.roles.add(tier.roleId).catch(() => undefined);
  }
  return earnedTiers.at(-1);
}

function normalizeMessage(message: Message): string {
  const content = message.content
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/<a?:\w+:\d+>/g, "<emoji>")
    .replace(/\s+/g, " ")
    .trim();
  const attachments = [...message.attachments.values()].map(a => a.name ?? a.id).sort().join("|");
  const stickers = [...message.stickers.values()].map(s => s.id).sort().join("|");
  return `${content}::a=${attachments}::s=${stickers}`;
}

function looksLikeSpam(message: Message): boolean {
  const compact = message.content.replace(/\s+/g, "").toLowerCase();
  if (!compact && !message.attachments.size && !message.stickers.size) return true;
  if (compact.length >= 8 && /(.)\1{7,}/u.test(compact)) return true;
  if (compact.length >= 10 && new Set(compact).size <= 2) return true;
  const words = message.content.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (words.length >= 4 && new Set(words).size === 1) return true;
  return false;
}

function messageXp(message: Message, min: number, max: number): number {
  const meaningfulLength = message.content.trim().length || (message.attachments.size || message.stickers.size ? 1 : 0);
  const bonus = Math.min(Math.max(0, max - min), Math.floor(meaningfulLength / 40));
  return Math.min(max, min + bonus);
}

function pruneRecord(record: LevelRecord, now: number): void {
  record.recentMessages = (record.recentMessages ?? []).filter(x => now - x.at <= DUPLICATE_WINDOW_MS).slice(-40);
  record.messageXpWindow = (record.messageXpWindow ?? []).filter(x => now - x.at < MESSAGE_WINDOW_MS);
  record.reactedMessages ??= {};
  for (const [messageId, at] of Object.entries(record.reactedMessages)) {
    if (now - at > REACTION_MESSAGE_MAX_AGE_MS) delete record.reactedMessages[messageId];
  }
}

async function applyXp(guild: Guild, userId: string, amount: number): Promise<{ oldLevel: number; newLevel: number }> {
  let oldLevel = 0;
  let newLevel = 0;
  const now = Date.now();
  await updateJson<LevelsFile>("levels", DEFAULT_LEVELS, data => {
    data.guilds[guild.id] ??= {};
    const record = data.guilds[guild.id]![userId] ??= { xp: 0, level: 0 };
    oldLevel = record.level;
    addXpToRecord(record, amount, now);
    newLevel = record.level;
  });
  return { oldLevel, newLevel };
}

async function handleLevelUp(guild: Guild, userId: string, oldLevel: number, newLevel: number): Promise<void> {
  if (newLevel <= oldLevel) return;

  const settings = await getGuildSettings(guild.id);
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;

  await syncTier(member, settings.leveling.tiers, newLevel);

  const crossedTiers = [...settings.leveling.tiers]
    .sort((a, b) => a.level - b.level)
    .filter(t => t.level > oldLevel && t.level <= newLevel);
  const newestTier = crossedTiers.at(-1);

  const channelId = settings.leveling.announcementChannelId;
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable()) return;

  const embed = new EmbedBuilder()
    .setColor(0xc47a48)
    .setDescription(`You reached **Level ${newLevel}**.${newestTier ? `\nTier: ${`<@&${newestTier.roleId}>`}` : ""}`);

  await channel.send({
    content: `<@${userId}>`,
    allowedMentions: { users: [userId], roles: [] },
    embeds: [embed],
  }).catch(() => undefined);
}

async function awardMessageXp(message: Message): Promise<void> {
  if (!message.guild || message.author.bot || message.webhookId) return;
  const settings = await getGuildSettings(message.guild.id);
  if (!settings.leveling.enabled || looksLikeSpam(message)) return;

  const now = Date.now();
  const signature = normalizeMessage(message);
  let oldLevel = 0;
  let newLevel = 0;
  let awarded = 0;

  await updateJson<LevelsFile>("levels", DEFAULT_LEVELS, data => {
    data.guilds[message.guild!.id] ??= {};
    const record = data.guilds[message.guild!.id]![message.author.id] ??= { xp: 0, level: 0 };
    pruneRecord(record, now);
    oldLevel = record.level;

    // Duplicate/reposted messages do not earn XP even if the 60-second bucket has room.
    if (record.recentMessages?.some(x => x.signature === signature)) {
      newLevel = oldLevel;
      return;
    }

    record.recentMessages ??= [];
    record.recentMessages.push({ signature, at: now });
    record.recentMessages = record.recentMessages.slice(-40);

    const usedThisWindow = (record.messageXpWindow ?? []).reduce((sum, entry) => sum + entry.amount, 0);
    const remaining = Math.max(0, MESSAGE_WINDOW_XP_CAP - usedThisWindow);
    if (remaining <= 0) {
      newLevel = oldLevel;
      return;
    }

    const baseGain = messageXp(message, settings.leveling.xpMin, settings.leveling.xpMax);
    awarded = Math.min(baseGain, remaining);
    if (awarded <= 0) {
      newLevel = oldLevel;
      return;
    }

    record.messageXpWindow ??= [];
    record.messageXpWindow.push({ at: now, amount: awarded });
    addXpToRecord(record, awarded, now);
    newLevel = record.level;
  });

  if (awarded > 0 && newLevel > oldLevel) await handleLevelUp(message.guild, message.author.id, oldLevel, newLevel);
}

async function awardReactionXp(
  reactionInput: MessageReaction | PartialMessageReaction,
  userInput: User | PartialUser,
): Promise<void> {
  const user = userInput.partial ? await userInput.fetch().catch(error => {
    console.error("Reaction XP could not fetch user:", error);
    return null;
  }) : userInput;
  if (!user || user.bot) return;

  const reaction = reactionInput.partial ? await reactionInput.fetch().catch(error => {
    console.error("Reaction XP could not fetch reaction:", error);
    return null;
  }) : reactionInput;
  if (!reaction) return;

  const message = reaction.message.partial ? await reaction.message.fetch().catch(error => {
    console.error("Reaction XP could not fetch message:", error);
    return null;
  }) : reaction.message;
  if (!message?.guild || !message.author || message.author.bot || message.author.id === user.id) return;
  if (Date.now() - message.createdTimestamp > REACTION_MESSAGE_MAX_AGE_MS) return;

  const settings = await getGuildSettings(message.guild.id);
  if (!settings.leveling.enabled) return;

  const now = Date.now();
  let oldLevel = 0;
  let newLevel = 0;
  let awarded = false;

  await updateJson<LevelsFile>("levels", DEFAULT_LEVELS, data => {
    data.guilds[message.guild!.id] ??= {};
    const record = data.guilds[message.guild!.id]![user.id] ??= { xp: 0, level: 0 };
    pruneRecord(record, now);
    oldLevel = record.level;

    // No daily reaction cap. These two checks only prevent rapid/remove-readd farming.
    if (record.lastReactionXpAt && now - record.lastReactionXpAt < REACTION_COOLDOWN_MS) {
      newLevel = oldLevel;
      return;
    }
    if (record.reactedMessages?.[message.id]) {
      newLevel = oldLevel;
      return;
    }

    record.lastReactionXpAt = now;
    record.reactedMessages ??= {};
    record.reactedMessages[message.id] = now;
    addXpToRecord(record, REACTION_XP, now);
    newLevel = record.level;
    awarded = true;
  });

  if (awarded && newLevel > oldLevel) await handleLevelUp(message.guild, user.id, oldLevel, newLevel);
}

function registerVoiceXp(client: Client): void {
  setInterval(() => {
    void (async () => {
      for (const guild of client.guilds.cache.values()) {
        const settings = await getGuildSettings(guild.id);
        if (!settings.leveling.enabled) continue;

        const currentlyEligible = new Set<string>();
        for (const state of guild.voiceStates.cache.values()) {
          const member = state.member;
          const channel = state.channel;
          if (!member || member.user.bot || !channel) continue;
          if (guild.afkChannelId && channel.id === guild.afkChannelId) continue;
          if (state.selfDeaf || state.serverDeaf) continue;
          const nonBots = channel.members.filter(m => !m.user.bot).size;
          if (nonBots < 2) continue;

          const key = `${guild.id}:${member.id}`;
          currentlyEligible.add(key);
          const minutes = (voiceMinutes.get(key) ?? 0) + 1;
          if (minutes < VOICE_AWARD_MINUTES) {
            voiceMinutes.set(key, minutes);
            continue;
          }

          voiceMinutes.set(key, 0);
          const { oldLevel, newLevel } = await applyXp(guild, member.id, VOICE_XP);
          if (newLevel > oldLevel) await handleLevelUp(guild, member.id, oldLevel, newLevel);
        }

        for (const key of [...voiceMinutes.keys()]) {
          if (key.startsWith(`${guild.id}:`) && !currentlyEligible.has(key)) voiceMinutes.delete(key);
        }
      }
    })().catch(error => console.error("Voice XP worker failed:", error));
  }, 60_000).unref();
}

export function registerLeveling(client: Client): void {
  client.on(Events.MessageCreate, message => {
    void awardMessageXp(message).catch(error => console.error("Message XP failed:", error));
  });
  client.on(Events.MessageReactionAdd, (reaction, user) => {
    void awardReactionXp(reaction, user).catch(error => console.error("Reaction XP failed:", error));
  });
  registerVoiceXp(client);
}
