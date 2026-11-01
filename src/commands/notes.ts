import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../lib/command.js";
import { requireStaff } from "../lib/permissions.js";
import { addModNote, getModNotes, removeModNote } from "../features/modnotes.js";

export const notesCommand: BotCommand = {
  data: new SlashCommandBuilder().setName("notes").setDescription("Manage private staff notes.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand(s => s.setName("add").setDescription("Add a note")
      .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
      .addStringOption(o => o.setName("note").setDescription("Note").setRequired(true).setMaxLength(1000)))
    .addSubcommand(s => s.setName("list").setDescription("List notes")
      .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true)))
    .addSubcommand(s => s.setName("remove").setDescription("Remove a note by ID")
      .addStringOption(o => o.setName("id").setDescription("Note ID").setRequired(true))),
  async execute(interaction) {
    if (!(await requireStaff(interaction)) || !interaction.inCachedGuild()) return;
    const sub = interaction.options.getSubcommand();
    if (sub === "add") {
      const user = interaction.options.getUser("user", true);
      const note = await addModNote(interaction.guild.id, user.id, interaction.user.id, interaction.options.getString("note", true), "note");
      await interaction.reply({ content: `Note added with ID \`${note.id}\`.`, ephemeral: true });
    } else if (sub === "list") {
      const user = interaction.options.getUser("user", true);
      const notes = await getModNotes(interaction.guild.id, user.id);
      const text = notes.length ? notes.slice(-20).map(n => `\`${n.id}\` **${n.kind}** — <@${n.moderatorId}> — <t:${Math.floor(n.createdAt / 1000)}:R>\n${n.text}`).join("\n\n") : "No notes recorded.";
      await interaction.reply({ content: `**Records for ${user.tag}**\n${text}`, ephemeral: true });
    } else {
      const removed = await removeModNote(interaction.guild.id, interaction.options.getString("id", true));
      await interaction.reply({ content: removed ? "Note removed." : "No note with that ID was found.", ephemeral: true });
    }
  },
};
