import { EmbedBuilder, type Client, type Guild } from "discord.js";
import { getGuildSettings } from "../storage/settings.js";
import type { LogKind } from "../storage/schema.js";

export async function sendLog(guild: Guild, kind: LogKind, embed: EmbedBuilder): Promise<void> {
  const settings = await getGuildSettings(guild.id);
  const channelId = settings.logs[kind] ?? settings.logs.general;
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isSendable()) return;
  await channel.send({ embeds: [embed] }).catch(() => undefined);
}

export async function sendClientLog(client: Client, guildId: string, kind: LogKind, embed: EmbedBuilder): Promise<void> {
  const guild = client.guilds.cache.get(guildId);
  if (guild) await sendLog(guild, kind, embed);
}
