import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../lib/command.js";

export const serverinfoCommand: BotCommand = {
  data: new SlashCommandBuilder().setName("serverinfo").setDescription("Show information about this server."),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return void await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
    const guild = interaction.guild;
    const embed = new EmbedBuilder()
      .setColor(0x7f9a8c)
      .setTitle(guild.name)
      .setThumbnail(guild.iconURL())
      .addFields(
        { name: "Members", value: String(guild.memberCount), inline: true },
        { name: "Channels", value: String(guild.channels.cache.size), inline: true },
        { name: "Roles", value: String(guild.roles.cache.size), inline: true },
        { name: "Created", value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>` }
      );
    await interaction.reply({ embeds: [embed] });
  },
};
