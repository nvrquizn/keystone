import type { Client } from "discord.js";
import { DEFAULT_REMINDERS, type ReminderRecord, type RemindersFile } from "../storage/schema.js";
import { readJson, updateJson } from "../storage/json-store.js";

export async function addReminder(_client: Client, reminder: ReminderRecord): Promise<void> {
  await updateJson<RemindersFile>("reminders", DEFAULT_REMINDERS, data => { data.reminders.push(reminder); });
}

async function processReminders(client: Client): Promise<void> {
  const now = Date.now();
  const file = await readJson<RemindersFile>("reminders", DEFAULT_REMINDERS);
  const due = file.reminders.filter(r => r.dueAt <= now);
  if (!due.length) return;
  for (const reminder of due) {
    const channel = await client.channels.fetch(reminder.channelId).catch(() => null);
    if (channel?.isSendable()) {
      await channel.send({ content: `<@${reminder.userId}> reminder: ${reminder.text}` }).catch(() => undefined);
    } else {
      const user = await client.users.fetch(reminder.userId).catch(() => null);
      await user?.send(`Reminder: ${reminder.text}`).catch(() => undefined);
    }
  }
  const ids = new Set(due.map(r => r.id));
  await updateJson<RemindersFile>("reminders", DEFAULT_REMINDERS, data => {
    data.reminders = data.reminders.filter(r => !ids.has(r.id));
  });
}

export function registerReminderWorker(client: Client): void {
  void processReminders(client);
  setInterval(() => void processReminders(client), 30_000).unref();
}
