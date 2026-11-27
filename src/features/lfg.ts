import { ChannelType, Events, PermissionFlagsBits, type Client, type Message } from "discord.js";
import { getGuildSettings } from "../storage/settings.js";
import { isLfgRecruitment, lfgThreadName } from "./lfg-core.js";

// Guard against duplicate gateway events while a thread is being created.
const inFlight = new Set<string>();
const lastReminderAt = new Map<string, number>();

async function deleteOffTopicLfg(message: Message<true>): Promise<void> {
  try {
    await message.delete();
    console.log(\`[lfg] Removed non-recruitment message \${message.id} in \${message.channelId}\`);
  } catch (error) {
    console.error(\`[lfg] Unable to delete non-recruitment message \${message.id}:\`, error);
    return;
  }

  const key = \`\${message.guildId}:\${message.author.id}\`;
  const now = Date.now();
  if (now - (lastReminderAt.get(key) ?? 0) < 10 * 60_000) return;
  lastReminderAt.set(key, now);
  if (lastReminderAt.size > 2000) {
    for (const [id, timestamp] of lastReminderAt) {
      if (now - timestamp > 10 * 60_000) lastReminderAt.delete(id);
    }
  }
  await message.author.send({
    content: "Your message in <#" + message.channelId + "> was removed because that channel is for **Looking for Group posts only**. Please use the game discussion channel for general chat or questions.\\n\\n" +
      "**Example LFG post:**\\nAnimal: Snow Leopard\\nPlaystyle: Casual\\nPlayers Needed: 2\\nServer: Public\\n\\n" +
      "You can also post a clear group invitation, such as ‘Anyone wanna play snow leopard?’ Members can chat inside the discussion thread created for a valid LFG post. This is an automatic channel reminder, not a warning.",
    allowedMentions: { parse: [] },
  }).catch(error => console.warn(\`[lfg] Could not DM member \${message.author.id} about removed post:\`, error));
}

export function registerLfgThreads(client: Client): void {
  client.on(Events.MessageCreate, async message => {
    if (!message.inGuild() || message.author.bot || message.webhookId || message.system) return;
    if (message.channel.type !== ChannelType.GuildText || message.hasThread) return;
    try {
      const { lfg } = await getGuildSettings(message.guildId);
      if (!lfg.enabled || lfg.channelId !== message.channelId) return;
      if (inFlight.has(message.id)) return;
      inFlight.add(message.id);

      try {
        // Staff instructions and pinned guidance are preserved; staff posts
        // never trigger automatic discussion threads.
        if (message.pinned || message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return;

        if (!isLfgRecruitment(message.content)) {
          if (lfg.deleteOffTopic) await deleteOffTopicLfg(message);
          return;
        }

        // Discord posts the root message normally; the thread is attached to it.
        // Never create threads for replies inside other threads.
        const title = lfgThreadName(message.content, message.member?.displayName ?? message.author.username);
        const thread = await message.startThread({
          name: title,
          autoArchiveDuration: 1440,
          reason: "FERAL Looking for Group: discussion for a new recruitment post",
        });
        console.log(`[lfg] Created thread ${thread.id} for post ${message.id} by ${message.author.id}`);
      } catch (error) {
        console.error(`[lfg] Could not create thread for message ${message.id} in ${message.channelId}:`, error);
      } finally {
        inFlight.delete(message.id);
      }
    } catch (error) {
      console.error("[lfg] Message handler failed:", error);
    }
  });
}
