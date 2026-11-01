import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../lib/command.js";

export const helpCommand: BotCommand = {
  data: new SlashCommandBuilder().setName("help").setDescription("Show the bot's main commands."),
  async execute(interaction) {
    const embed = new EmbedBuilder().setColor(0x7f9a8c).setTitle("FERAL bot commands").setDescription([
      "**Utility** — `/ping`, `/userinfo`, `/serverinfo`, `/rolemembers`, `/whohas`, `/remindme`, `/stopwatch`, `/level`, `/leaderboard`",
      "**Staff** — `/warn`, `/timeout`, `/kick`, `/ban`, `/notes`, `/add-level`, `/remove-level`, `/add-xp`, `/remove-xp`",
      "**Server tools** — `/sticky`, `/embed`, `/ticket`, `/setup`, `/selfroles`, `/automod`",
      "",
      "Some commands only appear for members with the required server permissions.",
    ].join("\n"));
    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
