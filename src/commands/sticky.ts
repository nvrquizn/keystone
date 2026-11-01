import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../lib/command.js";
import { requireStaff } from "../lib/permissions.js";
import { setSticky, removeSticky, showSticky } from "../features/stickies.js";

export const stickyCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("sticky")
    .setDescription("Manage sticky messages.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand(s => s.setName("set").setDescription("Create or replace a sticky message")
      .addChannelOption(o => o.setName("channel").setDescription("Channel").addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption(o => o.setName("message").setDescription("Sticky text").setRequired(true).setMaxLength(4000))
      .addStringOption(o => o.setName("title").setDescription("Optional embed title").setMaxLength(256))
      .addStringOption(o => o.setName("color").setDescription("Optional hex color")))
    .addSubcommand(s => s.setName("remove").setDescription("Remove a sticky message")
      .addChannelOption(o => o.setName("channel").setDescription("Channel").addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s => s.setName("show").setDescription("Show the configured sticky for a channel")
      .addChannelOption(o => o.setName("channel").setDescription("Channel").addChannelTypes(ChannelType.GuildText).setRequired(true))),
  async execute(interaction) {
    if (!(await requireStaff(interaction))) return;
    if (!interaction.inCachedGuild()) return;
    const sub = interaction.options.getSubcommand();
    const channel = interaction.options.getChannel("channel", true);
    if (!channel.isTextBased() || channel.isDMBased()) return void await interaction.reply({ content: "Choose a server text channel.", ephemeral: true });
    if (sub === "set") {
      await setSticky(interaction.guild, channel, {
        content: interaction.options.getString("message", true),
        title: interaction.options.getString("title") ?? undefined,
        color: interaction.options.getString("color") ?? undefined,
      });
      await interaction.reply({ content: `Sticky message configured in ${channel}.`, ephemeral: true });
    } else if (sub === "remove") {
      await removeSticky(interaction.guild.id, channel.id, channel);
      await interaction.reply({ content: `Sticky message removed from ${channel}.`, ephemeral: true });
    } else {
      const sticky = await showSticky(interaction.guild.id, channel.id);
      await interaction.reply({ content: sticky ? `Sticky is configured for ${channel}.\n${sticky.content ?? ""}` : `No sticky is configured for ${channel}.`, ephemeral: true });
    }
  },
};
