import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { BotCommand } from "../lib/command.js";
import { requireStaff } from "../lib/permissions.js";
import { sendLog } from "../lib/logging.js";
import { addModNote } from "../features/modnotes.js";
import { parseDuration } from "../lib/time.js";

const DAY_MS = 86_400_000;

function warningExpiryFromChoice(choice: string): Date | null {
  if (choice === "never") return null;

  const months = Number(choice);
  if (![1, 2, 3].includes(months)) return null;

  const expires = new Date();
  expires.setUTCMonth(expires.getUTCMonth() + months);
  return expires;
}

function discordTimestamp(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:F>`;
}

async function sendStaffDM(
  user: { send: (content: string) => Promise<unknown> },
  content: string,
): Promise<boolean> {
  return user.send(content).then(() => true).catch(() => false);
}

function dmResultSuffix(delivered: boolean): string {
  return delivered ? "" : " I could not deliver the moderation DM to them.";
}

export const warnCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Record a warning for a member.")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o =>
      o.setName("user").setDescription("Member").setRequired(true),
    )
    .addStringOption(o =>
      o.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(1000),
    )
    .addStringOption(o =>
      o.setName("expires")
        .setDescription("When this warning should expire")
        .setRequired(true)
        .addChoices(
          { name: "1 month", value: "1" },
          { name: "2 months", value: "2" },
          { name: "3 months", value: "3" },
          { name: "Never", value: "never" },
        ),
    ),
  async execute(interaction) {
    if (!(await requireStaff(interaction)) || !interaction.inCachedGuild()) return;

    const user = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason", true);
    const expiryChoice = interaction.options.getString("expires", true);
    const expiresAt = warningExpiryFromChoice(expiryChoice);
    const expiryText = expiresAt ? discordTimestamp(expiresAt) : "Never";

    // Keep the expiry in the stored moderation record even with the current
    // mod-note storage format. The original warning remains in the audit trail.
    const storedReason = `${reason}\nExpires: ${expiresAt?.toISOString() ?? "Never"}`;
    const note = await addModNote(
      interaction.guild.id,
      user.id,
      interaction.user.id,
      storedReason,
      "warning",
    );

    const delivered = await sendStaffDM(
      user,
      `**You have received a warning in ${interaction.guild.name}.**\n` +
      `Reason: ${reason}\n` +
      `Expires: ${expiryText}\n` +
      `Record ID: ${note.id}`,
    );

    await sendLog(
      interaction.guild,
      "moderation",
      new EmbedBuilder()
        .setColor(0xe86767)
        .setTitle("Member warned")
        .addFields(
          { name: "Member", value: `${user.tag} (${user.id})` },
          { name: "Moderator", value: `${interaction.user.tag} (${interaction.user.id})` },
          { name: "Reason", value: reason },
          { name: "Expires", value: expiryText },
          { name: "Record ID", value: note.id },
          { name: "DM delivered", value: delivered ? "Yes" : "No" },
        )
        .setTimestamp(),
    );

    await interaction.reply({
      content: `Warning recorded for ${user.tag}. Record ID: **${note.id}**.${dmResultSuffix(delivered)}`,
      ephemeral: true,
    });
  },
};

export const unwarnCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("unwarn")
    .setDescription("Revoke a previously issued warning.")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o =>
      o.setName("user").setDescription("Member whose warning is being revoked").setRequired(true),
    )
    .addStringOption(o =>
      o.setName("record-id").setDescription("The warning record ID to revoke").setRequired(true).setMaxLength(100),
    )
    .addStringOption(o =>
      o.setName("reason").setDescription("Why the warning is being revoked").setRequired(true).setMaxLength(1000),
    ),
  async execute(interaction) {
    if (!(await requireStaff(interaction)) || !interaction.inCachedGuild()) return;

    const user = interaction.options.getUser("user", true);
    const recordId = interaction.options.getString("record-id", true);
    const reason = interaction.options.getString("reason", true);

    const reversal = await addModNote(
      interaction.guild.id,
      user.id,
      interaction.user.id,
      `Revoked warning ${recordId}. Reason: ${reason}`,
      "note",
    );

    const delivered = await sendStaffDM(
      user,
      `**A warning in ${interaction.guild.name} has been revoked.**\n` +
      `Warning record: ${recordId}\n` +
      `Reason: ${reason}`,
    );

    await sendLog(
      interaction.guild,
      "moderation",
      new EmbedBuilder()
        .setColor(0x66bb6a)
        .setTitle("Warning revoked")
        .addFields(
          { name: "Member", value: `${user.tag} (${user.id})` },
          { name: "Warning record", value: recordId },
          { name: "Reversal record", value: reversal.id },
          { name: "Reason", value: reason },
          { name: "Moderator", value: `${interaction.user.tag} (${interaction.user.id})` },
          { name: "DM delivered", value: delivered ? "Yes" : "No" },
        )
        .setTimestamp(),
    );

    await interaction.reply({
      content: `Warning **${recordId}** was marked as revoked for ${user.tag}.${dmResultSuffix(delivered)}`,
      ephemeral: true,
    });
  },
};

export const timeoutCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Timeout a member.")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o =>
      o.setName("user").setDescription("Member").setRequired(true),
    )
    .addStringOption(o =>
      o.setName("duration").setDescription("Examples: 10m, 2h, 1d").setRequired(true),
    )
    .addStringOption(o =>
      o.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(1000),
    ),
  async execute(interaction) {
    if (!(await requireStaff(interaction)) || !interaction.inCachedGuild()) return;

    const user = interaction.options.getUser("user", true);
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      return void await interaction.reply({
        content: "That member is not in the server.",
        ephemeral: true,
      });
    }

    const durationText = interaction.options.getString("duration", true);
    const duration = parseDuration(durationText);
    if (!duration || duration > 28 * DAY_MS) {
      return void await interaction.reply({
        content: "Use a valid duration up to 28 days.",
        ephemeral: true,
      });
    }

    const reason = interaction.options.getString("reason", true);

    await member.timeout(duration, reason);

    const delivered = await sendStaffDM(
      user,
      `**You have been timed out in ${interaction.guild.name}.**\n` +
      `Duration: ${durationText}\n` +
      `Reason: ${reason}`,
    );

    await sendLog(
      interaction.guild,
      "moderation",
      new EmbedBuilder()
        .setColor(0xe86767)
        .setTitle("Member timed out")
        .addFields(
          { name: "Member", value: `${user.tag} (${user.id})` },
          { name: "Duration", value: durationText },
          { name: "Reason", value: reason },
          { name: "Moderator", value: `${interaction.user.tag} (${interaction.user.id})` },
          { name: "DM delivered", value: delivered ? "Yes" : "No" },
        )
        .setTimestamp(),
    );

    await interaction.reply({
      content: `${user.tag} was timed out.${dmResultSuffix(delivered)}`,
      ephemeral: true,
    });
  },
};

export const kickCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member.")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o =>
      o.setName("user").setDescription("Member").setRequired(true),
    )
    .addStringOption(o =>
      o.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(1000),
    ),
  async execute(interaction) {
    if (!(await requireStaff(interaction)) || !interaction.inCachedGuild()) return;

    const user = interaction.options.getUser("user", true);
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member?.kickable) {
      return void await interaction.reply({
        content: "I cannot kick that member.",
        ephemeral: true,
      });
    }

    const reason = interaction.options.getString("reason", true);

    // Send before the kick so Discord is more likely to permit the DM.
    const delivered = await sendStaffDM(
      user,
      `**You have been kicked from ${interaction.guild.name}.**\n` +
      `Reason: ${reason}\n` +
      `You may rejoin unless staff has told you otherwise.`,
    );

    await member.kick(reason);

    await sendLog(
      interaction.guild,
      "moderation",
      new EmbedBuilder()
        .setColor(0xe86767)
        .setTitle("Member kicked")
        .addFields(
          { name: "Member", value: `${user.tag} (${user.id})` },
          { name: "Reason", value: reason },
          { name: "Moderator", value: `${interaction.user.tag} (${interaction.user.id})` },
          { name: "DM delivered", value: delivered ? "Yes" : "No" },
        )
        .setTimestamp(),
    );

    await interaction.reply({
      content: `${user.tag} was kicked.${dmResultSuffix(delivered)}`,
      ephemeral: true,
    });
  },
};

export const banCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member.")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o =>
      o.setName("user").setDescription("Member").setRequired(true),
    )
    .addStringOption(o =>
      o.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(1000),
    )
    .addStringOption(o =>
      o.setName("appealable")
        .setDescription("Whether this ban may be appealed")
        .setRequired(true)
        .addChoices(
          { name: "Yes", value: "yes" },
          { name: "No", value: "no" },
        ),
    )
    .addIntegerOption(o =>
      o.setName("delete-days")
        .setDescription("Delete message history from the last 0-7 days")
        .setMinValue(0)
        .setMaxValue(7),
    ),
  async execute(interaction) {
    if (!(await requireStaff(interaction)) || !interaction.inCachedGuild()) return;

    const user = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason", true);
    const appealable = interaction.options.getString("appealable", true) === "yes";
    const days = interaction.options.getInteger("delete-days") ?? 0;

    const existingMember = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (existingMember && !existingMember.bannable) {
      return void await interaction.reply({
        content: "I cannot ban that member.",
        ephemeral: true,
      });
    }

    const delivered = await sendStaffDM(
      user,
      `**You have been banned from ${interaction.guild.name}.**\n` +
      `Reason: ${reason}\n` +
      `Appealable: ${appealable ? "Yes" : "No"}`,
    );

    await interaction.guild.members.ban(user.id, {
      reason,
      deleteMessageSeconds: days * 86_400,
    });

    const note = await addModNote(
      interaction.guild.id,
      user.id,
      interaction.user.id,
      `${reason}\nAppealable: ${appealable ? "Yes" : "No"}`,
      "note",
    );

    await sendLog(
      interaction.guild,
      "moderation",
      new EmbedBuilder()
        .setColor(0xe53935)
        .setTitle("Member banned")
        .addFields(
          { name: "Member", value: `${user.tag} (${user.id})` },
          { name: "Reason", value: reason },
          { name: "Appealable", value: appealable ? "Yes" : "No" },
          { name: "Deleted history", value: `${days} day(s)` },
          { name: "Moderator", value: `${interaction.user.tag} (${interaction.user.id})` },
          { name: "Record ID", value: note.id },
          { name: "DM delivered", value: delivered ? "Yes" : "No" },
        )
        .setTimestamp(),
    );

    await interaction.reply({
      content: `${user.tag} was banned.${dmResultSuffix(delivered)}`,
      ephemeral: true,
    });
  },
};

export const unbanCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Remove a user's server ban.")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption(o =>
      o.setName("user-id").setDescription("Banned user's Discord ID").setRequired(true).setMinLength(17).setMaxLength(20),
    )
    .addStringOption(o =>
      o.setName("reason").setDescription("Why the ban is being removed").setRequired(true).setMaxLength(1000),
    ),
  async execute(interaction) {
    if (!(await requireStaff(interaction)) || !interaction.inCachedGuild()) return;

    const userId = interaction.options.getString("user-id", true).trim();
    const reason = interaction.options.getString("reason", true);

    const ban = await interaction.guild.bans.fetch(userId).catch(() => null);
    if (!ban) {
      return void await interaction.reply({
        content: "That user is not currently banned.",
        ephemeral: true,
      });
    }

    await interaction.guild.members.unban(userId, reason);

    const user = await interaction.client.users.fetch(userId).catch(() => null);
    const delivered = user
      ? await sendStaffDM(
          user,
          `**Your ban from ${interaction.guild.name} has been removed.**\n` +
          `Reason: ${reason}`,
        )
      : false;

    const note = await addModNote(
      interaction.guild.id,
      userId,
      interaction.user.id,
      `Ban removed. Reason: ${reason}`,
      "note",
    );

    await sendLog(
      interaction.guild,
      "moderation",
      new EmbedBuilder()
        .setColor(0x66bb6a)
        .setTitle("Member unbanned")
        .addFields(
          { name: "Member", value: `${ban.user.tag} (${ban.user.id})` },
          { name: "Reason", value: reason },
          { name: "Moderator", value: `${interaction.user.tag} (${interaction.user.id})` },
          { name: "Record ID", value: note.id },
          { name: "DM delivered", value: delivered ? "Yes" : "No" },
        )
        .setTimestamp(),
    );

    await interaction.reply({
      content: `${ban.user.tag} was unbanned.${dmResultSuffix(delivered)}`,
      ephemeral: true,
    });
  },
};

export const softbanCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("softban")
    .setDescription("Ban and immediately unban a user to remove recent messages.")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o =>
      o.setName("user").setDescription("Member").setRequired(true),
    )
    .addStringOption(o =>
      o.setName("reason").setDescription("Reason").setRequired(true).setMaxLength(1000),
    )
    .addIntegerOption(o =>
      o.setName("delete-days")
        .setDescription("Delete message history from the last 0-7 days")
        .setMinValue(0)
        .setMaxValue(7),
    ),
  async execute(interaction) {
    if (!(await requireStaff(interaction)) || !interaction.inCachedGuild()) return;

    const user = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason", true);
    const days = interaction.options.getInteger("delete-days") ?? 1;

    const existingMember = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (existingMember && !existingMember.bannable) {
      return void await interaction.reply({
        content: "I cannot softban that member.",
        ephemeral: true,
      });
    }

    // Open the DM channel before the temporary ban to maximize delivery odds.
    const dmChannel = await user.createDM().catch(() => null);

    await interaction.guild.members.ban(user.id, {
      reason: `Softban: ${reason}`,
      deleteMessageSeconds: days * 86_400,
    });

    try {
      await interaction.guild.members.unban(user.id, `Softban completed: ${reason}`);
    } catch (error) {
      await sendLog(
        interaction.guild,
        "moderation",
        new EmbedBuilder()
          .setColor(0xe53935)
          .setTitle("Softban failed during unban")
          .setDescription("The temporary ban succeeded, but Keystone could not immediately remove it. Manual unban is required.")
          .addFields(
            { name: "Member", value: `${user.tag} (${user.id})` },
            { name: "Reason", value: reason },
            { name: "Moderator", value: `${interaction.user.tag} (${interaction.user.id})` },
          )
          .setTimestamp(),
      );

      return void await interaction.reply({
        content: `The ban succeeded, but the automatic unban failed. **${user.tag} is still banned and must be unbanned manually.**`,
        ephemeral: true,
      });
    }

    const delivered = dmChannel
      ? await dmChannel.send(
          `**You were softbanned from ${interaction.guild.name}.**\n` +
          `Reason: ${reason}\n` +
          `Your ban was immediately removed. You may rejoin the server.`,
        ).then(() => true).catch(() => false)
      : false;

    const note = await addModNote(
      interaction.guild.id,
      user.id,
      interaction.user.id,
      `${reason}\nDeleted history: ${days} day(s)`,
      "note",
    );

    await sendLog(
      interaction.guild,
      "moderation",
      new EmbedBuilder()
        .setColor(0xef9a4f)
        .setTitle("Member softbanned")
        .addFields(
          { name: "Member", value: `${user.tag} (${user.id})` },
          { name: "Reason", value: reason },
          { name: "Deleted history", value: `${days} day(s)` },
          { name: "Moderator", value: `${interaction.user.tag} (${interaction.user.id})` },
          { name: "Record ID", value: note.id },
          { name: "DM delivered", value: delivered ? "Yes" : "No" },
        )
        .setTimestamp(),
    );

    await interaction.reply({
      content: `${user.tag} was softbanned and immediately unbanned.${dmResultSuffix(delivered)}`,
      ephemeral: true,
    });
  },
};

export const dmCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("dm")
    .setDescription("Send a private staff message to a user through Keystone.")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o =>
      o.setName("user").setDescription("User to message").setRequired(true),
    )
    .addStringOption(o =>
      o.setName("message").setDescription("Message to send").setRequired(true).setMaxLength(1800),
    ),
  async execute(interaction) {
    if (!(await requireStaff(interaction)) || !interaction.inCachedGuild()) return;

    const user = interaction.options.getUser("user", true);
    const message = interaction.options.getString("message", true);

    const delivered = await sendStaffDM(
      user,
      `**Message from ${interaction.guild.name} Staff**\n${message}`,
    );

    await sendLog(
      interaction.guild,
      "moderation",
      new EmbedBuilder()
        .setColor(0x78909c)
        .setTitle("Staff DM sent")
        .addFields(
          { name: "Recipient", value: `${user.tag} (${user.id})` },
          { name: "Moderator", value: `${interaction.user.tag} (${interaction.user.id})` },
          { name: "Message", value: message },
          { name: "DM delivered", value: delivered ? "Yes" : "No" },
        )
        .setTimestamp(),
    );

    await interaction.reply({
      content: delivered
        ? `Message sent to ${user.tag}.`
        : `I could not DM ${user.tag}. They may have DMs disabled.`,
      ephemeral: true,
    });
  },
};

export const purgeCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Delete recent messages from this channel, optionally from one user.")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o =>
      o.setName("amount").setDescription("Number of recent messages to delete (1-100)").setRequired(true).setMinValue(1).setMaxValue(100),
    )
    .addUserOption(o =>
      o.setName("user").setDescription("Only delete recent messages from this user"),
    )
    .addStringOption(o =>
      o.setName("reason").setDescription("Why the messages are being removed").setMaxLength(1000),
    ),
  async execute(interaction) {
    if (!(await requireStaff(interaction)) || !interaction.inCachedGuild()) return;

    const channel = interaction.channel;
    if (
      !channel ||
      (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)
    ) {
      return void await interaction.reply({
        content: "This command can only be used in a standard server text channel.",
        ephemeral: true,
      });
    }

    const amount = interaction.options.getInteger("amount", true);
    const user = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason") ?? "No reason provided.";

    await interaction.deferReply({ ephemeral: true });

    const fetched = await channel.messages.fetch({ limit: 100 });
    const selected = fetched
      .filter(message => !message.pinned && (!user || message.author.id === user.id))
      .first(amount);

    const deleted = await channel.bulkDelete(selected, true);

    await sendLog(
      interaction.guild,
      "moderation",
      new EmbedBuilder()
        .setColor(0x78909c)
        .setTitle("Messages purged")
        .addFields(
          { name: "Channel", value: `${channel}` },
          { name: "Messages deleted", value: String(deleted.size) },
          { name: "Scope", value: user ? `${user.tag} (${user.id})` : "All recent messages" },
          { name: "Reason", value: reason },
          { name: "Moderator", value: `${interaction.user.tag} (${interaction.user.id})` },
        )
        .setTimestamp(),
    );

    await interaction.editReply(
      `Deleted **${deleted.size}** message(s)${user ? ` from ${user.tag}` : ""}.` +
      (deleted.size < amount
        ? " Some requested messages may have been too old for Discord bulk deletion or outside the 100 most recent messages."
        : ""),
    );
  },
};
