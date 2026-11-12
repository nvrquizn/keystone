import {
  AttachmentBuilder,
  EmbedBuilder,
  Events,
  type Client,
  type Guild,
  type GuildMember,
  type Message,
  type PartialMessage,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  type User,
} from "discord.js";
import { sendLog } from "../lib/logging.js";
import { getGuildSettings } from "../storage/settings.js";

const NEUTRAL = 0x8297ab;
const GREEN = 0x6ff098;
const RED = 0xe56b6f;
const YELLOW = 0xe7b85c;

function clip(value: unknown, max = 1024): string {
  const text = String(value ?? "None").trim() || "None";
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

function yesNo(value: boolean | null | undefined): string {
  if (value == null) return "Unknown";
  return value ? "Yes" : "No";
}

function userLabel(user: User | PartialUser | null | undefined): string {
  if (!user) return "Unknown";
  const tag = "tag" in user && user.tag ? user.tag : user.id;
  return `${tag} (${user.id})`;
}

function memberLabel(member: GuildMember): string {
  return `${member.user.tag} (${member.id})`;
}

function arrayDiff<T>(before: T[], after: T[]): { added: T[]; removed: T[] } {
  return {
    added: after.filter(v => !before.includes(v)),
    removed: before.filter(v => !after.includes(v)),
  };
}

function mentionSummary(message: Message | PartialMessage): string[] {
  const items: string[] = [];
  const users = (message as any).mentions?.users;
  const roles = (message as any).mentions?.roles;
  if (users?.size) items.push(...users.map((u: User) => `<@${u.id}>`));
  if (roles?.size) items.push(...roles.map((r: any) => `<@&${r.id}>`));
  if ((message as any).mentions?.everyone) items.push("@everyone/@here");
  return [...new Set(items)];
}

function attachmentSummary(message: Message | PartialMessage): string {
  const attachments = (message as any).attachments;
  if (!attachments?.size) return "";
  return attachments.map((a: any) => `${a.name ?? "attachment"}: ${a.url}`).join("\n");
}

async function auditActor(guild: Guild, targetId: string): Promise<string | null> {
  const logs = await guild.fetchAuditLogs({ limit: 8 }).catch(() => null);
  if (!logs) return null;
  const now = Date.now();
  const entry = logs.entries.find((e: any) => {
    const id = e.targetId ?? e.target?.id;
    return id === targetId && now - e.createdTimestamp < 12_000;
  });
  if (!entry?.executor) return null;
  return userLabel(entry.executor);
}

function permissionOverwriteMap(channel: any): Map<string, { type: number; allow: string[]; deny: string[] }> {
  const result = new Map<string, { type: number; allow: string[]; deny: string[] }>();
  const cache = channel?.permissionOverwrites?.cache;
  if (!cache) return result;
  for (const overwrite of cache.values()) {
    result.set(overwrite.id, {
      type: overwrite.type,
      allow: overwrite.allow?.toArray?.() ?? [],
      deny: overwrite.deny?.toArray?.() ?? [],
    });
  }
  return result;
}

function formatOverwrite(id: string, type: number): string {
  return type === 0 ? `<@&${id}>` : `<@${id}>`;
}

function permissionOverwriteChanges(oldChannel: any, newChannel: any): string[] {
  const before = permissionOverwriteMap(oldChannel);
  const after = permissionOverwriteMap(newChannel);
  const ids = new Set([...before.keys(), ...after.keys()]);
  const changes: string[] = [];

  for (const id of ids) {
    const oldOw = before.get(id);
    const newOw = after.get(id);
    if (!oldOw && newOw) {
      changes.push(`${formatOverwrite(id, newOw.type)} overwrite added (allow: ${newOw.allow.join(", ") || "none"}; deny: ${newOw.deny.join(", ") || "none"})`);
      continue;
    }
    if (oldOw && !newOw) {
      changes.push(`${formatOverwrite(id, oldOw.type)} overwrite removed`);
      continue;
    }
    if (!oldOw || !newOw) continue;
    const allow = arrayDiff(oldOw.allow, newOw.allow);
    const deny = arrayDiff(oldOw.deny, newOw.deny);
    const parts: string[] = [];
    if (allow.added.length) parts.push(`allowed +${allow.added.join(", ")}`);
    if (allow.removed.length) parts.push(`allowed -${allow.removed.join(", ")}`);
    if (deny.added.length) parts.push(`denied +${deny.added.join(", ")}`);
    if (deny.removed.length) parts.push(`denied -${deny.removed.join(", ")}`);
    if (parts.length) changes.push(`${formatOverwrite(id, newOw.type)}: ${parts.join("; ")}`);
  }
  return changes;
}

async function logMessageDelete(message: Message | PartialMessage): Promise<void> {
  if (!message.guild) return;

  const author = (message as any).author as User | undefined;
  if (author?.bot) return;

  const mentions = mentionSummary(message);
  const attachments = attachmentSummary(message);

  const embed = new EmbedBuilder()
    .setColor(mentions.length ? YELLOW : RED)
    .setTitle(
      mentions.length
        ? "Message deleted — possible ghost ping"
        : "Message deleted",
    )
    .addFields(
      { name: "Author", value: userLabel(author), inline: true },
      { name: "Channel", value: `<#${message.channelId}>`, inline: true },
      { name: "Message ID", value: message.id, inline: true },
      {
        name: "Content",
        value: clip(
          (message as any).content ||
            "Content unavailable (message was not cached).",
        ),
      },
    )
    .setTimestamp();

  if (mentions.length) {
    embed.addFields({
      name: "Mentioned",
      value: clip(mentions.join(" ")),
    });
  }

  if (attachments) {
    embed.addFields({
      name: "Attachments",
      value: clip(attachments),
    });
  }

  const messageAttachments = [
    ...((message as any).attachments?.values?.() ?? []),
  ] as any[];

  const imageAttachments = messageAttachments.filter((attachment: any) => {
    const contentType = attachment.contentType ?? "";
    const name = attachment.name ?? "";

    return (
      contentType.startsWith("image/") ||
      /\.(png|jpe?g|gif|webp)$/i.test(name)
    );
  });

  if (!imageAttachments.length) {
    await sendLog(message.guild, "messages", embed);
    return;
  }

  const preservedFiles: AttachmentBuilder[] = [];
  const preservedNames: string[] = [];

  for (const [index, attachment] of imageAttachments.slice(0, 10).entries()) {
    try {
      const response = await fetch(attachment.url);

      if (!response.ok) {
        console.warn(
          `Could not download deleted image ${attachment.url}: HTTP ${response.status}`,
        );
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      const originalName =
        String(attachment.name ?? `image-${index + 1}.png`)
          .replace(/[^a-zA-Z0-9._-]/g, "_")
          .slice(-150);

      const filename =
        `deleted-${message.id}-${index + 1}-${originalName}`;

      preservedFiles.push(
        new AttachmentBuilder(buffer, {
          name: filename,
          description: `Image preserved from deleted message ${message.id}`,
        }),
      );

      preservedNames.push(filename);
    } catch (error) {
      console.error(
        `Failed to preserve deleted image ${attachment.url}:`,
        error,
      );
    }
  }

  if (!preservedFiles.length) {
    await sendLog(message.guild, "messages", embed);
    return;
  }

  embed.setImage(`attachment://${preservedNames[0]}`);

  const extraImageEmbeds = preservedNames.slice(1).map(filename =>
    new EmbedBuilder()
      .setColor(RED)
      .setImage(`attachment://${filename}`),
  );

  const settings = await getGuildSettings(message.guild.id);
  const logChannelId =
    settings.logs.messages ?? settings.logs.general;

  if (!logChannelId) {
    await sendLog(message.guild, "messages", embed);
    return;
  }

  const logChannel = await message.guild.channels
    .fetch(logChannelId)
    .catch(() => null);

  if (!logChannel?.isSendable()) {
    await sendLog(message.guild, "messages", embed);
    return;
  }

  await logChannel
    .send({
      embeds: [embed, ...extraImageEmbeds].slice(0, 10),
      files: preservedFiles,
    })
    .catch(async error => {
      console.error("Failed to send deleted-image log:", error);
      await sendLog(message.guild!, "messages", embed);
    });
}

export function registerLogEvents(client: Client): void {
  // Member joins/leaves.
  client.on(Events.GuildMemberAdd, async member => {
    await sendLog(member.guild, "joinLeave", new EmbedBuilder()
      .setColor(GREEN)
      .setTitle("Member joined")
      .setDescription(memberLabel(member))
      .setThumbnail(member.user.displayAvatarURL())
      .addFields({ name: "Account created", value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:F>` })
      .setTimestamp());
  });

  client.on(Events.GuildMemberRemove, async member => {
    await sendLog(member.guild, "joinLeave", new EmbedBuilder()
      .setColor(0x6f7d76)
      .setTitle("Member left")
      .setDescription(`${member.user.tag} (${member.id})`)
      .setTimestamp());
  });

  // Member-level changes: roles, nickname, server avatar, timeout, boost state.
  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    const added = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
    const removed = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));
    const actor = await auditActor(newMember.guild, newMember.id);

    if (added.size || removed.size) {
      const fields: { name: string; value: string }[] = [];
      if (added.size) fields.push({ name: "Added", value: clip(added.map(r => `<@&${r.id}>`).join(", ")) });
      if (removed.size) fields.push({ name: "Removed", value: clip(removed.map(r => `<@&${r.id}>`).join(", ")) });
      if (actor) fields.push({ name: "Changed by", value: actor });
      await sendLog(newMember.guild, "roles", new EmbedBuilder()
        .setColor(NEUTRAL)
        .setTitle("Member roles changed")
        .setDescription(memberLabel(newMember))
        .addFields(fields)
        .setTimestamp());
    }

    const fields: { name: string; value: string; inline?: boolean }[] = [];
    if (oldMember.nickname !== newMember.nickname) fields.push({ name: "Nickname", value: `${clip(oldMember.nickname ?? "None", 450)} → ${clip(newMember.nickname ?? "None", 450)}` });
    if (oldMember.avatar !== newMember.avatar) fields.push({ name: "Server avatar", value: "Changed" });
    if (oldMember.communicationDisabledUntilTimestamp !== newMember.communicationDisabledUntilTimestamp) {
      fields.push({ name: "Timeout", value: newMember.communicationDisabledUntilTimestamp ? `<t:${Math.floor(newMember.communicationDisabledUntilTimestamp / 1000)}:F>` : "Removed" });
    }
    if (oldMember.premiumSinceTimestamp !== newMember.premiumSinceTimestamp) fields.push({ name: "Server boost", value: newMember.premiumSinceTimestamp ? "Started" : "Ended" });
    if (fields.length) {
      if (actor) fields.push({ name: "Changed by", value: actor });
      await sendLog(newMember.guild, "members", new EmbedBuilder()
        .setColor(NEUTRAL)
        .setTitle("Member updated")
        .setDescription(memberLabel(newMember))
        .setThumbnail(newMember.displayAvatarURL())
        .addFields(fields)
        .setTimestamp());
    }
  });

  // Global user profile changes (username, display name, avatar).
  client.on(Events.UserUpdate, async (oldUser, newUser) => {
    const fields: { name: string; value: string }[] = [];
    if (oldUser.username !== newUser.username) fields.push({ name: "Username", value: `${oldUser.username} → ${newUser.username}` });
    if (oldUser.globalName !== newUser.globalName) fields.push({ name: "Display name", value: `${oldUser.globalName ?? "None"} → ${newUser.globalName ?? "None"}` });
    if (oldUser.avatar !== newUser.avatar) fields.push({ name: "Avatar", value: "Changed" });
    if (!fields.length) return;

    for (const guild of client.guilds.cache.values()) {
      if (!guild.members.cache.has(newUser.id)) continue;
      await sendLog(guild, "members", new EmbedBuilder()
        .setColor(NEUTRAL)
        .setTitle("User profile changed")
        .setDescription(userLabel(newUser))
        .setThumbnail(newUser.displayAvatarURL())
        .addFields(fields)
        .setTimestamp());
    }
  });

  // Deleted/edited messages. Ordinary message sends are deliberately not logged.
  client.on(Events.MessageDelete, message => void logMessageDelete(message));

  client.on(Events.MessageBulkDelete, async (messages, channel) => {
    const guild = (channel as any).guild as Guild | undefined;
    if (!guild) return;
    const preview = messages.first(10).map(m => {
      const author = (m as any).author as User | undefined;
      return `${userLabel(author)}: ${clip((m as any).content || "[content unavailable]", 150)}`;
    }).join("\n");
    await sendLog(guild, "messages", new EmbedBuilder()
      .setColor(RED)
      .setTitle("Messages bulk deleted")
      .addFields(
        { name: "Channel", value: `<#${channel.id}>`, inline: true },
        { name: "Count", value: String(messages.size), inline: true },
        { name: "Preview", value: clip(preview || "No cached message content.") },
      )
      .setTimestamp());
  });

  client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
    if (!newMessage.guild) return;
    if (newMessage.partial) await newMessage.fetch().catch(() => undefined);
    const author = (newMessage as any).author as User | undefined;
    if (author?.bot) return;
    const oldContent = (oldMessage as any).content ?? "";
    const newContent = (newMessage as any).content ?? "";
    if (oldContent === newContent) return;

    const oldMentions = mentionSummary(oldMessage);
    const newMentions = mentionSummary(newMessage);
    const removedMentions = oldMentions.filter(x => !newMentions.includes(x));

    const embed = new EmbedBuilder()
      .setColor(removedMentions.length ? YELLOW : NEUTRAL)
      .setTitle(removedMentions.length ? "Message edited — possible ghost ping" : "Message edited")
      .addFields(
        { name: "Author", value: userLabel(author), inline: true },
        { name: "Channel", value: `<#${newMessage.channelId}>`, inline: true },
        { name: "Message", value: `[Jump to message](${newMessage.url})`, inline: true },
        { name: "Before", value: clip(oldContent || "[empty/unavailable]") },
        { name: "After", value: clip(newContent || "[empty]") },
      )
      .setTimestamp();
    if (removedMentions.length) embed.addFields({ name: "Removed mentions", value: clip(removedMentions.join(" ")) });
    await sendLog(newMessage.guild, "messages", embed);
  });

  // Channel/category/forum/voice permission and metadata changes.
  client.on(Events.ChannelCreate, async channel => {
    if (!("guild" in channel)) return;
    const actor = await auditActor(channel.guild, channel.id);
    const embed = new EmbedBuilder().setColor(GREEN).setTitle("Channel created")
      .addFields({ name: "Channel", value: `${channel} (${channel.name})` }, { name: "Type", value: String(channel.type) })
      .setTimestamp();
    if (actor) embed.addFields({ name: "Created by", value: actor });
    await sendLog(channel.guild, "channels", embed);
  });

  client.on(Events.ChannelDelete, async channel => {
    if (!("guild" in channel)) return;
    const actor = await auditActor(channel.guild, channel.id);
    const embed = new EmbedBuilder().setColor(RED).setTitle("Channel deleted")
      .addFields({ name: "Channel", value: `${channel.name} (${channel.id})` }, { name: "Type", value: String(channel.type) })
      .setTimestamp();
    if (actor) embed.addFields({ name: "Deleted by", value: actor });
    await sendLog(channel.guild, "channels", embed);
  });

  client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
    if (!("guild" in newChannel) || !("guild" in oldChannel)) return;
    const changes: string[] = [];
    const oldAny = oldChannel as any;
    const newAny = newChannel as any;
    for (const [label, key] of [["Name", "name"], ["Topic", "topic"], ["Category", "parentId"], ["NSFW", "nsfw"], ["Slowmode", "rateLimitPerUser"], ["Bitrate", "bitrate"], ["User limit", "userLimit"]] as const) {
      if (oldAny[key] !== newAny[key]) changes.push(`${label}: ${clip(oldAny[key] ?? "None", 220)} → ${clip(newAny[key] ?? "None", 220)}`);
    }
    changes.push(...permissionOverwriteChanges(oldChannel, newChannel).map(c => `Permissions: ${c}`));
    if (!changes.length) return;
    const actor = await auditActor(newChannel.guild, newChannel.id);
    const embed = new EmbedBuilder().setColor(NEUTRAL).setTitle("Channel updated")
      .setDescription(`${newChannel} (${newChannel.id})`)
      .addFields({ name: "Changes", value: clip(changes.join("\n")) })
      .setTimestamp();
    if (actor) embed.addFields({ name: "Changed by", value: actor });
    await sendLog(newChannel.guild, "channels", embed);
  });

  client.on(Events.ChannelPinsUpdate, async (channel, time) => {
    const guild = (channel as any).guild as Guild | undefined;
    if (!guild) return;
    await sendLog(guild, "channels", new EmbedBuilder().setColor(NEUTRAL).setTitle("Channel pins updated")
      .addFields({ name: "Channel", value: `<#${channel.id}>` }, { name: "Last pin timestamp", value: `<t:${Math.floor(time.getTime() / 1000)}:F>` })
      .setTimestamp());
  });

  // Roles and role permissions.
  client.on(Events.GuildRoleCreate, async role => {
    const actor = await auditActor(role.guild, role.id);
    const embed = new EmbedBuilder().setColor(GREEN).setTitle("Role created").setDescription(`${role} (${role.id})`).setTimestamp();
    if (actor) embed.addFields({ name: "Created by", value: actor });
    await sendLog(role.guild, "roles", embed);
  });

  client.on(Events.GuildRoleDelete, async role => {
    const actor = await auditActor(role.guild, role.id);
    const embed = new EmbedBuilder().setColor(RED).setTitle("Role deleted").setDescription(`${role.name} (${role.id})`).setTimestamp();
    if (actor) embed.addFields({ name: "Deleted by", value: actor });
    await sendLog(role.guild, "roles", embed);
  });

  client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
    const changes: string[] = [];
    if (oldRole.name !== newRole.name) changes.push(`Name: ${oldRole.name} → ${newRole.name}`);
    if (oldRole.color !== newRole.color) changes.push(`Color: #${oldRole.color.toString(16).padStart(6, "0")} → #${newRole.color.toString(16).padStart(6, "0")}`);
    if (oldRole.hoist !== newRole.hoist) changes.push(`Displayed separately: ${yesNo(oldRole.hoist)} → ${yesNo(newRole.hoist)}`);
    if (oldRole.mentionable !== newRole.mentionable) changes.push(`Mentionable: ${yesNo(oldRole.mentionable)} → ${yesNo(newRole.mentionable)}`);
    if (oldRole.position !== newRole.position) changes.push(`Position: ${oldRole.position} → ${newRole.position}`);
    const perms = arrayDiff(oldRole.permissions.toArray(), newRole.permissions.toArray());
    if (perms.added.length) changes.push(`Permissions added: ${perms.added.join(", ")}`);
    if (perms.removed.length) changes.push(`Permissions removed: ${perms.removed.join(", ")}`);
    if (!changes.length) return;
    const actor = await auditActor(newRole.guild, newRole.id);
    const embed = new EmbedBuilder().setColor(NEUTRAL).setTitle("Role updated").setDescription(`${newRole} (${newRole.id})`)
      .addFields({ name: "Changes", value: clip(changes.join("\n")) }).setTimestamp();
    if (actor) embed.addFields({ name: "Changed by", value: actor });
    await sendLog(newRole.guild, "roles", embed);
  });

  // Voice activity except ordinary text messages.
  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    const member = newState.member ?? oldState.member;
    if (!member) return;
    const changes: string[] = [];
    if (oldState.channelId !== newState.channelId) {
      if (!oldState.channelId && newState.channelId) changes.push(`Joined <#${newState.channelId}>`);
      else if (oldState.channelId && !newState.channelId) changes.push(`Left <#${oldState.channelId}>`);
      else changes.push(`Moved <#${oldState.channelId}> → <#${newState.channelId}>`);
    }
    if (oldState.selfMute !== newState.selfMute) changes.push(`Self mute: ${yesNo(oldState.selfMute)} → ${yesNo(newState.selfMute)}`);
    if (oldState.selfDeaf !== newState.selfDeaf) changes.push(`Self deafen: ${yesNo(oldState.selfDeaf)} → ${yesNo(newState.selfDeaf)}`);
    if (oldState.serverMute !== newState.serverMute) changes.push(`Server mute: ${yesNo(oldState.serverMute ?? false)} → ${yesNo(newState.serverMute ?? false)}`);
    if (oldState.serverDeaf !== newState.serverDeaf) changes.push(`Server deafen: ${yesNo(oldState.serverDeaf ?? false)} → ${yesNo(newState.serverDeaf ?? false)}`);
    if (oldState.streaming !== newState.streaming) changes.push(`Streaming: ${yesNo(oldState.streaming)} → ${yesNo(newState.streaming)}`);
    if (oldState.selfVideo !== newState.selfVideo) changes.push(`Camera: ${yesNo(oldState.selfVideo)} → ${yesNo(newState.selfVideo)}`);
    if (!changes.length) return;
    await sendLog(newState.guild, "voice", new EmbedBuilder().setColor(NEUTRAL).setTitle("Voice state changed")
      .setDescription(memberLabel(member)).addFields({ name: "Changes", value: clip(changes.join("\n")) }).setTimestamp());
  });

  // Server-level changes and expressions.
  client.on(Events.GuildUpdate, async (oldGuild, newGuild) => {
    const changes: string[] = [];
    const oldAny = oldGuild as any;
    const newAny = newGuild as any;
    for (const [label, key] of [["Name", "name"], ["Description", "description"], ["Verification level", "verificationLevel"], ["AFK channel", "afkChannelId"], ["AFK timeout", "afkTimeout"], ["System channel", "systemChannelId"], ["Rules channel", "rulesChannelId"], ["Public updates channel", "publicUpdatesChannelId"]] as const) {
      if (oldAny[key] !== newAny[key]) changes.push(`${label}: ${clip(oldAny[key] ?? "None", 220)} → ${clip(newAny[key] ?? "None", 220)}`);
    }
    if (oldGuild.icon !== newGuild.icon) changes.push("Server icon changed");
    if (oldGuild.banner !== newGuild.banner) changes.push("Server banner changed");
    if (!changes.length) return;
    await sendLog(newGuild, "server", new EmbedBuilder().setColor(NEUTRAL).setTitle("Server settings changed")
      .addFields({ name: "Changes", value: clip(changes.join("\n")) }).setTimestamp());
  });

  client.on(Events.GuildBanAdd, async ban => {
    await sendLog(ban.guild, "moderation", new EmbedBuilder().setColor(RED).setTitle("Member banned").setDescription(userLabel(ban.user)).setTimestamp());
  });
  client.on(Events.GuildBanRemove, async ban => {
    await sendLog(ban.guild, "moderation", new EmbedBuilder().setColor(GREEN).setTitle("Member unbanned").setDescription(userLabel(ban.user)).setTimestamp());
  });

  client.on(Events.GuildEmojiCreate, emoji => void sendLog(emoji.guild, "server", new EmbedBuilder().setColor(GREEN).setTitle("Emoji created").setDescription(`${emoji} ${emoji.name ?? "Unnamed"} (${emoji.id})`).setTimestamp()));
  client.on(Events.GuildEmojiDelete, emoji => void sendLog(emoji.guild, "server", new EmbedBuilder().setColor(RED).setTitle("Emoji deleted").setDescription(`${emoji.name ?? "Unnamed"} (${emoji.id})`).setTimestamp()));
  client.on(Events.GuildEmojiUpdate, (oldEmoji, newEmoji) => {
    if (oldEmoji.name === newEmoji.name) return;
    void sendLog(newEmoji.guild, "server", new EmbedBuilder().setColor(NEUTRAL).setTitle("Emoji updated").setDescription(`${oldEmoji.name ?? "Unnamed"} → ${newEmoji.name ?? "Unnamed"} (${newEmoji.id})`).setTimestamp());
  });

  client.on(Events.GuildStickerCreate, sticker => { if (sticker.guild) void sendLog(sticker.guild, "server", new EmbedBuilder().setColor(GREEN).setTitle("Sticker created").setDescription(`${sticker.name} (${sticker.id})`).setTimestamp()); });
  client.on(Events.GuildStickerDelete, sticker => { if (sticker.guild) void sendLog(sticker.guild, "server", new EmbedBuilder().setColor(RED).setTitle("Sticker deleted").setDescription(`${sticker.name} (${sticker.id})`).setTimestamp()); });
  client.on(Events.GuildStickerUpdate, (oldSticker, newSticker) => {
    if (!newSticker.guild) return;
    const changes: string[] = [];
    if (oldSticker.name !== newSticker.name) changes.push(`Name: ${oldSticker.name} → ${newSticker.name}`);
    if (oldSticker.description !== newSticker.description) changes.push(`Description: ${oldSticker.description ?? "None"} → ${newSticker.description ?? "None"}`);
    if (!changes.length) return;
    void sendLog(newSticker.guild, "server", new EmbedBuilder().setColor(NEUTRAL).setTitle("Sticker updated").setDescription(`${newSticker.name} (${newSticker.id})`).addFields({ name: "Changes", value: clip(changes.join("\n")) }).setTimestamp());
  });

  // Threads/forums.
  client.on(Events.ThreadCreate, (thread, newlyCreated) => {
    if (!newlyCreated) return;
    void sendLog(thread.guild, "channels", new EmbedBuilder().setColor(GREEN).setTitle("Thread created").setDescription(`${thread} (${thread.id})`).setTimestamp());
  });
  client.on(Events.ThreadDelete, thread => void sendLog(thread.guild, "channels", new EmbedBuilder().setColor(RED).setTitle("Thread deleted").setDescription(`${thread.name} (${thread.id})`).setTimestamp()));
  client.on(Events.ThreadUpdate, (oldThread, newThread) => {
    const changes: string[] = [];
    if (oldThread.name !== newThread.name) changes.push(`Name: ${oldThread.name} → ${newThread.name}`);
    if (oldThread.archived !== newThread.archived) changes.push(`Archived: ${yesNo(oldThread.archived ?? false)} → ${yesNo(newThread.archived ?? false)}`);
    if (oldThread.locked !== newThread.locked) changes.push(`Locked: ${yesNo(oldThread.locked ?? false)} → ${yesNo(newThread.locked ?? false)}`);
    if (oldThread.rateLimitPerUser !== newThread.rateLimitPerUser) changes.push(`Slowmode: ${oldThread.rateLimitPerUser} → ${newThread.rateLimitPerUser}`);
    if (!changes.length) return;
    void sendLog(newThread.guild, "channels", new EmbedBuilder().setColor(NEUTRAL).setTitle("Thread updated").setDescription(`${newThread} (${newThread.id})`).addFields({ name: "Changes", value: clip(changes.join("\n")) }).setTimestamp());
  });

  client.on(Events.WebhooksUpdate, channel => {
    void sendLog(channel.guild, "server", new EmbedBuilder().setColor(NEUTRAL).setTitle("Webhooks updated").setDescription(`${channel} (${channel.id})`).setTimestamp());
  });

  // Scheduled events.
  client.on(Events.GuildScheduledEventCreate, event => void sendLog(event.guild!, "server", new EmbedBuilder().setColor(GREEN).setTitle("Scheduled event created").setDescription(`${event.name} (${event.id})`).setTimestamp()));
  client.on(Events.GuildScheduledEventDelete, event => { if (event.guild) void sendLog(event.guild, "server", new EmbedBuilder().setColor(RED).setTitle("Scheduled event deleted").setDescription(`${event.name} (${event.id})`).setTimestamp()); });
  client.on(Events.GuildScheduledEventUpdate, (oldEvent, newEvent) => {
    if (!newEvent.guild || !oldEvent) return;
    const changes: string[] = [];
    if (oldEvent.name !== newEvent.name) changes.push(`Name: ${oldEvent.name} → ${newEvent.name}`);
    if (oldEvent.status !== newEvent.status) changes.push(`Status: ${oldEvent.status} → ${newEvent.status}`);
    if (oldEvent.scheduledStartTimestamp !== newEvent.scheduledStartTimestamp) changes.push("Start time changed");
    if (oldEvent.scheduledEndTimestamp !== newEvent.scheduledEndTimestamp) changes.push("End time changed");
    if (!changes.length) return;
    void sendLog(newEvent.guild, "server", new EmbedBuilder().setColor(NEUTRAL).setTitle("Scheduled event updated").setDescription(`${newEvent.name} (${newEvent.id})`).addFields({ name: "Changes", value: clip(changes.join("\n")) }).setTimestamp());
  });

  // Reactions.
  const logReaction = async (reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser, action: "added" | "removed") => {
    if ("bot" in user && user.bot) return;
    if (reaction.partial) await reaction.fetch().catch(() => undefined);
    const message = reaction.message;
    if (!message.guild) return;
    await sendLog(message.guild, "reactions", new EmbedBuilder().setColor(NEUTRAL).setTitle(`Reaction ${action}`).addFields(
      { name: "User", value: `<@${user.id}> (${user.id})` },
      { name: "Reaction", value: reaction.emoji.toString() },
      { name: "Channel", value: `<#${message.channelId}>` },
      { name: "Message", value: message.url }
    ).setTimestamp());
  };
  client.on(Events.MessageReactionAdd, (r, u) => void logReaction(r, u, "added"));
  client.on(Events.MessageReactionRemove, (r, u) => void logReaction(r, u, "removed"));
  client.on(Events.MessageReactionRemoveAll, message => {
    if (message.guild) void sendLog(message.guild, "reactions", new EmbedBuilder().setColor(NEUTRAL).setTitle("All reactions removed").addFields({ name: "Channel", value: `<#${message.channelId}>` }, { name: "Message", value: message.url }).setTimestamp());
  });
}
