import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../lib/command.js";
import { requireStaff } from "../lib/permissions.js";
import { sendLog } from "../lib/logging.js";
import {
  adjustLevelBy,
  adjustXpBy,
  syncMemberTierRoles,
} from "../features/leveling.js";

async function replyAdjustment(
  interaction: Parameters<BotCommand["execute"]>[0],
  userId: string,
  action: string,
  beforeLevel: number,
  afterLevel: number,
  beforeXp: number,
  afterXp: number,
): Promise<void> {
  if (!interaction.inCachedGuild()) return;
  const user = await interaction.client.users.fetch(userId).catch(() => null);
  const label = user ? `${user.tag} (${user.id})` : userId;
  await sendLog(
    interaction.guild,
    "moderation",
    new EmbedBuilder()
      .setColor(0x8297ab)
      .setTitle("Leveling adjusted")
      .addFields(
        { name: "Member", value: label },
        { name: "Action", value: action },
        { name: "Level", value: `${beforeLevel} → ${afterLevel}`, inline: true },
        { name: "XP", value: `${beforeXp.toLocaleString()} → ${afterXp.toLocaleString()}`, inline: true },
        { name: "Staff", value: `${interaction.user.tag} (${interaction.user.id})` },
      )
      .setTimestamp(),
  );

  await interaction.reply({
    content: `${action} for ${user ? user.tag : `<@${userId}>`}. Level ${beforeLevel} → ${afterLevel}; XP ${beforeXp.toLocaleString()} → ${afterXp.toLocaleString()}.`,
    ephemeral: true,
  });
}

function levelBase(name: string, description: string) {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("Number of levels").setRequired(true).setMinValue(1).setMaxValue(1000));
}

function xpBase(name: string, description: string) {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("XP amount").setRequired(true).setMinValue(1).setMaxValue(10000000));
}

export const addLevelCommand: BotCommand = {
  data: levelBase("add-level", "Add levels to a member."),
  async execute(interaction) {
    if (!(await requireStaff(interaction)) || !interaction.inCachedGuild()) return;
    const user = interaction.options.getUser("user", true);
    const amount = interaction.options.getInteger("amount", true);
    const result = await adjustLevelBy(interaction.guild, user.id, amount);
    await syncMemberTierRoles(interaction.guild, user.id, result.after.level);
    await replyAdjustment(interaction, user.id, `Added ${amount} level${amount === 1 ? "" : "s"}`, result.before.level, result.after.level, result.before.xp, result.after.xp);
  },
};

export const removeLevelCommand: BotCommand = {
  data: levelBase("remove-level", "Remove levels from a member."),
  async execute(interaction) {
    if (!(await requireStaff(interaction)) || !interaction.inCachedGuild()) return;
    const user = interaction.options.getUser("user", true);
    const amount = interaction.options.getInteger("amount", true);
    const result = await adjustLevelBy(interaction.guild, user.id, -amount);
    await syncMemberTierRoles(interaction.guild, user.id, result.after.level);
    await replyAdjustment(interaction, user.id, `Removed ${amount} level${amount === 1 ? "" : "s"}`, result.before.level, result.after.level, result.before.xp, result.after.xp);
  },
};

export const addXpCommand: BotCommand = {
  data: xpBase("add-xp", "Add XP to a member."),
  async execute(interaction) {
    if (!(await requireStaff(interaction)) || !interaction.inCachedGuild()) return;
    const user = interaction.options.getUser("user", true);
    const amount = interaction.options.getInteger("amount", true);
    const result = await adjustXpBy(interaction.guild, user.id, amount);
    await syncMemberTierRoles(interaction.guild, user.id, result.after.level);
    await replyAdjustment(interaction, user.id, `Added ${amount.toLocaleString()} XP`, result.before.level, result.after.level, result.before.xp, result.after.xp);
  },
};

export const removeXpCommand: BotCommand = {
  data: xpBase("remove-xp", "Remove XP from a member."),
  async execute(interaction) {
    if (!(await requireStaff(interaction)) || !interaction.inCachedGuild()) return;
    const user = interaction.options.getUser("user", true);
    const amount = interaction.options.getInteger("amount", true);
    const result = await adjustXpBy(interaction.guild, user.id, -amount);
    await syncMemberTierRoles(interaction.guild, user.id, result.after.level);
    await replyAdjustment(interaction, user.id, `Removed ${amount.toLocaleString()} XP`, result.before.level, result.after.level, result.before.xp, result.after.xp);
  },
};
