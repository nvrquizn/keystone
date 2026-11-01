import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../lib/command.js";
import { requireStaff } from "../lib/permissions.js";
import { sendLog } from "../lib/logging.js";
import { addModNote } from "../features/modnotes.js";
import { parseDuration } from "../lib/time.js";

export const warnCommand: BotCommand = {
  data: new SlashCommandBuilder().setName("warn").setDescription("Record a warning for a member.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(1000)),
  async execute(interaction) {
    if (!(await requireStaff(interaction)) || !interaction.inCachedGuild()) return;
    const user = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason", true);
    const note = await addModNote(interaction.guild.id, user.id, interaction.user.id, reason, "warning");
    await user.send(`You were warned in **${interaction.guild.name}**.\nReason: ${reason}`).catch(() => undefined);
    await sendLog(interaction.guild, "moderation", new EmbedBuilder().setColor(0xe86767).setTitle("Member warned").addFields(
      { name: "Member", value: `${user.tag} (${user.id})` },
      { name: "Moderator", value: `${interaction.user.tag} (${interaction.user.id})` },
      { name: "Reason", value: reason },
      { name: "Record ID", value: note.id }
    ).setTimestamp());
    await interaction.reply({ content: `Warning recorded for ${user.tag}.`, ephemeral: true });
  },
};

export const timeoutCommand: BotCommand = {
  data: new SlashCommandBuilder().setName("timeout").setDescription("Timeout a member.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
    .addStringOption(o => o.setName("duration").setDescription("Examples: 10m, 2h, 1d").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(1000)),
  async execute(interaction) {
    if (!(await requireStaff(interaction)) || !interaction.inCachedGuild()) return;
    const user = interaction.options.getUser("user", true);
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) return void await interaction.reply({ content: "That member is not in the server.", ephemeral: true });
    const duration = parseDuration(interaction.options.getString("duration", true));
    if (!duration || duration > 28 * 86_400_000) return void await interaction.reply({ content: "Use a valid duration up to 28 days.", ephemeral: true });
    const reason = interaction.options.getString("reason", true);
    await member.timeout(duration, reason);
    await sendLog(interaction.guild, "moderation", new EmbedBuilder().setColor(0xe86767).setTitle("Member timed out").addFields(
      { name: "Member", value: `${user.tag} (${user.id})` }, { name: "Duration", value: interaction.options.getString("duration", true) }, { name: "Reason", value: reason }, { name: "Moderator", value: interaction.user.tag }
    ).setTimestamp());
    await interaction.reply({ content: `${user.tag} was timed out.`, ephemeral: true });
  },
};

export const kickCommand: BotCommand = {
  data: new SlashCommandBuilder().setName("kick").setDescription("Kick a member.")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(1000)),
  async execute(interaction) {
    if (!(await requireStaff(interaction)) || !interaction.inCachedGuild()) return;
    const user = interaction.options.getUser("user", true);
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member?.kickable) return void await interaction.reply({ content: "I cannot kick that member.", ephemeral: true });
    const reason = interaction.options.getString("reason", true);
    await member.kick(reason);
    await sendLog(interaction.guild, "moderation", new EmbedBuilder().setColor(0xe86767).setTitle("Member kicked").addFields(
      { name: "Member", value: `${user.tag} (${user.id})` }, { name: "Reason", value: reason }, { name: "Moderator", value: interaction.user.tag }
    ).setTimestamp());
    await interaction.reply({ content: `${user.tag} was kicked.`, ephemeral: true });
  },
};

export const banCommand: BotCommand = {
  data: new SlashCommandBuilder().setName("ban").setDescription("Ban a member.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(1000))
    .addIntegerOption(o => o.setName("delete-days").setDescription("Delete message history from the last 0-7 days").setMinValue(0).setMaxValue(7)),
  async execute(interaction) {
    if (!(await requireStaff(interaction)) || !interaction.inCachedGuild()) return;
    const user = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason", true);
    const days = interaction.options.getInteger("delete-days") ?? 0;
    await interaction.guild.members.ban(user.id, { reason, deleteMessageSeconds: days * 86_400 });
    await sendLog(interaction.guild, "moderation", new EmbedBuilder().setColor(0xe53935).setTitle("Member banned").addFields(
      { name: "Member", value: `${user.tag} (${user.id})` }, { name: "Reason", value: reason }, { name: "Moderator", value: interaction.user.tag }
    ).setTimestamp());
    await interaction.reply({ content: `${user.tag} was banned.`, ephemeral: true });
  },
};
