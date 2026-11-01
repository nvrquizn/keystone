import { DEFAULT_MODNOTES, type ModNote, type ModNotesFile } from "../storage/schema.js";
import { readJson, updateJson } from "../storage/json-store.js";

export async function addModNote(guildId: string, userId: string, moderatorId: string, text: string, kind: ModNote["kind"]): Promise<ModNote> {
  const note: ModNote = { id: crypto.randomUUID().slice(0, 8), userId, moderatorId, text, createdAt: Date.now(), kind };
  await updateJson<ModNotesFile>("modnotes", DEFAULT_MODNOTES, data => {
    data.guilds[guildId] ??= [];
    data.guilds[guildId]!.push(note);
  });
  return note;
}

export async function getModNotes(guildId: string, userId: string): Promise<ModNote[]> {
  const data = await readJson<ModNotesFile>("modnotes", DEFAULT_MODNOTES);
  return (data.guilds[guildId] ?? []).filter(n => n.userId === userId);
}

export async function removeModNote(guildId: string, noteId: string): Promise<boolean> {
  let removed = false;
  await updateJson<ModNotesFile>("modnotes", DEFAULT_MODNOTES, data => {
    const notes = data.guilds[guildId] ?? [];
    const next = notes.filter(n => n.id !== noteId);
    removed = next.length !== notes.length;
    data.guilds[guildId] = next;
  });
  return removed;
}
