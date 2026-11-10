import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

import type {
  TextChannel,
} from "discord.js";

import type {
  BotCommand,
} from "../lib/command.js";

import {
  requireStaff,
} from "../lib/permissions.js";

function looksLikeTicket(
  channel: TextChannel,
): boolean {
  const label = (
    channel.name +
    " " +
    (channel.topic ?? "") +
    " " +
    (channel.parent?.name ?? "")
  ).toLowerCase();

  if (
    label.includes("ticket")
  ) {
    return true;
  }

  const everyone =
    channel.permissionOverwrites
      .cache
      .get(
        channel.guild.roles
          .everyone.id,
      );

  return (
    everyone?.deny.has(
      PermissionFlagsBits.ViewChannel,
    ) ?? false
  );
}

export const ticketAddCommand:
  BotCommand = {

  data: new SlashCommandBuilder()
    .setName("ticketadd")
    .setDescription(
      "Add a member to the current private ticket.",
    )
    .setDMPermission(false)
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ModerateMembers,
    )
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription(
          "Member to pull into this ticket",
        )
        .setRequired(true),
    ),

  async execute(interaction) {
    if (
      !(await requireStaff(interaction)) ||
      !interaction.inCachedGuild()
    ) {
      return;
    }

    const channel =
      interaction.channel;

    if (
      !channel ||
      channel.type !==
        ChannelType.GuildText
    ) {
      await interaction.reply({
        content:
          "Use this command inside a text ticket channel.",
        ephemeral: true,
      });

      return;
    }

    if (
      !looksLikeTicket(channel)
    ) {
      await interaction.reply({
        content:
          "This channel does not appear to be a private ticket.",
        ephemeral: true,
      });

      return;
    }

    const user =
      interaction.options.getUser(
        "user",
        true,
      );

    if (user.bot) {
      await interaction.reply({
        content:
          "Bots cannot be pulled into tickets with this command.",
        ephemeral: true,
      });

      return;
    }

    const member =
      await interaction.guild.members
        .fetch(user.id)
        .catch(() => null);

    if (!member) {
      await interaction.reply({
        content:
          "That user is not currently in the server.",
        ephemeral: true,
      });

      return;
    }

    const existing =
      channel.permissionOverwrites
        .cache
        .get(member.id);

    if (
      existing?.allow.has(
        PermissionFlagsBits.ViewChannel,
      )
    ) {
      await interaction.reply({
        content:
          `${user.tag} already has access to this ticket.`,
        ephemeral: true,
      });

      return;
    }

    await channel
      .permissionOverwrites
      .edit(
        member,
        {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          AttachFiles: true,
          EmbedLinks: true,
        },
        {
          reason:
            `Added to ticket by ${interaction.user.tag} (${interaction.user.id})`,
        },
      );

    await channel.send({
      content:
        `<@${user.id}> has been added to this ticket by <@${interaction.user.id}>.`,

      allowedMentions: {
        users: [
          user.id,
          interaction.user.id,
        ],
      },
    });

    await interaction.reply({
      content:
        `Added ${user.tag} to ${channel}.`,
      ephemeral: true,
    });
  },
};
