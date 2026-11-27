import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type GuildMember,
} from "discord.js";
import type { BotCommand } from "../lib/command.js";
import {
  cancelGiveaway,
  createGiveaway,
  finishGiveaway,
  getGiveaway,
  giveawayUrl,
  listGiveaways,
  rerollGiveaway,
} from "../features/giveaways.js";
import { parseGiveawayDuration } from "../features/giveaways-core.js";

function permissions(member: GuildMember): { canHost: boolean; canManage: boolean } {
  const elevated = member.id === member.guild.ownerId ||
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ModerateMembers);
  const names = member.roles.cache.map(role => role.name.toLocaleLowerCase("en-US"));
  const manager = names.some(name => name.includes("event manager"));
  const host = names.some(name => name.includes("event host"));
  return { canHost: elevated || manager || host, canManage: elevated || manager };
}

function safeError(error: unknown): string {
  console.error("[giveaways] Command failed:", error);
  return error instanceof Error && (
    error.message.startsWith("FERAL already has") ||
    error.message.startsWith("No new eligible") ||
    error.message.startsWith("Reroll saved")
  ) ? error.message : "Something went wrong. Please check Keystone's Railway logs.";
}

export const giveawayCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("giveaway")
    .setDescription("Create and manage FERAL community giveaways.")
    .setDefaultMemberPermissions(null)
    .addSubcommand(sub => sub.setName("create").setDescription("Launch a giveaway with a join button.")
      .addStringOption(o => o.setName("prize").setDescription("What is the prize?").setRequired(true).setMaxLength(100))
      .addStringOption(o => o.setName("duration").setDescription("How long? e.g. 30m, 2h, 1d, 7d (max 30d)").setRequired(true))
      .addIntegerOption(o => o.setName("winners").setDescription("How many winners (default 1)").setMinValue(1).setMaxValue(10))
      .addChannelOption(o => o.setName("channel").setDescription("Where to post (default: current channel)").addChannelTypes(ChannelType.GuildText))
      .addRoleOption(o => o.setName("required_role").setDescription("Optional role members need to enter"))
      .addStringOption(o => o.setName("details").setDescription("Optional rules or prize details").setMaxLength(600)))
    .addSubcommand(sub => sub.setName("end").setDescription("End a giveaway now and select its winner(s).")
      .addStringOption(o => o.setName("id").setDescription("Giveaway ID or announcement message ID").setRequired(true)))
    .addSubcommand(sub => sub.setName("cancel").setDescription("Cancel a running giveaway without selecting winners.")
      .addStringOption(o => o.setName("id").setDescription("Giveaway ID or announcement message ID").setRequired(true)))
    .addSubcommand(sub => sub.setName("reroll").setDescription("Draw replacement winner(s) after a giveaway ends.")
      .addStringOption(o => o.setName("id").setDescription("Giveaway ID or announcement message ID").setRequired(true))
      .addIntegerOption(o => o.setName("winners").setDescription("New winners (default: 1)").setMinValue(1).setMaxValue(10)))
    .addSubcommand(sub => sub.setName("info").setDescription("View accurate entry count and giveaway status.")
      .addStringOption(o => o.setName("id").setDescription("Giveaway ID or announcement message ID").setRequired(true)))
    .addSubcommand(sub => sub.setName("list").setDescription("View recent giveaways and their IDs.")),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    const sub = interaction.options.getSubcommand();
    const member = interaction.member as GuildMember;
    const rights = permissions(member);
    const privileged = ["create", "end", "cancel", "reroll"].includes(sub);

    if (privileged && !rights.canHost) {
      await interaction.reply({
        content: "Only Event Hosts, Event Managers, and moderators can manage giveaways.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (sub === "reroll" && !rights.canManage) {
      await interaction.reply({
        content: "Only Event Managers and server moderators can reroll winners.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      if (sub === "create") {
        const durationText = interaction.options.getString("duration", true);
        const durationMs = parseGiveawayDuration(durationText);
        if (!durationMs) {
          await interaction.editReply("Invalid duration. Use 30m, 2h, 1d, or 7d. Minimum: 1 minute; maximum: 30 days.");
          return;
        }
        const target = interaction.options.getChannel("channel") ?? interaction.channel;
        if (!target || target.type !== ChannelType.GuildText) {
          await interaction.editReply("Choose a normal Discord text channel for this giveaway.");
          return;
        }
        const bot = await interaction.guild.members.fetchMe();
        const perms = target.permissionsFor(bot);
        if (!perms?.has(PermissionFlagsBits.ViewChannel) ||
            !perms.has(PermissionFlagsBits.SendMessages) ||
            !perms.has(PermissionFlagsBits.EmbedLinks) ||
            !perms.has(PermissionFlagsBits.ReadMessageHistory)) {
          await interaction.editReply("Keystone needs View Channel, Send Messages, Embed Links, and Read Message History in " + target.toString() + ".");
          return;
        }
        const requiredRole = interaction.options.getRole("required_role");
        if (requiredRole && requiredRole.id === interaction.guild.id) {
          await interaction.editReply("The @everyone role cannot be used as a giveaway entry requirement.");
          return;
        }
        const record = await createGiveaway({
          guild: interaction.guild,
          channel: target,
          creatorId: interaction.user.id,
          prize: interaction.options.getString("prize", true),
          description: interaction.options.getString("details") ?? undefined,
          durationMs,
          winnersCount: interaction.options.getInteger("winners") ?? 1,
          requiredRoleId: requiredRole?.id,
        });
        await interaction.editReply({
          content: "🎉 Giveaway created in " + target.toString() +
            "!\nID: \`" + record.id + "\`\n" + giveawayUrl(record),
        });
        return;
      }

      if (sub === "list") {
        const records = (await listGiveaways(interaction.guild.id)).slice(0, 15);
        await interaction.editReply(records.length
          ? "**Recent giveaways**\n" +
            records.map(record =>
              "\`" + record.id + "\` — **" + record.prize + "** — " + record.status +
              " — " + giveawayUrl(record)).join("\n")
          : "No giveaways have been created yet.");
        return;
      }

      const id = interaction.options.getString("id", true).trim();
      const record = await getGiveaway(interaction.guild.id, id);
      if (!record) {
        await interaction.editReply("No giveaway found with that ID. Use /giveaway list to find one.");
        return;
      }

      if (sub === "info") {
        await interaction.editReply({
          content: "**Giveaway: " + record.prize + "**\n" +
            "ID: \`" + record.id + "\`\n" +
            "Status: **" + record.status + "**\n" +
            "Entries: **" + record.entries.length + "**\n" +
            "Winners requested: **" + record.winnersCount + "**\n" +
            "Ends: <t:" + Math.floor(record.endsAt / 1000) + ":F>\n" +
            "Current winners: " + (record.winners.length ? record.winners.map(x => "<@" + x + ">").join(", ") : "Not selected") +
            "\n" + giveawayUrl(record),
          allowedMentions: { parse: [] },
        });
        return;
      }

      if ((sub === "end" || sub === "cancel") && !rights.canManage && record.creatorId !== interaction.user.id) {
        await interaction.editReply("Event Hosts can only end or cancel giveaways they created. Event Managers can manage all giveaways.");
        return;
      }

      if (sub === "end") {
        if (record.status !== "active" && record.status !== "ending") {
          await interaction.editReply("This giveaway is already " + record.status + ".");
          return;
        }
        const result = await finishGiveaway(interaction.guild, record.id, true, interaction.user.id);
        await interaction.editReply(result
          ? "Giveaway concluded: " + giveawayUrl(result) +
            "\nWinner(s): " + (result.winners.length ? result.winners.map(x => "<@" + x + ">").join(", ") : "No eligible entries")
          : "This giveaway is currently being processed. Check /giveaway info shortly.");
        return;
      }

      if (sub === "cancel") {
        const result = await cancelGiveaway(interaction.guild, record.id, interaction.user.id);
        await interaction.editReply(result
          ? "Giveaway cancelled. No winners were selected.\n" + giveawayUrl(result)
          : "This giveaway is no longer active or is currently ending.");
        return;
      }

      if (sub === "reroll") {
        const count = interaction.options.getInteger("winners") ?? 1;
        const result = await rerollGiveaway(interaction.guild, record.id, count, interaction.user.id);
        await interaction.editReply(result
          ? "New winner(s): " + result.winners.map(x => "<@" + x + ">").join(", ") + "\n" + giveawayUrl(result)
          : "The giveaway must have ended and announced winners before it can be rerolled.");
        return;
      }

      await interaction.editReply("Unknown giveaway subcommand.");
    } catch (error) {
      await interaction.editReply(safeError(error)).catch(() => undefined);
    }
  },
};
