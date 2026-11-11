import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../lib/command.js";
import { getGuildSettings } from "../storage/settings.js";

export const tiersCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("tiers")
    .setDescription("View FERAL leveling tiers and their unlocks."),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      return void await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
    }

    const settings = await getGuildSettings(interaction.guild.id);

    const tiers = [...settings.leveling.tiers].sort(
      (a, b) => a.level - b.level,
    );

    const embed = new EmbedBuilder()
      .setColor(0x8297ab)
      .setTitle("FERAL Leveling Tiers");

    if (!tiers.length) {
      embed.setDescription("No leveling tiers have been configured yet.");

      await interaction.reply({
        embeds: [embed],
      });

      return;
    }

    embed.setDescription(
      "Earn XP by being active in the server. Higher tiers unlock additional perks and access.",
    );

    for (const tier of tiers) {
      const role = interaction.guild.roles.cache.get(tier.roleId);

      const roleText = role
        ? `<@&${tier.roleId}>`
        : `**${tier.name}**`;

      const unlockText =
        tier.unlocks?.trim() ||
        "No additional unlocks have been listed for this tier yet.";

      embed.addFields({
        name: `${tier.name} — Level ${tier.level}`,
        value:
          `${roleText}\n` +
          `**Unlocks:**\n${unlockText}`,
      });
    }

    await interaction.reply({
      embeds: [embed],
      allowedMentions: { roles: [] },
    });
  },
};
