import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../lib/command.js";
import { DEFAULT_LEVELS, type LevelsFile } from "../storage/schema.js";
import { readJson } from "../storage/json-store.js";
import { currentWeeklyXp } from "../features/leveling.js";

const choices = [
  { name: "Weekly XP", value: "weekly" },
  { name: "Total XP", value: "xp" },
  { name: "Highest Level", value: "level" },
] as const;

export const leaderboardCommand: BotCommand = {
  data: new SlashCommandBuilder().setName("leaderboard").setDescription("Show the FERAL activity leaderboard.")
    .addStringOption(o => o.setName("type").setDescription("Leaderboard type").setRequired(true).addChoices(...choices))
    .addIntegerOption(o => o.setName("limit").setDescription("Number of members to show").setMinValue(3).setMaxValue(20)),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return void await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
    const type = interaction.options.getString("type", true);
    const limit = interaction.options.getInteger("limit") ?? 10;
    const data = await readJson<LevelsFile>("levels", DEFAULT_LEVELS);
    const records = data.guilds[interaction.guild.id] ?? {};
    const members = await interaction.guild.members.fetch().catch(() => interaction.guild.members.cache);

    const rows = Object.entries(records)
      .filter(([id]) => members.has(id))
      .map(([id, record]) => ({ id, record, weekly: currentWeeklyXp(record) }));

    if (type === "weekly") rows.sort((a, b) => b.weekly - a.weekly || b.record.xp - a.record.xp);
    else if (type === "level") rows.sort((a, b) => b.record.level - a.record.level || b.record.xp - a.record.xp);
    else rows.sort((a, b) => b.record.xp - a.record.xp || b.record.level - a.record.level);

    const shown = rows.slice(0, limit);
    const title = type === "weekly" ? "Weekly XP Leaderboard" : type === "level" ? "Level Leaderboard" : "Total XP Leaderboard";
    const lines = shown.map((row, index) => {
      const rank = index + 1;
      if (type === "weekly") return `**${rank}.** <@${row.id}> — **${row.weekly.toLocaleString()} XP** this week · Level ${row.record.level}`;
      if (type === "level") return `**${rank}.** <@${row.id}> — **Level ${row.record.level}** · ${row.record.xp.toLocaleString()} XP`;
      return `**${rank}.** <@${row.id}> — **${row.record.xp.toLocaleString()} XP** · Level ${row.record.level}`;
    });

    const embed = new EmbedBuilder()
      .setColor(0x8297ab)
      .setTitle(title)
      .setDescription(lines.length ? lines.join("\n") : "No XP has been earned yet.")
      .setTimestamp();
    await interaction.reply({ embeds: [embed], allowedMentions: { users: [] } });
  },
};
