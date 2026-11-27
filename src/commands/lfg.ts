import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../lib/command.js";
import { getGuildSettings, updateGuildSettings } from "../storage/settings.js";

export const lfgCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("lfg")
    .setDescription("Configure automatic discussion threads for Looking for Group posts.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub.setName("enable")
      .setDescription("Create a discussion thread for each new member message in a text channel.")
      .addChannelOption(option => option.setName("channel")
        .setDescription("The Looking for Group text channel")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)))
    .addSubcommand(sub => sub.setName("disable")
      .setDescription("Stop creating new LFG threads. Existing threads are unchanged."))
    .addSubcommand(sub => sub.setName("status")
      .setDescription("Check the configured channel and whether Keystone can create threads.")),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: "Administrator permission required.", flags: MessageFlags.Ephemeral });
      return;
    }
    const sub = interaction.options.getSubcommand();
    if (sub === "enable") {
      const selected = interaction.options.getChannel("channel", true);
      const channel = await interaction.guild.channels.fetch(selected.id).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText) {
        await interaction.reply({ content: "Choose a normal text channel, not a forum or thread.", flags: MessageFlags.Ephemeral });
        return;
      }
      const me = await interaction.guild.members.fetchMe();
      const permissions = channel.permissionsFor(me);
      const required = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.CreatePublicThreads,
      ];
      if (!permissions || !required.every(permission => permissions.has(permission))) {
        await interaction.reply({
          content: "Keystone needs **View Channel**, **Read Message History**, and **Create Public Threads** in " +
            channel.toString() + " before this feature can be enabled.",
          allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await updateGuildSettings(interaction.guildId, settings => {
        settings.lfg = { enabled: true, channelId: channel.id };
      });
      console.log(`[lfg] Enabled in guild ${interaction.guildId} channel ${channel.id} by ${interaction.user.id}`);
      await interaction.reply({
        content: "LFG discussion threads enabled in " + channel.toString() +
          ". Every new top-level member message will start its own public thread. Replies stay inside that thread. " +
          "Existing posts are unchanged. Inactive threads auto-archive after 24 hours.",
        allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === "disable") {
      await updateGuildSettings(interaction.guildId, settings => { settings.lfg.enabled = false; });
      await interaction.reply({
        content: "LFG auto-threads disabled. Existing posts and threads are unchanged.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const config = (await getGuildSettings(interaction.guildId)).lfg;
    const channel = config.channelId
      ? await interaction.guild.channels.fetch(config.channelId).catch(() => null)
      : null;
    const me = await interaction.guild.members.fetchMe();
    const permissions = channel?.type === ChannelType.GuildText ? channel.permissionsFor(me) : null;
    const checks = [
      ["LFG enabled", config.enabled],
      ["Configured text channel exists", channel?.type === ChannelType.GuildText],
      ["Keystone can view the channel", permissions?.has(PermissionFlagsBits.ViewChannel) ?? false],
      ["Keystone can read message history", permissions?.has(PermissionFlagsBits.ReadMessageHistory) ?? false],
      ["Keystone can create public threads", permissions?.has(PermissionFlagsBits.CreatePublicThreads) ?? false],
    ] as const;
    await interaction.reply({
      content: "**LFG auto-thread status**\n" +
        checks.map(([name, okay]) => (okay ? "✅ " : "❌ ") + name).join("\n") +
        "\nChannel: " + (config.channelId ? "<#" + config.channelId + ">" : "Not configured") +
        "\nMember replies require their own permission to **Send Messages in Threads**.",
      allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral,
    });
  },
};
