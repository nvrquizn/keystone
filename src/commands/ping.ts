import { SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../lib/command.js";

export const pingCommand: BotCommand = {
  data: new SlashCommandBuilder().setName("ping").setDescription("Check whether the bot is responding."),
  async execute(interaction) {
    await interaction.reply({ content: `Pong — ${interaction.client.ws.ping}ms.`, ephemeral: true });
  },
};
