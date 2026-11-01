import { ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../lib/command.js";
import { requireStaff } from "../lib/permissions.js";
import { ticketPanelComponents } from "../features/tickets.js";

export const ticketCommand: BotCommand = {
  data: new SlashCommandBuilder().setName("ticket").setDescription("Ticket system tools.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand(s => s.setName("panel").setDescription("Send the ticket panel")
      .addChannelOption(o => o.setName("channel").setDescription("Channel for the panel").addChannelTypes(ChannelType.GuildText).setRequired(true))),
  async execute(interaction) {
    if (!(await requireStaff(interaction))) return;
    const selectedChannel = interaction.options.getChannel("channel", true);
    const channel = await interaction.guild?.channels.fetch(selectedChannel.id);
    if (!channel || channel.type !== ChannelType.GuildText || !channel.isSendable()) {
      return void await interaction.reply({ content: "Choose a server text channel.", ephemeral: true });
    }
    await channel.send({
      embeds: [new EmbedBuilder().setColor(0x7f9a8c).setTitle("Support tickets").setDescription("Open a ticket if you need help from server staff.")],
      components: ticketPanelComponents(),
    });
    await interaction.reply({ content: `Ticket panel sent in ${channel}.`, ephemeral: true });
  },
};
