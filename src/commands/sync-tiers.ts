import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../lib/command.js";
import { DEFAULT_LEVELS, type LevelsFile } from "../storage/schema.js";
import { readJson } from "../storage/json-store.js";
import { getGuildSettings } from "../storage/settings.js";

// A bounded, idempotent backfill. Each invocation handles a single stable
// slice of saved level records so a large guild won't exhaust an interaction.
const syncingGuilds = new Set<string>();

export const syncTiersCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("sync-tiers")
    .setDescription("Audit or grant missing tier roles to members who already reached the level.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option => option.setName("mode")
      .setDescription("Preview changes first, then apply.")
      .setRequired(true)
      .addChoices(
        { name: "Preview (no roles changed)", value: "preview" },
        { name: "Apply missing tier roles", value: "apply" },
      ))
    .addRoleOption(option => option.setName("role")
      .setDescription("Optional: sync only one configured tier, such as Mouse or Cougar"))
    .addUserOption(option => option.setName("user")
      .setDescription("Optional: sync a single member instead of a batch"))
    .addIntegerOption(option => option.setName("offset")
      .setDescription("Continue from this offset in saved level records (default: 0)")
      .setMinValue(0))
    .addIntegerOption(option => option.setName("limit")
      .setDescription("Members to check in one batch, 1–500 (default: 250)")
      .setMinValue(1).setMaxValue(500)),
  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: "Administrator permission required.", flags: MessageFlags.Ephemeral });
      return;
    }

    const mode = interaction.options.getString("mode", true);
    const requestedRole = interaction.options.getRole("role");
    const user = interaction.options.getUser("user");
    const offset = user ? 0 : interaction.options.getInteger("offset") ?? 0;
    const limit = user ? 1 : interaction.options.getInteger("limit") ?? 250;
    const settings = await getGuildSettings(interaction.guildId);
    const tiers = requestedRole
      ? settings.leveling.tiers.filter(t => t.roleId === requestedRole.id)
      : settings.leveling.tiers;
    if (!tiers.length) {
      await interaction.reply({
        content: requestedRole ? "That role isn't configured as a leveling tier." : "No leveling tiers are configured.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guild = interaction.guild;
    const botMember = await guild.members.fetchMe();
    if (mode === "apply") {
      const invalid = tiers.filter(tier => {
        const role = guild.roles.cache.get(tier.roleId);
        return !role || role.managed || !role.editable || !botMember.permissions.has(PermissionFlagsBits.ManageRoles);
      });
      if (invalid.length) {
        await interaction.reply({
          content: "Keystone cannot manage these tier roles: " +
            invalid.map(t => t.name + " (<@&" + t.roleId + ">)").join(", ") +
            ". Make sure its bot role is above them and it has Manage Roles.",
          allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    if (syncingGuilds.has(guild.id)) {
      await interaction.reply({
        content: "A tier synchronization is already running for this server. Try again after it completes.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    syncingGuilds.add(guild.id);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const data = await readJson<LevelsFile>("levels", DEFAULT_LEVELS);
      const minLevel = Math.min(...tiers.map(t => t.level));
      const records = Object.entries(data.guilds[guild.id] ?? {})
        .filter(([, record]) => Number.isFinite(record.level) && record.level >= minLevel)
        .sort(([a], [b]) => a.localeCompare(b));
      const relevant = user ? records.filter(([id]) => id === user.id) : records;
      const batch = relevant.slice(offset, offset + limit);

      let checked = 0;
      let alreadyCorrect = 0;
      let membersChanged = 0;
      let missingAssignments = 0;
      let assigned = 0;
      let failed = 0;
      let leftServer = 0;
      const errors: string[] = [];

      for (const [userId, record] of batch) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member || member.user.bot) {
          leftServer++;
          continue;
        }
        checked++;
        const missing = tiers.filter(tier => record.level >= tier.level && !member.roles.cache.has(tier.roleId));
        if (!missing.length) {
          alreadyCorrect++;
          continue;
        }
        missingAssignments += missing.length;
        if (mode !== "apply") continue;

        let changed = false;
        for (const tier of missing) {
          try {
            await member.roles.add(tier.roleId, "FERAL tier backfill (existing earned level)");
            assigned++;
            changed = true;
          } catch (error) {
            failed++;
            console.error(`[tiers] Could not backfill ${tier.roleId} to ${userId}:`, error);
            if (errors.length < 4) errors.push(`<@${userId}>: <@&${tier.roleId}>`);
          }
        }
        if (changed) membersChanged++;
      }

      const nextOffset = offset + batch.length;
      const hasMore = nextOffset < relevant.length;
      const summary = [
        "**Tier sync — " + (mode === "apply" ? "Applied" : "Preview") + "**",
        "Configured tier scope: " + (requestedRole ? "<@&" + requestedRole.id + ">" : "All configured tiers"),
        "Saved eligible records: **" + relevant.length + "**",
        "Checked this batch: **" + checked + "** (already correct: " + alreadyCorrect + "; no longer present/bots: " + leftServer + ")",
        mode === "apply"
          ? "Roles added: **" + assigned + "** across **" + membersChanged + "** members; failed grants: **" + failed + "**"
          : "Missing role assignments found: **" + missingAssignments + "** (no changes made)",
        hasMore
          ? "More records remain. Run again with `offset: " + nextOffset + "` (same mode and role)."
          : "Reached the end of the eligible saved records.",
        errors.length ? "Failed examples: " + errors.join(", ") : "",
        "Other member roles and XP were not modified.",
      ].filter(Boolean).join("\n");
      await interaction.editReply({ content: summary, allowedMentions: { parse: [] } });
      console.log(`[tiers] ${mode} by ${interaction.user.id}: checked=${checked}, missing=${missingAssignments}, assigned=${assigned}, failed=${failed}, next=${nextOffset}, total=${relevant.length}`);
    } finally {
      syncingGuilds.delete(guild.id);
    }
  },
};
