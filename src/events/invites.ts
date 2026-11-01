import { EmbedBuilder, Events, type Client, type Guild } from "discord.js";
import { sendLog } from "../lib/logging.js";

const cache = new Map<string, Map<string, number>>();

async function snapshot(guild: Guild): Promise<void> {
  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) return;
  cache.set(guild.id, new Map(invites.map(i => [i.code, i.uses ?? 0])));
}

export function registerInviteTracking(client: Client): void {
  client.once(Events.ClientReady, () => {
    for (const guild of client.guilds.cache.values()) void snapshot(guild);
  });

  client.on(Events.InviteCreate, invite => {
    const guild = invite.guild ? client.guilds.cache.get(invite.guild.id) : undefined;
    if (!guild) return;
    void sendLog(guild, "invites", new EmbedBuilder().setColor(0x6ff098).setTitle("Invite created").addFields(
      { name: "Code", value: invite.code, inline: true },
      { name: "Channel", value: invite.channelId ? `<#${invite.channelId}>` : "Unknown", inline: true },
      { name: "Creator", value: invite.inviter ? `${invite.inviter.tag} (${invite.inviter.id})` : "Unknown" },
      { name: "Max uses", value: invite.maxUses ? String(invite.maxUses) : "Unlimited", inline: true },
      { name: "Expires", value: invite.expiresTimestamp ? `<t:${Math.floor(invite.expiresTimestamp / 1000)}:R>` : "Never", inline: true },
    ).setTimestamp());
    void snapshot(guild);
  });

  client.on(Events.InviteDelete, invite => {
    const guild = invite.guild ? client.guilds.cache.get(invite.guild.id) : undefined;
    if (!guild) return;
    void sendLog(guild, "invites", new EmbedBuilder().setColor(0xe56b6f).setTitle("Invite deleted").addFields(
      { name: "Code", value: invite.code, inline: true },
      { name: "Channel", value: invite.channelId ? `<#${invite.channelId}>` : "Unknown", inline: true },
    ).setTimestamp());
    void snapshot(guild);
  });

  client.on(Events.GuildMemberAdd, async member => {
    const before = cache.get(member.guild.id) ?? new Map<string, number>();
    const invites = await member.guild.invites.fetch().catch(() => null);
    if (!invites) return;
    const used = invites.find(i => (i.uses ?? 0) > (before.get(i.code) ?? 0));
    cache.set(member.guild.id, new Map(invites.map(i => [i.code, i.uses ?? 0])));
    if (!used) return;
    await sendLog(member.guild, "invites", new EmbedBuilder().setColor(0x6ff098).setTitle("Invite used").addFields(
      { name: "Member", value: `${member.user.tag} (${member.id})` },
      { name: "Invite", value: used.code },
      { name: "Inviter", value: used.inviter ? `${used.inviter.tag} (${used.inviter.id})` : "Unknown" },
      { name: "Uses", value: String(used.uses ?? 0) }
    ).setTimestamp());
  });
}
