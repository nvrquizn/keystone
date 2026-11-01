import { EmbedBuilder, PermissionFlagsBits, type Client, type Message } from "discord.js";
import { getGuildSettings } from "../storage/settings.js";
import { sendLog } from "../lib/logging.js";

const activity = new Map<string, number[]>();

export function registerAutomod(client: Client): void {
  client.on("messageCreate", async (message: Message) => {
    if (!message.guild || message.author.bot || !message.member) return;
    if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;
    const settings = await getGuildSettings(message.guild.id);
    if (!settings.automod.enabled) return;

    const content = message.content.toLowerCase();
    const matched = settings.automod.blockedTerms.find(term => term && content.includes(term));
    if (matched) {
      await message.delete().catch(() => undefined);
      await sendLog(message.guild, "moderation", new EmbedBuilder().setColor(0xe86767).setTitle("Automod: blocked term").addFields(
        { name: "Member", value: `${message.author.tag} (${message.author.id})` },
        { name: "Channel", value: `<#${message.channelId}>` },
        { name: "Matched rule", value: matched }
      ).setTimestamp());
      return;
    }

    const key = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();
    const windowMs = settings.automod.spamWindowSeconds * 1000;
    const times = (activity.get(key) ?? []).filter(t => now - t < windowMs);
    times.push(now);
    activity.set(key, times);
    if (times.length > settings.automod.spamMessageCount) {
      await message.delete().catch(() => undefined);
      await sendLog(message.guild, "moderation", new EmbedBuilder().setColor(0xe86767).setTitle("Automod: message spam").addFields(
        { name: "Member", value: `${message.author.tag} (${message.author.id})` },
        { name: "Channel", value: `<#${message.channelId}>` },
        { name: "Rate", value: `${times.length} messages in ${settings.automod.spamWindowSeconds}s` }
      ).setTimestamp());
    }
  });
}
