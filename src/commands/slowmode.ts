import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { BotCommand } from "../lib/command.js";

const MAX_SECONDS = 21600; // Discord's 6-hour limit

function parseDuration(raw: string): number | null {
  const value = raw.toLowerCase().replace(/\s+/g, "");

  if (value === "off" || value === "0") return 0;

  const parts = value.match(/\d+[hms]/g);
  if (!parts || parts.join("") !== value) return null;

  let total = 0;

  for (const part of parts) {
    const amount = Number(part.slice(0, -1));
    const unit = part.slice(-1);

    if (!Number.isSafeInteger(amount)) return null;

    const multiplier =
      unit === "h" ? 3600 :
      unit === "m" ? 60 : 1;

    total += amount * multiplier;

    if (total > MAX_SECONDS) return null;
  }

  return total;
}

function formatDuration(seconds: number): string {
  if (seconds === 0) return "0 seconds";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;

  return [
    hours ? `${hours}h` : "",
    minutes ? `${minutes}m` : "",
    remaining ? `${remaining}s` : "",
  ].filter(Boolean).join(" ");
}

export const slowmodeCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Set or disable channel slowmode.")
    .setDMPermission(false)
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageChannels
    )
    .addStringOption(option =>
      option
        .setName("time")
        .setDescription("Examples: 5s, 45s, 2m30s, 1h, 0s")
        .setRequired(true)
    )
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("Defaults to the current channel")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;

    if (!interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageChannels
    )) {
      await interaction.reply({
        content: "You need Manage Channels to use this command.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const input = interaction.options.getString("time", true);
    const seconds = parseDuration(input);

    if (seconds === null) {
      await interaction.reply({
        content:
          "Invalid duration. Try `5s`, `45s`, `2m30s`, " +
          "`1h15m`, or `0s` to disable. Maximum: 6 hours.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const channel =
      interaction.options.getChannel("channel") ??
      interaction.channel;

    if (!channel || channel.type !== ChannelType.GuildText) {
      await interaction.reply({
        content: "Please select a standard text channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    try {
      const bot = interaction.guild.members.me ??
        await interaction.guild.members.fetchMe();

      if (!channel.permissionsFor(bot)?.has(
        PermissionFlagsBits.ManageChannels
      )) {
        await interaction.editReply(
          "I need Manage Channels permission in that channel."
        );
        return;
      }

      await channel.setRateLimitPerUser(
        seconds,
        `Changed by ${interaction.user.tag}`
      );

      await interaction.editReply(
        seconds === 0
          ? `Slowmode disabled in ${channel}.`
          : `Slowmode set to **${formatDuration(seconds)}** in ${channel}.`
      );
    } catch (error) {
      console.error("[slowmode]", error);

      await interaction.editReply(
        "Unable to change slowmode. Check my permissions."
      );
    }
  },
};
