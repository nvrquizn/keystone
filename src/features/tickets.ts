import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type TextChannel,
} from "discord.js";
import { getGuildSettings, updateGuildSettings } from "../storage/settings.js";
import { sendLog } from "../lib/logging.js";

export const TICKET_OPEN_ID = "feral:ticket:open";
export const TICKET_CATEGORY_ID = "feral:ticket:category";
export const TICKET_CLOSE_ID = "feral:ticket:close";
export const TICKET_OWNER_ONLY_ID = "feral:ticket:owner-only";
export const TICKET_DELETE_ID = "feral:ticket:delete";

type TicketKind = "game" | "server" | "creator" | "other";

const TICKET_KINDS: Record<
  TicketKind,
  {
    label: string;
    description: string;
    emoji: string;
    categoryName: string;
  }
> = {
  game: {
    label: "Game Issues",
    description: "Bugs, exploiters, purchases, progress, or gameplay issues",
    emoji: "🎮",
    categoryName: "game issues",
  },
  server: {
    label: "Server Support",
    description: "Verification, Discord issues, reports, or moderation help",
    emoji: "🛠️",
    categoryName: "server support",
  },
  creator: {
    label: "Creator & Business",
    description: "Content creators, partnerships, press, or business inquiries",
    emoji: "🎥",
    categoryName: "creator business",
  },
  other: {
    label: "Other",
    description: "Anything that does not fit the categories above",
    emoji: "📋",
    categoryName: "other",
  },
};

function safeName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 28) || "member";
}

function normalizeCategoryName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function ticketOwnerId(channel: TextChannel): string | undefined {
  return channel.topic?.match(/owner:(\d+)/)?.[1];
}

function ticketNumber(channel: TextChannel): string | undefined {
  return channel.topic?.match(/number:(\d+)/)?.[1];
}

function isClosed(channel: TextChannel): boolean {
  return channel.topic?.includes("status:closed") ?? false;
}

function isOwnerOnly(channel: TextChannel): boolean {
  return channel.topic?.includes("privacy:owner-only") ?? false;
}

function buildTopic(
  ownerId: string,
  number: number,
  closed = false,
  ownerOnly = false,
): string {
  return `FERAL ticket owner:${ownerId} number:${number} status:${
    closed ? "closed" : "open"
  } privacy:${ownerOnly ? "owner-only" : "staff"}`;
}

function openControls(ownerOnly = false) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(TICKET_CLOSE_ID)
        .setLabel("Close")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId(TICKET_OWNER_ONLY_ID)
        .setLabel(ownerOnly ? "Owner Only Enabled" : "Owner Only")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(ownerOnly),
    ),
  ];
}

function closedControls() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(TICKET_DELETE_ID)
        .setLabel("Delete")
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

export function ticketPanelComponents() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(TICKET_OPEN_ID)
        .setLabel("Open a ticket")
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

function ticketCategoryPicker() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(TICKET_CATEGORY_ID)
    .setPlaceholder("What is your ticket about?")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      Object.entries(TICKET_KINDS).map(([value, config]) => ({
        label: config.label,
        description: config.description,
        emoji: config.emoji,
        value,
      })),
    );

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
  ];
}

async function nextTicketNumber(guildId: string): Promise<number> {
  let number = 1;

  await updateGuildSettings(guildId, settings => {
    number = settings.tickets.nextNumber ?? 1;
    settings.tickets.nextNumber = number + 1;
  });

  return number;
}

function findCategoryForKind(
  guild: Guild,
  kind: TicketKind,
): string | undefined {
  const expected = TICKET_KINDS[kind].categoryName;

  const category = guild.channels.cache.find(channel => {
    if (channel.type !== ChannelType.GuildCategory) return false;

    return normalizeCategoryName(channel.name) === expected;
  });

  return category?.id;
}

async function createTicket(
  guild: Guild,
  member: GuildMember,
  kind: TicketKind,
): Promise<TextChannel> {
  const settings = await getGuildSettings(guild.id);

  const existing = guild.channels.cache.find(
    c =>
      c.type === ChannelType.GuildText &&
      c.topic?.includes(`FERAL ticket owner:${member.id}`) &&
      !c.topic?.includes("status:closed"),
  ) as TextChannel | undefined;

  if (existing) return existing;

  const categoryId = findCategoryForKind(guild, kind);

  if (!categoryId) {
    throw new Error(
      `I could not find the Discord category for "${TICKET_KINDS[kind].label}". Please tell staff.`,
    );
  }

  const number = await nextTicketNumber(guild.id);
  const numberText = String(number).padStart(4, "0");

  const overwrites: any[] = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: member.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
  ];

  for (const roleId of settings.tickets.staffRoleIds) {
    overwrites.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
      ],
    });
  }

  // The guild owner always retains access, including Owner Only tickets.
  overwrites.push({
    id: guild.ownerId,
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.ManageMessages,
    ],
  });

  const channel = await guild.channels.create({
    name: `ticket-${numberText}-${safeName(member.user.username)}`,
    type: ChannelType.GuildText,
    parent: categoryId,
    topic: buildTopic(member.id, number),
    permissionOverwrites: overwrites,
  });

  const ticketKind = TICKET_KINDS[kind];

  await channel.send({
    content: `${member}`,
    embeds: [
      new EmbedBuilder()
        .setColor(0x7f9a8c)
        .setTitle(`Ticket #${numberText}`)
        .setDescription(
          "Describe what you need help with. Staff will respond here when available.",
        )
        .addFields({
          name: "Ticket type",
          value: `${ticketKind.emoji} ${ticketKind.label}`,
        }),
    ],
    components: openControls(),
  });

  return channel;
}

async function transcript(channel: TextChannel): Promise<string> {
  const all: any[] = [];
  let before: string | undefined;

  while (all.length < 1000) {
    const batch = await channel.messages.fetch({ limit: 100, before });

    if (!batch.size) break;

    all.push(...batch.values());
    before = batch.last()?.id;

    if (batch.size < 100) break;
  }

  return all
    .reverse()
    .map(m => {
      const attachments = [...m.attachments.values()]
        .map((a: any) => a.url)
        .join(" ");

      const line = `[${new Date(m.createdTimestamp).toISOString()}] ${
        m.author.tag
      }: ${m.cleanContent}`;

      return attachments ? `${line} ${attachments}` : line;
    })
    .join("\n")
    .slice(0, 900_000);
}

async function isTicketStaff(
  interaction: ButtonInteraction<"cached">,
  settings: Awaited<ReturnType<typeof getGuildSettings>>,
): Promise<boolean> {
  const member = interaction.member as GuildMember;

  return (
    interaction.user.id === interaction.guild.ownerId ||
    settings.tickets.staffRoleIds.some(id =>
      member.roles.cache.has(id),
    ) ||
    member.permissions.has(PermissionFlagsBits.ManageChannels)
  );
}

export function registerTicketInteractions(client: Client): void {
  client.on("interactionCreate", async interaction => {
    if (!interaction.inCachedGuild()) return;

    /*
     * OPEN BUTTON
     *
     * This no longer immediately creates a ticket.
     * It only shows the category selector.
     */
    if (
      interaction.isButton() &&
      interaction.customId === TICKET_OPEN_ID
    ) {
      await interaction.reply({
        content: "What is your ticket about?",
        components: ticketCategoryPicker(),
        ephemeral: true,
      });

      return;
    }

    /*
     * CATEGORY SELECTOR
     *
     * Only new tickets pass through this path.
     * Existing ticket channels are not moved or modified.
     */
    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === TICKET_CATEGORY_ID
    ) {
      const selected = interaction.values[0] as TicketKind | undefined;

      if (!selected || !(selected in TICKET_KINDS)) {
        await interaction.reply({
          content: "That ticket category is not valid.",
          ephemeral: true,
        });

        return;
      }

      const member = interaction.member as GuildMember;

      await interaction.deferReply({ ephemeral: true });

      try {
        const channel = await createTicket(
          interaction.guild,
          member,
          selected,
        );

        await interaction.editReply({
          content: `Your ticket is ${channel}.`,
          components: [],
        });
      } catch (error) {
        await interaction.editReply({
          content:
            error instanceof Error
              ? error.message
              : "Could not create the ticket.",
          components: [],
        });
      }

      return;
    }

    /*
     * Everything below here is the existing ticket-management system.
     * It intentionally continues to work with old tickets.
     */
    if (!interaction.isButton()) return;

    const channel = interaction.channel;

    if (
      !channel ||
      channel.type !== ChannelType.GuildText ||
      !channel.topic?.startsWith("FERAL ticket owner:")
    ) {
      return;
    }

    const ownerId = ticketOwnerId(channel);
    const number = Number(ticketNumber(channel) ?? "0");
    const settings = await getGuildSettings(interaction.guild.id);
    const staff = await isTicketStaff(interaction, settings);

    if (interaction.customId === TICKET_OWNER_ONLY_ID) {
      if (interaction.user.id !== ownerId) {
        return void await interaction.reply({
          content: "Only the ticket owner can enable Owner Only mode.",
          ephemeral: true,
        });
      }

      if (isOwnerOnly(channel)) {
        return void await interaction.reply({
          content: "This ticket is already Owner Only.",
          ephemeral: true,
        });
      }

      for (const roleId of settings.tickets.staffRoleIds) {
        await channel.permissionOverwrites
          .edit(roleId, { ViewChannel: false })
          .catch(() => undefined);
      }

      await channel.permissionOverwrites.edit(
        interaction.guild.ownerId,
        {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          ManageMessages: true,
        },
      );

      await channel.setTopic(
        buildTopic(ownerId!, number, false, true),
      );

      await interaction.update({
        components: openControls(true),
      });

      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x8297ab)
            .setDescription(
              "Owner Only mode enabled. This ticket is now visible only to the ticket owner and server owner.",
            ),
        ],
      });

      return;
    }

    if (interaction.customId === TICKET_CLOSE_ID) {
      if (isClosed(channel)) {
        return void await interaction.reply({
          content: "This ticket is already closed.",
          ephemeral: true,
        });
      }

      if (interaction.user.id !== ownerId && !staff) {
        return void await interaction.reply({
          content: "You do not have permission to close this ticket.",
          ephemeral: true,
        });
      }

      await interaction.deferReply({ ephemeral: true });

      if (ownerId) {
        await channel.permissionOverwrites
          .edit(ownerId, {
            SendMessages: false,
            AddReactions: false,
          })
          .catch(() => undefined);
      }

      const ownerOnly = isOwnerOnly(channel);

      await channel.setTopic(
        buildTopic(ownerId!, number, true, ownerOnly),
      );

      const cleanBase = channel.name.replace(
        /^(ticket|closed)-/,
        "",
      );

      await channel
        .setName(`closed-${cleanBase}`.slice(0, 100))
        .catch(() => undefined);

      await interaction.message
        .edit({ components: [] })
        .catch(() => undefined);

      const numberText = String(number).padStart(4, "0");

      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x8297ab)
            .setTitle(`Ticket #${numberText} closed`)
            .setDescription(`Closed by ${interaction.user}.`)
            .setTimestamp(),
        ],
        components: closedControls(),
      });

      const logEmbed = new EmbedBuilder()
        .setColor(0x8297ab)
        .setTitle("Ticket closed")
        .addFields(
          {
            name: "Channel",
            value: channel.name,
          },
          {
            name: "Closed by",
            value: `${interaction.user.tag} (${interaction.user.id})`,
          },
          {
            name: "Owner",
            value: ownerId
              ? `<@${ownerId}> (${ownerId})`
              : "Unknown",
          },
        )
        .setTimestamp();

      // Archive the transcript once, at close time.
      const text = await transcript(channel);
      const logId = settings.logs.tickets;

      if (logId) {
        const logChannel = await interaction.guild.channels
          .fetch(logId)
          .catch(() => null);

        if (logChannel?.isSendable()) {
          const file = new AttachmentBuilder(
            Buffer.from(
              text || "No transcript content.",
              "utf8",
            ),
            {
              name: `${channel.name}.txt`,
            },
          );

          await logChannel
            .send({
              embeds: [logEmbed],
              files: [file],
            })
            .catch(() => undefined);
        } else {
          await sendLog(
            interaction.guild,
            "tickets",
            logEmbed,
          );
        }
      } else {
        await sendLog(
          interaction.guild,
          "tickets",
          logEmbed,
        );
      }

      await interaction.editReply("Ticket closed.");
      return;
    }

    if (interaction.customId === TICKET_DELETE_ID) {
      if (!staff) {
        return void await interaction.reply({
          content: "Only ticket staff can delete a ticket.",
          ephemeral: true,
        });
      }

      await interaction.reply({
        content: "Deleting ticket…",
        ephemeral: true,
      });

      const deleteEmbed = new EmbedBuilder()
        .setColor(0xc45c5c)
        .setTitle("Ticket deleted")
        .setDescription(
          `${interaction.user} deleted ${channel.name}.`,
        )
        .setTimestamp();

      await sendLog(
        interaction.guild,
        "tickets",
        deleteEmbed,
      );

      setTimeout(
        () =>
          void channel
            .delete(
              `Ticket deleted by ${interaction.user.tag}`,
            )
            .catch(() => undefined),
        1200,
      );
    }
  });
}
