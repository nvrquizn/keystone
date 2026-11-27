import { ChannelType, Events, type Client } from "discord.js";
import { getGuildSettings } from "../storage/settings.js";
import { lfgThreadName } from "./lfg-core.js";

// Guard against duplicate gateway events while a thread is being created.
const inFlight = new Set<string>();

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
