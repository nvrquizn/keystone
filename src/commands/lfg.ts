import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../lib/command.js";
import { getGuildSettings, updateGuildSettings } from "../storage/settings.js";
import { isLfgRecruitment } from "../features/lfg-core.js";

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
    .addSubcommand(sub => sub.setName("filter")
      .setDescription("Enable/disable removal of non-LFG chat posts in the configured channel.")
      .addBooleanOption(option => option.setName("enabled")
        .setDescription("Remove non-recruitment messages (requires Manage Messages)")
        .setRequired(true)))
    .addSubcommand(sub => sub.setName("check")
      .setDescription("Preview whether a sample message is a valid LFG request.")
      .addStringOption(option => option.setName("message")
        .setDescription("Message text to check before enabling deletion")
        .setRequired(true)))
    .addSubcommand(sub => sub.setName("status")
      .setDescription("Check channel, thread permissions and off-topic filtering.")),

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
        settings.lfg = { ...settings.lfg, enabled: true, channelId: channel.id };
      });
      console.log(`[lfg] Enabled in guild ${interaction.guildId} channel ${channel.id} by ${interaction.user.id}`);
      await interaction.reply({
        content: "LFG discussion threads enabled in " + channel.toString() +
          ". Keystone creates threads only for recognisable LFG requests (the template or a clear invitation). " +
          "General chat won't generate threads. Non-LFG deletion: **" +
          ((await getGuildSettings(interaction.guildId)).lfg.deleteOffTopic ? "enabled" : "disabled") +
          "** (control with `/lfg filter`). Existing posts are unchanged. Threads auto-archive after 24 hours.",
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

    if (sub === "check") {
      const sample = interaction.options.getString("message", true);
      await interaction.reply({
        content: (isLfgRecruitment(sample) ? "✅ LFG post: a thread would be created." :
          "❌ Not recognised as an LFG request: no thread would be created; it would be removed if filtering is enabled.") +
          "\nThis is only a preview. No messages were deleted.",
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
    if (sub === "filter") {
      const enabled = interaction.options.getBoolean("enabled", true);
      if (!config.enabled || channel?.type !== ChannelType.GuildText) {
        await interaction.reply({
          content: "Enable LFG in a valid text channel with `/lfg enable` first.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (enabled && !permissions?.has(PermissionFlagsBits.ManageMessages)) {
        await interaction.reply({
          content: "Keystone needs **Manage Messages** in " + channel.toString() +
            " to remove regular chat. Update its permissions first.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await updateGuildSettings(interaction.guildId, settings => {
        settings.lfg.deleteOffTopic = enabled;
      });
      await interaction.reply({
        content: "Non-LFG message removal is now **" + (enabled ? "enabled" : "disabled") + "** in " +
          channel.toString() + ". Valid LFG posts still receive threads. " +
          (enabled ? "Other member messages will be deleted, with a private explanation (at most once per 10 minutes per member). Staff/pinned instructions are exempt." : "Off-topic member messages will be ignored, not deleted."),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const checks = [
      ["LFG enabled", config.enabled],
      ["Configured text channel exists", channel?.type === ChannelType.GuildText],
      ["Keystone can view the channel", permissions?.has(PermissionFlagsBits.ViewChannel) ?? false],
      ["Keystone can read message history", permissions?.has(PermissionFlagsBits.ReadMessageHistory) ?? false],
      ["Keystone can create public threads", permissions?.has(PermissionFlagsBits.CreatePublicThreads) ?? false],
      ["Keystone can delete off-topic messages", permissions?.has(PermissionFlagsBits.ManageMessages) ?? false],
    ] as const;
    await interaction.reply({
      content: "**LFG auto-thread status**\n" +
        checks.map(([name, okay]) => (okay ? "✅ " : "❌ ") + name).join("\n") +
        "\nChannel: " + (config.channelId ? "<#" + config.channelId + ">" : "Not configured") +
        "\nDelete non-LFG messages: **" + (config.deleteOffTopic ? "enabled" : "disabled") + "**" +
        "\nMember replies require their own permission to **Send Messages in Threads**.",
      allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral,
    });
  },
};
