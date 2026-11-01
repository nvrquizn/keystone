import { SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../lib/command.js";

export const whohasCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("whohas")
    .setDescription("Alias for /rolemembers.")
    .addRoleOption(o => o.setName("role").setDescription("Role to inspect").setRequired(true)),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return void await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
    const role = interaction.options.getRole("role", true);
    await interaction.guild.members.fetch();
    const members = role.members.map(m => `${m.user.tag} (${m.id})`);
    await interaction.reply({ content: members.length ? `**${role.name}**\n${members.slice(0, 100).join("\n")}` : `Nobody currently has **${role.name}**.`, ephemeral: true });
  },
};
