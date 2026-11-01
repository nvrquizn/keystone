import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../lib/command.js";
import {
  addStopwatchLap,
  formatStopwatch,
  getStopwatch,
  pauseStopwatch,
  resetStopwatch,
  resumeStopwatch,
  startStopwatch,
  stopStopwatch,
  stopwatchElapsed,
  type StopwatchRecord,
} from "../features/stopwatch.js";

function statusLabel(state: StopwatchRecord["state"]): string {
  if (state === "running") return "Running";
  if (state === "paused") return "Paused";
  return "Stopped";
}

function stopwatchEmbed(record: StopwatchRecord, title = "Stopwatch"): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0x8297ab)
    .setTitle(title)
    .setDescription(`**${formatStopwatch(stopwatchElapsed(record))}**`)
    .addFields({ name: "Status", value: statusLabel(record.state), inline: true });

  if (record.laps.length) {
    const recent = record.laps.slice(-10);
    const offset = record.laps.length - recent.length;
    embed.addFields({
      name: record.laps.length > 10 ? `Recent laps (${record.laps.length} total)` : "Laps",
      value: recent.map((lap, index) => `**#${offset + index + 1}** — ${formatStopwatch(lap.elapsedMs)}`).join("\n"),
    });
  }
  return embed;
}

export const stopwatchCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("stopwatch")
    .setDescription("Use a personal stopwatch.")
    .addSubcommand(s => s.setName("start").setDescription("Start a new stopwatch."))
    .addSubcommand(s => s.setName("pause").setDescription("Pause your running stopwatch."))
    .addSubcommand(s => s.setName("resume").setDescription("Resume your paused stopwatch."))
    .addSubcommand(s => s.setName("lap").setDescription("Record the current elapsed time as a lap."))
    .addSubcommand(s => s.setName("status").setDescription("Show your current stopwatch and laps."))
    .addSubcommand(s => s.setName("stop").setDescription("Stop your stopwatch and show the final time."))
    .addSubcommand(s => s.setName("reset").setDescription("Clear your stopwatch and saved laps.")),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      return void await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    const userId = interaction.user.id;

    if (sub === "start") {
      const result = await startStopwatch(guildId, userId);
      if (!result.ok) return void await interaction.reply({ content: result.reason, ephemeral: true });
      return void await interaction.reply({ embeds: [stopwatchEmbed(result.record, "Stopwatch started")], ephemeral: true });
    }

    if (sub === "pause") {
      const result = await pauseStopwatch(guildId, userId);
      if (!result.ok) return void await interaction.reply({ content: result.reason, ephemeral: true });
      return void await interaction.reply({ embeds: [stopwatchEmbed(result.record, "Stopwatch paused")], ephemeral: true });
    }

    if (sub === "resume") {
      const result = await resumeStopwatch(guildId, userId);
      if (!result.ok) return void await interaction.reply({ content: result.reason, ephemeral: true });
      return void await interaction.reply({ embeds: [stopwatchEmbed(result.record, "Stopwatch resumed")], ephemeral: true });
    }

    if (sub === "lap") {
      const result = await addStopwatchLap(guildId, userId);
      if (!result.ok) return void await interaction.reply({ content: result.reason, ephemeral: true });
      return void await interaction.reply({
        content: `Lap #${result.lapNumber}: **${formatStopwatch(result.lap.elapsedMs)}**`,
        ephemeral: true,
      });
    }

    if (sub === "status") {
      const record = await getStopwatch(guildId, userId);
      if (!record) return void await interaction.reply({ content: "You do not have a stopwatch yet. Use `/stopwatch start`.", ephemeral: true });
      return void await interaction.reply({ embeds: [stopwatchEmbed(record)], ephemeral: true });
    }

    if (sub === "stop") {
      const result = await stopStopwatch(guildId, userId);
      if (!result.ok) return void await interaction.reply({ content: result.reason, ephemeral: true });
      return void await interaction.reply({ embeds: [stopwatchEmbed(result.record, "Stopwatch stopped")], ephemeral: true });
    }

    const existed = await resetStopwatch(guildId, userId);
    await interaction.reply({ content: existed ? "Stopwatch reset." : "You do not have a stopwatch to reset.", ephemeral: true });
  },
};
