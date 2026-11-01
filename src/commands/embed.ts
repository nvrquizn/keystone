import { ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../lib/command.js";
import { requireStaff } from "../lib/permissions.js";

function parseColor(value?: string | null): number {
  const raw = (value ?? "#7F9A8C").replace("#", "");
  const parsed = Number.parseInt(raw, 16);
  return Number.isFinite(parsed) ? parsed : 0x7f9a8c;
}

export const embedCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Send a custom embed.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addChannelOption(o => o.setName("channel").setDescription("Channel to send the embed in").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
    .addStringOption(o => o.setName("description").setDescription("Embed body").setRequired(true).setMaxLength(4000))
    .addStringOption(o => o.setName("title").setDescription("Optional title").setMaxLength(256))
    .addStringOption(o => o.setName("color").setDescription("Hex color, e.g. #7F9A8C"))
    .addStringOption(o => o.setName("footer").setDescription("Optional footer").setMaxLength(2048))
    .addStringOption(o => o.setName("image").setDescription("Optional image URL"))
    .addStringOption(o => o.setName("thumbnail").setDescription("Optional thumbnail URL")),
  async execute(interaction) {
    if (!(await requireStaff(interaction))) return;
    const selectedChannel = interaction.options.getChannel("channel", true);
    const channel = await interaction.guild?.channels.fetch(selectedChannel.id);
    if (
      !channel ||
      (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) ||
      !channel.isSendable()
    ) {
      return void await interaction.reply({ content: "Choose a server text channel.", ephemeral: true });
    }
    const embed = new EmbedBuilder()
      .setColor(parseColor(interaction.options.getString("color")))
      .setDescription(interaction.options.getString("description", true));
    const title = interaction.options.getString("title");
    const footer = interaction.options.getString("footer");
    const image = interaction.options.getString("image");
    const thumbnail = interaction.options.getString("thumbnail");
    if (title) embed.setTitle(title);
    if (footer) embed.setFooter({ text: footer });
    if (image) embed.setImage(image);
    if (thumbnail) embed.setThumbnail(thumbnail);
    await channel.send({ embeds: [embed] });
    await interaction.reply({ content: `Embed sent in ${channel}.`, ephemeral: true });
  },
};
