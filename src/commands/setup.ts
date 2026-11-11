import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../lib/command.js";
import { requireStaff } from "../lib/permissions.js";
import { updateGuildSettings } from "../storage/settings.js";
import type { LogKind } from "../storage/schema.js";
import { syncRoleMappingsForMember } from "../features/role-mapping.js";

const logChoices = ["general", "moderation", "tickets", "joinLeave", "messages", "members", "channels", "roles", "voice", "server", "reactions", "invites"] as const;

export const setupCommand: BotCommand = {
  data: new SlashCommandBuilder().setName("setup").setDescription("Configure FERAL bot systems.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s => s.setName("log").setDescription("Set a log channel")
      .addStringOption(o => o.setName("type").setDescription("Log type").setRequired(true).addChoices(...logChoices.map(v => ({ name: v, value: v }))))
      .addChannelOption(o => o.setName("channel").setDescription("Log channel").addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s => s.setName("leveling").setDescription("Enable or disable leveling")
      .addBooleanOption(o => o.setName("enabled").setDescription("Whether XP/levels are enabled").setRequired(true)))
    .addSubcommand(s => s.setName("level-channel").setDescription("Set the channel used for level-up announcements")
      .addChannelOption(o => o.setName("channel").setDescription("Channel for level-up announcements").addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s => s.setName("tier").setDescription("Add or replace a level tier")
      .addIntegerOption(o => o.setName("level").setDescription("Required level").setRequired(true).setMinValue(0).setMaxValue(1000))
      .addRoleOption(o => o.setName("role").setDescription("Role granted at this tier").setRequired(true))
      .addStringOption(o => o.setName("name").setDescription("Display name, e.g. T3 — Fox").setRequired(true).setMaxLength(100))
        .addStringOption(o => o.setName("unlocks").setDescription("What this tier unlocks").setRequired(false).setMaxLength(1000)))
    .addSubcommand(s => s.setName("media").setDescription("Configure a channel's media unlock level")
      .addChannelOption(o => o.setName("channel").setDescription("Channel to protect").addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addIntegerOption(o => o.setName("unlock-level").setDescription("Level where media unlocks").setRequired(true).setMinValue(1).setMaxValue(1000)))
    .addSubcommand(s => s.setName("tickets").setDescription("Configure ticket category/staff access")
      .addChannelOption(o => o.setName("category").setDescription("Ticket category").addChannelTypes(ChannelType.GuildCategory).setRequired(true))
      .addRoleOption(o => o.setName("staff-role").setDescription("Staff role that can access tickets").setRequired(true)))
    .addSubcommand(s => s.setName("selfrole-add").setDescription("Allow members to assign themselves a role")
      .addRoleOption(o => o.setName("role").setDescription("Self-assignable role").setRequired(true)))
    .addSubcommand(s => s.setName("selfrole-remove").setDescription("Remove a role from the self-role panel")
      .addRoleOption(o => o.setName("role").setDescription("Role to remove").setRequired(true)))
    .addSubcommand(s => s.setName("role-map").setDescription("Give a target role whenever a member has a trigger role")
      .addRoleOption(o => o.setName("trigger").setDescription("If the member has this role").setRequired(true))
      .addRoleOption(o => o.setName("target").setDescription("Keystone gives this role").setRequired(true))
      .addBooleanOption(o => o.setName("remove-with-trigger").setDescription("Remove the target role if the trigger role is removed (default: yes)")))
    .addSubcommand(s => s.setName("role-unmap").setDescription("Remove a role mapping")
      .addRoleOption(o => o.setName("trigger").setDescription("Trigger role").setRequired(true))
      .addRoleOption(o => o.setName("target").setDescription("Target role").setRequired(true))),
  async execute(interaction) {
    if (!(await requireStaff(interaction)) || !interaction.inCachedGuild()) return;
    const sub = interaction.options.getSubcommand();

    if (sub === "log") {
      const type = interaction.options.getString("type", true) as LogKind;
      const channel = interaction.options.getChannel("channel", true);
      await updateGuildSettings(interaction.guild.id, s => { s.logs[type] = channel.id; });
      await interaction.reply({ content: `${type} logs will be sent to ${channel}.`, ephemeral: true });
      return;
    }
    if (sub === "leveling") {
      const enabled = interaction.options.getBoolean("enabled", true);
      await updateGuildSettings(interaction.guild.id, s => { s.leveling.enabled = enabled; });
      await interaction.reply({ content: `Leveling ${enabled ? "enabled" : "disabled"}.`, ephemeral: true });
      return;
    }
    if (sub === "level-channel") {
      const channel = interaction.options.getChannel("channel", true);
      await updateGuildSettings(interaction.guild.id, s => { s.leveling.announcementChannelId = channel.id; });
      await interaction.reply({ content: `Level-up announcements will be sent to ${channel}.`, ephemeral: true });
      return;
    }
    if (sub === "tier") {
      const level = interaction.options.getInteger("level", true);
      const role = interaction.options.getRole("role", true);
      const name = interaction.options.getString("name", true);
      const unlocks = interaction.options.getString("unlocks");

      await updateGuildSettings(interaction.guild.id, s => {
        const existing = s.leveling.tiers.find(
          t => t.level === level || t.roleId === role.id
        );

        s.leveling.tiers = s.leveling.tiers.filter(
          t => t.level !== level && t.roleId !== role.id
        );

        s.leveling.tiers.push({
          level,
          roleId: role.id,
          name,
          unlocks: unlocks ?? existing?.unlocks,
        });

        s.leveling.tiers.sort((a, b) => a.level - b.level);
      });

      await interaction.reply({
        content: `Configured **${name}** at level ${level}.`,
        ephemeral: true,
      });
      return;
    }
    if (sub === "media") {
      const channel = interaction.options.getChannel("channel", true);
      if (channel.type !== ChannelType.GuildText) return void await interaction.reply({ content: "Choose a text channel.", ephemeral: true });
      const unlockLevel = interaction.options.getInteger("unlock-level", true);
      const settings = await updateGuildSettings(interaction.guild.id, s => { s.media[channel.id] = { unlockLevel }; });
      const mediaPerms = { AttachFiles: false, EmbedLinks: false, UseExternalEmojis: false, UseExternalStickers: false } as const;
      await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, mediaPerms);
      for (const tier of settings.leveling.tiers) {
        if (tier.level >= unlockLevel) {
          await channel.permissionOverwrites.edit(tier.roleId, { AttachFiles: true, EmbedLinks: true, UseExternalEmojis: true, UseExternalStickers: true });
        }
      }
      await interaction.reply({ content: `Media in ${channel} now unlocks at level ${unlockLevel}.`, ephemeral: true });
      return;
    }
    if (sub === "tickets") {
      const category = interaction.options.getChannel("category", true);
      const role = interaction.options.getRole("staff-role", true);
      await updateGuildSettings(interaction.guild.id, s => {
        s.tickets.categoryId = category.id;
        if (!s.tickets.staffRoleIds.includes(role.id)) s.tickets.staffRoleIds.push(role.id);
      });
      await interaction.reply({ content: `Ticket category set to **${category.name}** with ${role} as a staff role.`, ephemeral: true });
      return;
    }
    if (sub === "selfrole-add") {
      const role = interaction.options.getRole("role", true);
      if (role.id === interaction.guild.roles.everyone.id || role.managed) {
        return void await interaction.reply({ content: "That role cannot be used as a self role.", ephemeral: true });
      }
      const me = interaction.guild.members.me;
      if (!me || role.position >= me.roles.highest.position) {
        return void await interaction.reply({ content: "Move Keystone's bot role above that role first.", ephemeral: true });
      }
      const settings = await updateGuildSettings(interaction.guild.id, s => {
        if (!s.selfRoles.includes(role.id)) s.selfRoles.push(role.id);
      });
      if (settings.selfRoles.length > 25) {
        await updateGuildSettings(interaction.guild.id, s => { s.selfRoles = s.selfRoles.filter(id => id !== role.id); });
        return void await interaction.reply({ content: "A self-role panel can contain at most 25 roles.", ephemeral: true });
      }
      await interaction.reply({ content: `${role} is now available as a self role. Repost the panel with \`/selfroles panel\` to update it.`, ephemeral: true });
      return;
    }
    if (sub === "selfrole-remove") {
      const role = interaction.options.getRole("role", true);
      await updateGuildSettings(interaction.guild.id, s => { s.selfRoles = s.selfRoles.filter(id => id !== role.id); });
      await interaction.reply({ content: `${role} was removed from the self-role configuration. Repost the panel to update it.`, ephemeral: true });
      return;
    }
    if (sub === "role-map") {
      const trigger = interaction.options.getRole("trigger", true);
      const target = interaction.options.getRole("target", true);
      const removeWithTrigger = interaction.options.getBoolean("remove-with-trigger") ?? true;
      if (trigger.id === target.id) return void await interaction.reply({ content: "Trigger and target roles must be different.", ephemeral: true });
      if (target.managed || target.id === interaction.guild.roles.everyone.id) return void await interaction.reply({ content: "Keystone cannot assign that target role.", ephemeral: true });
      const me = interaction.guild.members.me;
      if (!me || target.position >= me.roles.highest.position) return void await interaction.reply({ content: "Move Keystone's bot role above the target role first.", ephemeral: true });
      await updateGuildSettings(interaction.guild.id, s => {
        s.roleMappings = s.roleMappings.filter(m => !(m.triggerRoleId === trigger.id && m.targetRoleId === target.id));
        s.roleMappings.push({ triggerRoleId: trigger.id, targetRoleId: target.id, removeWithTrigger });
      });
      const members = await interaction.guild.members.fetch().catch(() => interaction.guild.members.cache);
      for (const member of members.values()) if (member.roles.cache.has(trigger.id)) await syncRoleMappingsForMember(member);
      await interaction.reply({ content: `Configured ${trigger} → ${target}.${removeWithTrigger ? " The target role will also be removed when the trigger role is removed." : " The target role will remain if the trigger role is later removed."}`, ephemeral: true });
      return;
    }
    if (sub === "role-unmap") {
      const trigger = interaction.options.getRole("trigger", true);
      const target = interaction.options.getRole("target", true);
      await updateGuildSettings(interaction.guild.id, s => {
        s.roleMappings = s.roleMappings.filter(m => !(m.triggerRoleId === trigger.id && m.targetRoleId === target.id));
      });
      await interaction.reply({ content: `Removed the ${trigger} → ${target} mapping.`, ephemeral: true });
    }
  },
};
