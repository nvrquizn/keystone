import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../lib/command.js";

import { getGuildSettings, updateGuildSettings } from "../storage/settings.js";

export const forumGuardCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("forumguard")
    .setDescription("Configure advisory moderation for a Game Ideas forum.")
    .setDefaultMemberPermissions(null)
    .addSubcommand(sub => sub.setName("enable").setDescription("Watch a forum and send review alerts.")
      .addChannelOption(option => option.setName("forum").setDescription("Game Ideas forum")
        .addChannelTypes(ChannelType.GuildForum).setRequired(true))
      .addChannelOption(option => option.setName("logs").setDescription("Private staff review channel")
        .addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addBooleanOption(option => option.setName("remind").setDescription("Post a gentle reminder for similar titles (default: no)"))
      .addBooleanOption(option => option.setName("bump_remind").setDescription("Reply to bump-only messages (default: yes)")))
    .addSubcommand(sub => sub.setName("disable").setDescription("Stop monitoring the forum."))
    .addSubcommand(sub => sub.setName("status").setDescription("Show the current configuration."))
    .addSubcommand(sub => sub.setName("diagnose").setDescription("Check ForumGuard configuration and channel access.")),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const staffRole = interaction.guild.roles.cache.find(role => role.name.toLowerCase() === "staff");
    const authorized = Boolean(
      interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
      interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers) ||
      (staffRole && interaction.member.roles.cache.has(staffRole.id))
    );
    if (!authorized) {
      await interaction.reply({ content: "Staff access required.", flags: MessageFlags.Ephemeral });
      return;
    }
    const sub = interaction.options.getSubcommand();
    if (sub === "enable") {
      const forum = interaction.options.getChannel("forum", true);
      const logs = interaction.options.getChannel("logs", true);
      if (forum.id === logs.id) {
        await interaction.reply({ content: "Use a separate staff-only text channel for logs.", flags: MessageFlags.Ephemeral });
        return;
      }
      // Checking visibility reduces the risk of publicly posting review alerts.
      const channel = await interaction.guild.channels.fetch(logs.id);
      if (!channel || channel.type !== ChannelType.GuildText ||
          channel.permissionsFor(interaction.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)) {
        await interaction.reply({ content: "Choose a staff-only log channel hidden from @everyone.", flags: MessageFlags.Ephemeral });
        return;
      }
      const publicDuplicateReminder = interaction.options.getBoolean("remind") ?? false;
      const publicBumpReminder = interaction.options.getBoolean("bump_remind") ?? true;
      await updateGuildSettings(interaction.guildId, settings => {
        settings.forumGuard = { enabled: true, forumChannelId: forum.id, logChannelId: logs.id, publicDuplicateReminder, publicBumpReminder };
      });
      await interaction.reply({
        content: "ForumGuard enabled for <#" + forum.id + ">. Review alerts go to <#" + logs.id +
          ">. Public duplicate reminders: **" + (publicDuplicateReminder ? "on" : "off") +
          "**. Bump-only reminders: **" + (publicBumpReminder ? "on" : "off") +
          "**. No automatic warnings, timeouts, or deletions.",
        allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (sub === "disable") {
      await updateGuildSettings(interaction.guildId, settings => { settings.forumGuard.enabled = false; });
      await interaction.reply({ content: "ForumGuard disabled. Existing forum content is unchanged.", flags: MessageFlags.Ephemeral });
      return;
    }
    const settings = (await getGuildSettings(interaction.guildId)).forumGuard;
    if (sub === "diagnose") {
      const forum = settings.forumChannelId ? await interaction.guild.channels.fetch(settings.forumChannelId) : null;
      const logs = settings.logChannelId ? await interaction.guild.channels.fetch(settings.logChannelId) : null;
      const me = await interaction.guild.members.fetchMe();
      const forumPerms = forum?.type === ChannelType.GuildForum ? forum.permissionsFor(me) : null;
      const logPerms = logs?.type === ChannelType.GuildText ? logs.permissionsFor(me) : null;
      const checks = [
        ["ForumGuard enabled", settings.enabled],
        ["Configured forum exists", forum?.type === ChannelType.GuildForum],
        ["Can view the forum", forumPerms?.has(PermissionFlagsBits.ViewChannel) ?? false],
        ["Can read forum history", forumPerms?.has(PermissionFlagsBits.ReadMessageHistory) ?? false],
        ["Can reply within forum threads", forumPerms?.has(PermissionFlagsBits.SendMessagesInThreads) ?? false],
        ["Configured staff log exists", logs?.type === ChannelType.GuildText],
        ["Can view staff logs", logPerms?.has(PermissionFlagsBits.ViewChannel) ?? false],
        ["Can send staff logs", logPerms?.has(PermissionFlagsBits.SendMessages) ?? false],
      ] as const;
      await interaction.reply({
        content: "**ForumGuard diagnostics**\n" +
          checks.map(([label, passed]) => (passed ? "✅ " : "❌ ") + label).join("\n") +
          "\nForum: " + (settings.forumChannelId ? "<#" + settings.forumChannelId + ">" : "Not set") +
          "\nStaff logs: " + (settings.logChannelId ? "<#" + settings.logChannelId + ">" : "Not set") +
          "\nBump-only reminders: **" + (settings.publicBumpReminder ? "on" : "off") + "**" +
          "\nNote: This checks configuration and permissions, not whether Discord has delivered a particular thread event.",
        allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      content: "ForumGuard: **" + (settings.enabled ? "enabled" : "disabled") +
        "**\nForum: " + (settings.forumChannelId ? "<#" + settings.forumChannelId + ">" : "Not set") +
        "\nStaff logs: " + (settings.logChannelId ? "<#" + settings.logChannelId + ">" : "Not set") +
        "\nPublic duplicate reminders: **" + (settings.publicDuplicateReminder ? "on" : "off") +
        "**\nBump-only reminders: **" + (settings.publicBumpReminder ? "on" : "off") + "**",
      allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral,
    });
  },
};
