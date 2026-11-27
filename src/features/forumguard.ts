import { ChannelType, Events, type Client, type Guild, type Message, type ThreadChannel } from "discord.js";
import { getGuildSettings } from "../storage/settings.js";
import { config } from "../config.js";
import { isBumpOnly, possibleDuplicate, RollingCounter } from "./forumguard-core.js";

const posting = new RollingCounter();
const bumping = new RollingCounter();
const alertAt = new Map<string, number>();

function link(guildId: string, channelId: string): string {
  return "https://discord.com/channels/" + guildId + "/" + channelId;
}

function mayAlert(key: string, now: number, cooldownMs = 60 * 60 * 1000): boolean {
  const last = alertAt.get(key);
  if (last !== undefined && now - last < cooldownMs) return false;
  alertAt.set(key, now);
  if (alertAt.size > 3000) {
    for (const [id, timestamp] of alertAt) {
      if (now - timestamp > 24 * 60 * 60 * 1000) alertAt.delete(id);
    }
  }
  return true;
}

async function report(guild: Guild, logChannelId: string, subject: string, message: string): Promise<void> {
  try {
    const channel = await guild.channels.fetch(logChannelId);
    if (!channel?.isSendable()) {
      console.warn("[forumguard] Cannot send review alert: configured log channel is unavailable or not sendable.");
      return;
    }
    await channel.send({
      content: ("**ForumGuard | " + subject + "**\n" + message).slice(0, 1900),
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    console.error("[forumguard] Failed to send staff review:", error);
  }
}

export function registerForumGuard(client: Client): void {
  client.once(Events.ClientReady, () => {
    void getGuildSettings(config.GUILD_ID).then(settings => {
      const guard = settings.forumGuard;
      console.log(`[forumguard] Startup: enabled=${guard.enabled}, forum=${guard.forumChannelId ?? "unset"}, logs=${guard.logChannelId ?? "unset"}, bumpReminders=${guard.publicBumpReminder}`);
    }).catch(error => console.error("[forumguard] Startup settings check failed:", error));
  });

  client.on(Events.ThreadCreate, async (thread: ThreadChannel, newlyCreated: boolean) => {
    try {
      if (!newlyCreated) return;
      const settings = (await getGuildSettings(thread.guild.id)).forumGuard;
      if (!settings.enabled || !settings.forumChannelId || !settings.logChannelId) return;
      if (thread.parentId !== settings.forumChannelId) return;
      const ownerId = thread.ownerId;
      if (!ownerId) return;
      const now = Date.now();
      const count = posting.add(thread.guild.id + ":" + ownerId, now, 6 * 60 * 60 * 1000);
      if (count >= 4 && mayAlert("posts:" + thread.guild.id + ":" + ownerId, now)) {
        await report(thread.guild, settings.logChannelId, "Frequent suggestions",
          "Member: <@" + ownerId + ">\n4+ posts in 6 hours. Review before acting.\n" + link(thread.guild.id, thread.id));
      }

      const forum = await thread.guild.channels.fetch(settings.forumChannelId);
      if (!forum || forum.type !== ChannelType.GuildForum) return;
      const active = await forum.threads.fetchActive();
      const candidates = [...active.threads.values()]
        .filter(existing => existing.id !== thread.id)
        .map(existing => ({ id: existing.id, name: existing.name }));
      let match = possibleDuplicate(thread.name, candidates);
      // Older suggestions may have been automatically archived by Discord.
      // Check the 50 most recent archived posts if no active title matches.
      if (!match) {
        try {
          const archived = await forum.threads.fetchArchived({ limit: 50 });
          match = possibleDuplicate(thread.name, [...archived.threads.values()]
            .filter(existing => existing.id !== thread.id)
            .map(existing => ({ id: existing.id, name: existing.name })));
        } catch (error) {
          console.error("[forumguard] Could not check archived forum threads:", error);
        }
      }
      if (!match) return;
      const existingLink = link(thread.guild.id, match.id);
      await report(thread.guild, settings.logChannelId, "Possible duplicate",
        "New: " + link(thread.guild.id, thread.id) + "\nSimilar title: " + existingLink + "\nTitle similarity only. Different proposals are permitted.");
      if (settings.publicDuplicateReminder) {
        await thread.send({
          content: "Thanks for submitting an idea! A post with a similar title may already exist: " +
            existingLink + "\nPlease check whether it covers the same idea. Different approaches are welcome.",
          allowedMentions: { parse: [] },
        }).catch(error => console.error("[forumguard] Reminder failed:", error));
      }
    } catch (error) {
      console.error("[forumguard] ThreadCreate check failed:", error);
    }
  });

  client.on(Events.MessageCreate, async (message: Message) => {
    try {
      if (!message.inGuild() || message.author.bot || message.webhookId || !message.channel.isThread()) return;
      const settings = (await getGuildSettings(message.guildId)).forumGuard;
      if (!settings.enabled || !settings.forumChannelId || !settings.logChannelId) return;
      if (message.channel.parentId !== settings.forumChannelId) return;
      if (!isBumpOnly(message.content)) return;
      const now = Date.now();
      const key = message.guildId + ":" + message.channel.id + ":" + message.author.id;
      const count = bumping.add(key, now, 60 * 60 * 1000);
      if (settings.publicBumpReminder && mayAlert("bump-reminder:" + key, now, 5 * 60 * 1000)) {
        // One reply per member/thread per five minutes, not a formal warning.
        await message.reply({
          content: "Please avoid bump-only replies in Game Ideas. If you have meaningful new information or improvements, add those to the discussion instead. This is just a reminder, not a warning.",
          allowedMentions: { parse: [], repliedUser: false },
        }).catch(error => console.error("[forumguard] Bump reminder failed:", error));
      }
      if (count >= 4 && mayAlert("bump:" + key, now)) {
        await report(message.guild, settings.logChannelId, "Repeated bumping",
          "Member: <@" + message.author.id + ">\n4+ bump-only replies in 1 hour in the same post. Review before acting.\n" + message.url);
      }
    } catch (error) {
      console.error("[forumguard] MessageCreate check failed:", error);
    }
  });
}
