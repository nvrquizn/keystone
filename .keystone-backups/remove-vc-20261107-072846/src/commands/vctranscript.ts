import {
  AttachmentBuilder,
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { BotCommand } from "../lib/command.js";
import { requireStaff } from "../lib/permissions.js";
import {
  activeVoiceTranscript,
  configureAutoTranscript,
  configureVoiceLogChannel,
  getVoiceLogChannelId,
  isAutoTranscriptEnabled,
  keepVoiceTranscript,
  recentVoiceSessions,
  removeVoiceTranscript,
  renderVoiceTranscript,
  startVoiceTranscript,
  stopVoiceTranscript,
} from "../voice-transcripts/runtime.js";

function voiceChannelFromInteraction(interaction: ChatInputCommandInteraction<"cached">) {
  const selected = interaction.options.getChannel("channel");
  if (selected) return selected.type === ChannelType.GuildVoice ? selected : null;
  if (!interaction.inCachedGuild()) return null;
  return interaction.member.voice.channel;
}

export const vcTranscriptCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("vctranscript")
    .setDescription("Manage Keystone voice-channel transcription.")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand(sub =>
      sub.setName("set-log")
        .setDescription("Set the private staff channel used for VC transcript reviews.")
        .addChannelOption(o =>
          o.setName("channel").setDescription("Private transcript log channel").addChannelTypes(ChannelType.GuildText).setRequired(true),
        ),
    )
    .addSubcommand(sub =>
      sub.setName("auto")
        .setDescription("Turn automatic transcription on or off for a voice channel.")
        .addChannelOption(o =>
          o.setName("channel").setDescription("Voice channel").addChannelTypes(ChannelType.GuildVoice).setRequired(true),
        )
        .addBooleanOption(o => o.setName("enabled").setDescription("Whether auto-transcription is enabled").setRequired(true)),
    )
    .addSubcommand(sub =>
      sub.setName("start")
        .setDescription("Start a VC transcript manually.")
        .addChannelOption(o => o.setName("channel").setDescription("Voice channel (defaults to your current VC)").addChannelTypes(ChannelType.GuildVoice))
        .addStringOption(o => o.setName("reason").setDescription("Why this session is being transcribed").setMaxLength(500)),
    )
    .addSubcommand(sub =>
      sub.setName("stop")
        .setDescription("Stop an active VC transcript.")
        .addChannelOption(o => o.setName("channel").setDescription("Voice channel (defaults to your current VC)").addChannelTypes(ChannelType.GuildVoice)),
    )
    .addSubcommand(sub =>
      sub.setName("status")
        .setDescription("Show transcription status for a voice channel.")
        .addChannelOption(o => o.setName("channel").setDescription("Voice channel (defaults to your current VC)").addChannelTypes(ChannelType.GuildVoice)),
    )
    .addSubcommand(sub => sub.setName("list").setDescription("List recent temporary and kept VC transcripts."))
    .addSubcommand(sub =>
      sub.setName("view").setDescription("View a transcript as a text file.")
        .addStringOption(o => o.setName("session").setDescription("Session ID").setRequired(true).setMaxLength(80)),
    )
    .addSubcommand(sub =>
      sub.setName("keep").setDescription("Keep a transcript instead of deleting it after 8 hours.")
        .addStringOption(o => o.setName("session").setDescription("Session ID").setRequired(true).setMaxLength(80)),
    )
    .addSubcommand(sub =>
      sub.setName("delete").setDescription("Delete a stored VC transcript immediately.")
        .addStringOption(o => o.setName("session").setDescription("Session ID").setRequired(true).setMaxLength(80)),
    ),

  async execute(interaction) {
    if (!(await requireStaff(interaction)) || !interaction.inCachedGuild()) return;
    const sub = interaction.options.getSubcommand();

    if (sub === "set-log") {
      const channel = interaction.options.getChannel("channel", true);
      configureVoiceLogChannel(interaction.guild.id, channel.id);
      await interaction.reply({
        content: `VC transcript reviews will be sent to ${channel}. Keep that channel staff-only because transcripts can contain private conversation.`,
        ephemeral: true,
      });
      return;
    }

    if (sub === "auto") {
      const channel = interaction.options.getChannel("channel", true);
      const enabled = interaction.options.getBoolean("enabled", true);
      if (channel.type !== ChannelType.GuildVoice) {
        await interaction.reply({ content: "Choose a standard voice channel.", ephemeral: true });
        return;
      }
      if (enabled && !getVoiceLogChannelId(interaction.guild.id)) {
        await interaction.reply({ content: "Set a private review channel first with `/vctranscript set-log`.", ephemeral: true });
        return;
      }
      await configureAutoTranscript(interaction.guild, channel.id, enabled, interaction.user.id);
      await interaction.reply({
        content: `Automatic transcription is now **${enabled ? "ON" : "OFF"}** for ${channel}. ${enabled ? "Keystone will join when the first human enters and end the session when the VC empties." : "Any transcript already running will continue until the VC empties or staff stops it."}`,
        ephemeral: true,
      });
      return;
    }

    if (sub === "start") {
      const channel = voiceChannelFromInteraction(interaction);
      if (!channel || channel.type !== ChannelType.GuildVoice) {
        await interaction.reply({ content: "Join a voice channel or specify one with the `channel` option.", ephemeral: true });
        return;
      }
      try {
        const record = await startVoiceTranscript(channel, {
          auto: false,
          startedBy: interaction.user.id,
          reason: interaction.options.getString("reason") ?? "Manual staff transcription",
        });
        await interaction.reply({ content: `Started VC transcript **${record.id}** in ${channel}.`, ephemeral: true });
      } catch (error) {
        await interaction.reply({ content: `Could not start transcription: ${error instanceof Error ? error.message : String(error)}`, ephemeral: true });
      }
      return;
    }

    if (sub === "stop") {
      const channel = voiceChannelFromInteraction(interaction);
      if (!channel || channel.type !== ChannelType.GuildVoice) {
        await interaction.reply({ content: "Join a voice channel or specify one with the `channel` option.", ephemeral: true });
        return;
      }
      const record = await stopVoiceTranscript(interaction.guild.id, channel.id);
      await interaction.reply({
        content: record ? `Stopped **${record.id}**. It will remain reviewable for 8 hours unless staff keeps it.` : `There is no active transcript in ${channel}.`,
        ephemeral: true,
      });
      return;
    }

    if (sub === "status") {
      const channel = voiceChannelFromInteraction(interaction);
      if (!channel || channel.type !== ChannelType.GuildVoice) {
        await interaction.reply({ content: "Join a voice channel or specify one with the `channel` option.", ephemeral: true });
        return;
      }
      const active = activeVoiceTranscript(interaction.guild.id, channel.id);
      const auto = isAutoTranscriptEnabled(interaction.guild.id, channel.id);
      await interaction.reply({
        content: [
          `**${channel.name}**`,
          `Auto-transcribe: **${auto ? "ON" : "OFF"}**`,
          `Active transcript: ${active ? `**${active.id}** (${active.entries.length} transcribed segment(s))` : "None"}`,
          `Review channel: ${getVoiceLogChannelId(interaction.guild.id) ? `<#${getVoiceLogChannelId(interaction.guild.id)}>` : "Not configured"}`,
        ].join("\n"),
        ephemeral: true,
      });
      return;
    }

    if (sub === "list") {
      const sessions = recentVoiceSessions(interaction.guild.id).slice(0, 15);
      const content = sessions.length
        ? sessions.map(s => {
            const state = s.keptAt ? "KEPT" : s.endedAt ? "TEMP" : "ACTIVE/INTERRUPTED";
            return `• **${s.id}** — #${s.channelName} — ${state} — ${s.entries.length} line(s)`;
          }).join("\n")
        : "No stored VC transcripts.";
      await interaction.reply({ content, ephemeral: true });
      return;
    }

    const sessionId = interaction.options.getString("session", true);

    if (sub === "view") {
      const text = renderVoiceTranscript(sessionId);
      if (!text) {
        await interaction.reply({ content: "That transcript does not exist or has expired.", ephemeral: true });
        return;
      }
      const file = new AttachmentBuilder(Buffer.from(text, "utf8"), { name: `${sessionId}.txt` });
      await interaction.reply({ content: `Transcript **${sessionId}**`, files: [file], ephemeral: true });
      return;
    }

    if (sub === "keep") {
      const record = await keepVoiceTranscript(sessionId);
      await interaction.reply({
        content: record ? `Transcript **${sessionId}** is now kept permanently.` : "That transcript does not exist or has expired.",
        ephemeral: true,
      });
      return;
    }

    if (sub === "delete") {
      const deleted = await removeVoiceTranscript(sessionId);
      await interaction.reply({
        content: deleted ? `Deleted transcript **${sessionId}**.` : "That transcript does not exist or has already been deleted.",
        ephemeral: true,
      });
    }
  },
};
