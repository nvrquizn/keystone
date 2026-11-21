// Keystone contentguard v1
import fs from "node:fs";
import path from "node:path";
import {
  ChannelType,
  Events,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { Client, Message } from "discord.js";
import type { BotCommand } from "../lib/command.js";

type GuildGuard = {
  gifs: Record<string, string>;
  textwalls: Record<string, number>;
};
type GuardStore = { guilds: Record<string, GuildGuard> };

let cache: GuardStore | undefined;

const file = () => path.join(
  process.env.DATA_DIR || path.join(process.cwd(), "data"),
  "contentguard.json"
);

function store(): GuardStore {
  if (cache) return cache;
  if (!fs.existsSync(file())) return cache = { guilds: {} };

  const parsed: unknown = JSON.parse(
    fs.readFileSync(file(), "utf8")
  );

  if (!parsed || typeof parsed !== "object" ||
      !("guilds" in parsed) ||
      !parsed.guilds ||
      typeof parsed.guilds !== "object" ||
      Array.isArray(parsed.guilds)) {
    throw new Error("Invalid contentguard.json; refusing to replace it.");
  }

  return cache = parsed as GuardStore;
}

function settings(guildId: string): GuildGuard {
  const data = store().guilds[guildId];
  return {
    gifs: data?.gifs ?? {},
    textwalls: data?.textwalls ?? {},
  };
}

function modify(
  guildId: string,
  update: (config: GuildGuard) => void
): void {
  const next: GuardStore = structuredClone(store());
  const current = next.guilds[guildId] ?? {
    gifs: {},
    textwalls: {},
  };

  current.gifs ??= {};
  current.textwalls ??= {};

  update(current);
  next.guilds[guildId] = current;

  const dest = file();
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  const tmp = dest + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
  fs.renameSync(tmp, dest);

  cache = next;
}

const channelOption = (o: any) => o
  .setName("channel")
  .setDescription("Channel to configure (also covers its threads)")
  .addChannelTypes(
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildForum
  )
  .setRequired(true);

export const contentGuardCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("contentguard")
    .setDescription("Configure GIF and text-wall filtering per channel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

    .addSubcommand(s => s
      .setName("gif-set")
      .setDescription("Require a role for GIFs in a channel")
      .addChannelOption(channelOption)
      .addRoleOption(o => o
        .setName("role")
        .setDescription("Required role / minimum role position")
        .setRequired(true)))

    .addSubcommand(s => s
      .setName("gif-remove")
      .setDescription("Disable GIF filtering in a channel")
      .addChannelOption(channelOption))

    .addSubcommand(s => s
      .setName("text-set")
      .setDescription("Remove text walls exceeding a word limit")
      .addChannelOption(channelOption)
      .addIntegerOption(o => o
        .setName("words")
        .setDescription("Maximum words (default: 1000)")
        .setMinValue(20)
        .setMaxValue(1500)))

    .addSubcommand(s => s
      .setName("text-remove")
      .setDescription("Disable text-wall filtering in a channel")
      .addChannelOption(channelOption))

    .addSubcommand(s => s
      .setName("status")
      .setDescription("Show all configured filters")),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) return;

    if (!interaction.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    )) {
      await interaction.reply({
        content: "Administrator permission required.",
        ephemeral: true,
      });
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === "status") {
      const cfg = settings(interaction.guildId);

      const gifs = Object.entries(cfg.gifs)
        .map(([id, role]) => `<#${id}>: <@&${role}>`)
        .join("\n") || "None";

      const texts = Object.entries(cfg.textwalls)
        .map(([id, n]) => `<#${id}>: ${n} words`)
        .join("\n") || "None";

      await interaction.reply({
        content: (
          `**GIF restrictions**\n${gifs}\n\n` +
          `**Text-wall restrictions**\n${texts}`
        ).slice(0, 1900),
        allowedMentions: { parse: [] },
        ephemeral: true,
      });
      return;
    }

    const channel = interaction.options.getChannel(
      "channel", true
    );

    if (sub === "gif-set") {
      const role = interaction.options.getRole("role", true);

      if (role.id === interaction.guildId) {
        await interaction.reply({
          content: "Select a role other than @everyone.",
          ephemeral: true,
        });
        return;
      }

      modify(interaction.guildId, s => {
        s.gifs[channel.id] = role.id;
      });

      await interaction.reply({
        content: (
          `GIF filtering enabled in <#${channel.id}>. ` +
          `Members need <@&${role.id}> or a higher-positioned role.`
        ),
        allowedMentions: { parse: [] },
        ephemeral: true,
      });
      return;
    }

    if (sub === "gif-remove") {
      modify(interaction.guildId, s => {
        delete s.gifs[channel.id];
      });
      await interaction.reply({
        content: `GIF filtering disabled in <#${channel.id}>.`,
        ephemeral: true,
      });
      return;
    }

    if (sub === "text-set") {
      const words = interaction.options.getInteger("words") ?? 1000;

      modify(interaction.guildId, s => {
        s.textwalls[channel.id] = words;
      });

      await interaction.reply({
        content: (
          `Text walls over **${words} words** ` +
          `will be removed in <#${channel.id}>.`
        ),
        ephemeral: true,
      });
      return;
    }

    if (sub === "text-remove") {
      modify(interaction.guildId, s => {
        delete s.textwalls[channel.id];
      });
      await interaction.reply({
        content: `Text-wall filtering disabled in <#${channel.id}>.`,
        ephemeral: true,
      });
      return;
    }
  },
};

const gifUrl =
  /https?:\/\/(?:[\w-]+\.)*(?:tenor\.com\/(?:view|search)\/|giphy\.com\/(?:gifs|media|embed)\/|klipy\.com\/gifs\/)|https?:\/\/[^\s<>]+\.gif(?=[?#\s<>]|$)/i;

function containsGif(message: Message): boolean {
  if (gifUrl.test(message.content)) return true;

  if (message.attachments.some(a =>
    a.contentType === "image/gif" ||
    /\.gif(?:$|[?#])/i.test(a.name || a.url)
  )) return true;

  return message.embeds.some(e =>
    e.data.type === "gifv" ||
    [e.url, e.image?.url, e.thumbnail?.url, e.video?.url]
      .some(u => u ? gifUrl.test(u) : false)
  );
}

function cleanName(name: string): string {
  return name.replace(/[`*_~@\\]/g, "").slice(0, 80);
}

async function removeAndNotify(
  message: Message<true>,
  reason: string
): Promise<void> {
  try {
    await message.delete();
  } catch (error) {
    console.error("[contentguard] Could not delete message:", error);
    return;
  }

  try {
    const notice = await message.channel.send({
      content: `<@${message.author.id}> ${reason}`,
      allowedMentions: {
        users: [message.author.id],
        parse: [],
      },
    });

    const timeout = setTimeout(() => {
      void notice.delete().catch(() => undefined);
    }, 15_000);

    timeout.unref();
  } catch (error) {
    console.error("[contentguard] Could not send notice:", error);
  }
}


function containsBigFontHeading(content: string): boolean {
  let insideCodeBlock = false;

  for (const line of content.split(/\r?\n/u)) {
    if (/^\s*```/u.test(line)) {
      insideCodeBlock = !insideCodeBlock;
      continue;
    }

    if (insideCodeBlock) continue;

    if (/^#{1,2}(?!#)[ \t]+\S/u.test(line)) {
      return true;
    }
  }

  return false;
}

const pendingBigFont = new Set<string>();

async function notifyBigFont(message: Message<true>): Promise<void> {
  if (pendingBigFont.has(message.id)) return;
  pendingBigFont.add(message.id);

  try {
    const notice = await message.channel.send({
      content:
        `<@${message.author.id}>, please avoid using oversized ` +
        `text formatting (\`#\` or \`##\`) in this channel. ` +
        `Your message will be removed in 10 seconds unless ` +
        `you edit it to use regular text. Thank you!`,
      allowedMentions: {
        users: [message.author.id],
        parse: [],
      },
    });

    const timer = setTimeout(async () => {
      try {
        const latest = await message.fetch();

        if (!containsBigFontHeading(latest.content)) {
          await notice.delete().catch(() => undefined);
          return;
        }

        await latest.delete();
      } catch (error) {
        console.error("[contentguard] Big-font cleanup:", error);
        await notice.delete().catch(() => undefined);
      } finally {
        pendingBigFont.delete(message.id);
      }
    }, 10_000);

    timer.unref();
  } catch (error) {
    pendingBigFont.delete(message.id);
    console.error("[contentguard] Big-font notice:", error);
  }
}

export function registerContentGuard(client: Client): void {
  client.on(Events.MessageCreate, async message => {
    try {
      if (!message.inGuild() ||
          message.author.bot ||
          message.webhookId) return;

      const cfg = settings(message.guildId);

      const parent =
        "parentId" in message.channel &&
        typeof message.channel.parentId === "string"
          ? message.channel.parentId
          : "";

      const wordLimit =
        cfg.textwalls[message.channelId] ??
        cfg.textwalls[parent];

      const requiredRole =
        cfg.gifs[message.channelId] ??
        cfg.gifs[parent];

      const bigFont = containsBigFontHeading(message.content);
      if (wordLimit === undefined && !requiredRole && !bigFont) return;

      const member = message.member ??
        await message.guild.members.fetch(message.author.id)
          .catch(() => null);

      if (!member ||
          member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        return;
      }

      const words =
        message.content.trim().match(/\S+/gu)?.length ?? 0;

      if (wordLimit !== undefined && words > wordLimit) {
        await removeAndNotify(
          message,
          `please don't send text walls. Your message exceeded ` +
          `the **${wordLimit}-word limit** for this channel.`
        );
        return;
      }

      if (requiredRole && containsGif(message)) {
        const role = message.guild.roles.cache.get(requiredRole);

        if (role && member.roles.highest.position < role.position) {
          await removeAndNotify(
            message,
            `your GIF was removed because you don't meet the ` +
            `required level (**${cleanName(role.name)}**).`
          );
          return;
        }
      }

      if (bigFont) {
        await notifyBigFont(message);
        return;
      }

    } catch (error) {
      console.error("[contentguard] Message handler error:", error);
    }
  });

  client.on(Events.MessageUpdate, async (_before, updated) => {
    try {
      const message = updated.partial
        ? await updated.fetch().catch(() => null)
        : updated;

      if (!message?.inGuild() ||
          message.author.bot ||
          message.webhookId) return;

      if (!containsBigFontHeading(message.content)) return;

      const member = message.member ??
        await message.guild.members.fetch(message.author.id)
          .catch(() => null);

      if (!member ||
          member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        return;
      }

      await notifyBigFont(message);
    } catch (error) {
      console.error("[contentguard] Message edit error:", error);
    }
  });

}
