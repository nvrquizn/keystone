import { PermissionFlagsBits, type ChatInputCommandInteraction, type GuildMember } from "discord.js";

export function isStaff(interaction: ChatInputCommandInteraction): boolean {
  if (!interaction.inCachedGuild()) return false;
  const member = interaction.member as GuildMember;
  return member.permissions.has(PermissionFlagsBits.ModerateMembers) || member.permissions.has(PermissionFlagsBits.Administrator);
}

export async function requireStaff(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (isStaff(interaction)) return true;
  await interaction.reply({ content: "You do not have permission to use this command.", ephemeral: true });
  return false;
}
