import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../lib/command.js";
import { requireStaff } from "../lib/permissions.js";
import { postSelfRolePanel } from "../features/selfroles.js";

export const selfRolesCommand: BotCommand = {
  data: new SlashCommandBuilder().setName("selfroles").setDescription("Self-role panel tools.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand(s => s.setName("panel").setDescription("Post the self-role selection panel")
      .addChannelOption(o => o.setName("channel").setDescription("Channel for the panel").addChannelTypes(ChannelType.GuildText).setRequired(true))),
  async execute(interaction) {
    if (!(await requireStaff(interaction)) || !interaction.inCachedGuild()) return;
    const selected = interaction.options.getChannel("channel", true);
    const channel = await interaction.guild.channels.fetch(selected.id).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) return void await interaction.reply({ content: "Choose a text channel.", ephemeral: true });
    await postSelfRolePanel(channel);
    await interaction.reply({ content: `Self-role panel sent in ${channel}.`, ephemeral: true });
  },
};
