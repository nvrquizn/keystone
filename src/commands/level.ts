import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../lib/command.js";
import { DEFAULT_LEVELS, type LevelsFile } from "../storage/schema.js";
import { readJson } from "../storage/json-store.js";
import { getGuildSettings } from "../storage/settings.js";
import { currentWeeklyXp, totalXpForLevel } from "../features/leveling.js";

export const levelCommand: BotCommand = {
  data: new SlashCommandBuilder().setName("level").setDescription("Level and tier information.")
    .addSubcommand(s => s.setName("view").setDescription("Show a member's activity level")
      .addUserOption(o => o.setName("user").setDescription("Member")))
    .addSubcommand(s => s.setName("list").setDescription("List all configured tier roles and required levels")),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return void await interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
    const sub = interaction.options.getSubcommand();
    const settings = await getGuildSettings(interaction.guild.id);

    if (sub === "list") {
      const tiers = [...settings.leveling.tiers].sort((a, b) => a.level - b.level);
      const embed = new EmbedBuilder().setColor(0x8297ab).setTitle("Level Tiers");
      if (!tiers.length) embed.setDescription("No level tiers have been configured yet.");
      else embed.setDescription(tiers.map(t => `<@&${t.roleId}> — **Level ${t.level}**`).join("\n"));
      await interaction.reply({ embeds: [embed], allowedMentions: { roles: [] } });
      return;
    }

    const user = interaction.options.getUser("user") ?? interaction.user;
    const data = await readJson<LevelsFile>("levels", DEFAULT_LEVELS);
    const record = data.guilds[interaction.guild.id]?.[user.id] ?? { xp: 0, level: 0 };
    const tier = [...settings.leveling.tiers].sort((a,b) => a.level-b.level).filter(t => record.level >= t.level).at(-1);
    const next = [...settings.leveling.tiers].sort((a,b) => a.level-b.level).find(t => record.level < t.level);
    const embed = new EmbedBuilder().setColor(0xa87955).setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
      .addFields(
        { name: "Level", value: String(record.level), inline: true },
        { name: "Total XP", value: record.xp.toLocaleString(), inline: true },
        { name: "Weekly XP", value: currentWeeklyXp(record).toLocaleString(), inline: true },
        { name: "Tier", value: tier ? `<@&${tier.roleId}>` : "None", inline: true },
        { name: "Next level", value: `${Math.max(0, totalXpForLevel(record.level + 1) - record.xp).toLocaleString()} XP`, inline: true },
        { name: "Next tier", value: next ? `<@&${next.roleId}> — Level ${next.level}` : "Highest configured tier" }
      );
    await interaction.reply({ embeds: [embed], allowedMentions: { roles: [] } });
  },
};
