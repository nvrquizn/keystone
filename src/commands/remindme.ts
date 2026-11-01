import { SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../lib/command.js";
import { parseDuration } from "../lib/time.js";
import { addReminder } from "../features/reminders.js";

export const remindmeCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("remindme")
    .setDescription("Set a reminder.")
    .addStringOption(o => o.setName("in").setDescription("Examples: 30m, 2h, 3d").setRequired(true))
    .addStringOption(o => o.setName("message").setDescription("Reminder text").setRequired(true).setMaxLength(1000)),
  async execute(interaction) {
    const duration = parseDuration(interaction.options.getString("in", true));
    if (!duration || duration < 10_000 || duration > 365 * 86_400_000) {
      return void await interaction.reply({ content: "Use a duration between 10 seconds and 365 days, such as `30m`, `2h`, or `3d`.", ephemeral: true });
    }
    const dueAt = Date.now() + duration;
    await addReminder(interaction.client, {
      id: crypto.randomUUID(),
      userId: interaction.user.id,
      channelId: interaction.channelId,
      text: interaction.options.getString("message", true),
      dueAt,
    });
    await interaction.reply({ content: `Reminder set for <t:${Math.floor(dueAt / 1000)}:R>.`, ephemeral: true });
  },
};
