import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../lib/command.js";
import { requireStaff } from "../lib/permissions.js";
import { updateGuildSettings } from "../storage/settings.js";

export const automodCommand: BotCommand = {
  data: new SlashCommandBuilder().setName("automod").setDescription("Configure basic custom automod rules.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s => s.setName("enabled").setDescription("Enable or disable custom automod")
      .addBooleanOption(o => o.setName("value").setDescription("Enabled").setRequired(true)))
    .addSubcommand(s => s.setName("block").setDescription("Add a blocked term")
      .addStringOption(o => o.setName("term").setDescription("Term or phrase").setRequired(true).setMaxLength(100)))
    .addSubcommand(s => s.setName("unblock").setDescription("Remove a blocked term")
      .addStringOption(o => o.setName("term").setDescription("Term or phrase").setRequired(true).setMaxLength(100)))
    .addSubcommand(s => s.setName("spam").setDescription("Set message-rate spam protection")
      .addIntegerOption(o => o.setName("count").setDescription("Messages allowed in window").setRequired(true).setMinValue(3).setMaxValue(20))
      .addIntegerOption(o => o.setName("seconds").setDescription("Window in seconds").setRequired(true).setMinValue(3).setMaxValue(60))),
  async execute(interaction) {
    if (!(await requireStaff(interaction)) || !interaction.inCachedGuild()) return;
    const sub = interaction.options.getSubcommand();
    if (sub === "enabled") {
      const value = interaction.options.getBoolean("value", true);
      await updateGuildSettings(interaction.guild.id, s => { s.automod.enabled = value; });
      await interaction.reply({ content: `Custom automod ${value ? "enabled" : "disabled"}.`, ephemeral: true });
      return;
    }
    if (sub === "block") {
      const term = interaction.options.getString("term", true).trim().toLowerCase();
      await updateGuildSettings(interaction.guild.id, s => { if (!s.automod.blockedTerms.includes(term)) s.automod.blockedTerms.push(term); });
      await interaction.reply({ content: "Blocked term added.", ephemeral: true });
      return;
    }
    if (sub === "unblock") {
      const term = interaction.options.getString("term", true).trim().toLowerCase();
      await updateGuildSettings(interaction.guild.id, s => { s.automod.blockedTerms = s.automod.blockedTerms.filter(x => x !== term); });
      await interaction.reply({ content: "Blocked term removed if it was configured.", ephemeral: true });
      return;
    }
    const count = interaction.options.getInteger("count", true);
    const seconds = interaction.options.getInteger("seconds", true);
    await updateGuildSettings(interaction.guild.id, s => { s.automod.spamMessageCount = count; s.automod.spamWindowSeconds = seconds; });
    await interaction.reply({ content: `Spam protection set to ${count} messages per ${seconds} seconds.`, ephemeral: true });
  },
};
