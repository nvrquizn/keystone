import { SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../lib/command.js";

export const rolemembersCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("rolemembers")
    .setDescription("List members who have a role.")
    .addRoleOption(o => o.setName("role").setDescription("Role to inspect").setRequired(true)),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return void await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
    const role = interaction.options.getRole("role", true);
    await interaction.guild.members.fetch();
    const names = role.members.map(m => m.user.tag);
    const text = names.length ? names.slice(0, 100).join("\n") : "No members have this role.";
    await interaction.reply({ content: `**${role.name} — ${names.length} member(s)**\n${text}`, ephemeral: true });
  },
};
