import fs from "node:fs";
import path from "node:path";
import {
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

import type { BotCommand } from "../lib/command.js";
import { requireStaff } from "../lib/permissions.js";

type Rec = Record<string, unknown> & {
  __path?: string[];
};

const FIELDS = {
  guild: [
    "guildId",
    "guild_id",
    "serverId",
    "server_id",
  ],

  user: [
    "userId",
    "user_id",
    "memberId",
    "member_id",
    "targetId",
    "target_id",
  ],

  mod: [
    "moderatorId",
    "moderator_id",
    "staffId",
    "staff_id",
    "authorId",
    "author_id",
    "actorId",
    "actor_id",
    "createdBy",
    "created_by",
    "modId",
    "mod_id",
  ],

  date: [
    "createdAt",
    "created_at",
    "timestamp",
    "created",
    "date",
    "at",
    "issuedAt",
    "issued_at",
  ],
};

function str(
  record: Rec,
  names: string[],
): string | null {
  for (const name of names) {
    const value = record[name];

    if (
      typeof value === "string" &&
      value.trim()
    ) {
      return value.trim();
    }

    if (typeof value === "number") {
      return String(value);
    }
  }

  return null;
}

function body(record: Rec): string {
  return (
    str(record, [
      "reason",
      "note",
      "body",
      "text",
      "content",
      "message",
    ]) ?? ""
  );
}

function walk(
  value: unknown,
  pathParts: string[] = [],
  output: Rec[] = [],
): Rec[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walk(
        item,
        [...pathParts, String(index)],
        output,
      );
    });

    return output;
  }

  if (
    !value ||
    typeof value !== "object"
  ) {
    return output;
  }

  const object =
    value as Record<string, unknown>;

  const hasId =
    typeof object.id === "string" ||
    typeof object.id === "number";

  const looksLikeRecord =
    hasId &&
    (
      "type" in object ||
      "kind" in object ||
      "reason" in object ||
      "note" in object ||
      "body" in object ||
      "content" in object ||
      "text" in object
    );

  if (looksLikeRecord) {
    output.push({
      ...object,
      __path: pathParts,
    });
  }

  for (
    const [key, child]
    of Object.entries(object)
  ) {
    if (
      child &&
      typeof child === "object"
    ) {
      walk(
        child,
        [...pathParts, key],
        output,
      );
    }
  }

  return output;
}

function belongs(
  record: Rec,
  wanted: string,
  fields: string[],
): boolean {
  const explicit =
    str(record, fields);

  if (explicit) {
    return explicit === wanted;
  }

  return (
    record.__path?.some(part =>
      part.includes(wanted)
    ) ?? false
  );
}

function kind(record: Rec): string {
  return (
    str(record, [
      "type",
      "kind",
      "category",
      "action",
    ]) ?? ""
  ).toLowerCase();
}

function parseExpiry(
  text: string,
): Date | null {
  const raw =
    text.match(
      /(?:^|\n)Expires:\s*([^\n]+)/i,
    )?.[1]?.trim();

  if (
    !raw ||
    raw.toLowerCase() === "never"
  ) {
    return null;
  }

  const date = new Date(raw);

  return Number.isNaN(date.getTime())
    ? null
    : date;
}

function cleanReason(
  text: string,
): string {
  return (
    text
      .replace(
        /(?:^|\n)Expires:\s*[^\n]+/i,
        "",
      )
      .trim() ||
    "No reason stored."
  );
}

function dateOf(
  record: Rec,
): Date | null {
  const raw =
    str(record, FIELDS.date);

  if (!raw) return null;

  let date: Date;

  if (/^\d+$/.test(raw)) {
    let value = Number(raw);

    if (value < 10_000_000_000) {
      value *= 1000;
    }

    date = new Date(value);
  } else {
    date = new Date(raw);
  }

  return Number.isNaN(date.getTime())
    ? null
    : date;
}

function discordTime(
  date: Date | null,
): string {
  if (!date) return "Unknown";

  const seconds =
    Math.floor(date.getTime() / 1000);

  return (
    `<t:${seconds}:F> ` +
    `(<t:${seconds}:R>)`
  );
}

function cut(
  text: string,
  max: number,
): string {
  if (text.length <= max) {
    return text;
  }

  return (
    text.slice(0, max - 3) +
    "..."
  );
}

export const warningsCommand:
  BotCommand = {

  data: new SlashCommandBuilder()
    .setName("warnings")
    .setDescription(
      "View a member's warning history.",
    )
    .setDMPermission(false)
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ModerateMembers,
    )
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Member")
        .setRequired(true),
    ),

  async execute(interaction) {
    if (
      !(await requireStaff(interaction)) ||
      !interaction.inCachedGuild()
    ) {
      return;
    }

    const user =
      interaction.options.getUser(
        "user",
        true,
      );

    const file = path.join(
      process.env.DATA_DIR ||
        path.join(
          process.cwd(),
          "data",
        ),
      "modnotes.json",
    );

    let parsed: unknown;

    try {
      parsed = JSON.parse(
        fs.readFileSync(
          file,
          "utf8",
        ),
      ) as unknown;
    } catch {
      await interaction.reply({
        content:
          "Keystone could not read modnotes.json.",
      });

      return;
    }

    const records =
      walk(parsed).filter(record =>
        belongs(
          record,
          interaction.guild.id,
          FIELDS.guild,
        ) &&
        belongs(
          record,
          user.id,
          FIELDS.user,
        ),
      );

    const warnings =
      records.filter(record =>
        kind(record) === "warning" ||
        /(?:^|\n)Expires:\s*/i.test(
          body(record),
        ),
      );

    if (!warnings.length) {
      await interaction.reply({
        content:
          `${user.tag} has no recorded warnings.`,
      });

      return;
    }

    const revoked =
      new Map<
        string,
        {
          reason: string;
          mod: string | null;
          date: Date | null;
        }
      >();

    for (const record of records) {
      const text = body(record);

      const id =
        text.match(
          /Revoked warning\s+([^\s.]+)\.?/i,
        )?.[1];

      if (!id) continue;

      revoked.set(id, {
        reason:
          text.match(
            /Reason:\s*([\s\S]+)/i,
          )?.[1]?.trim() ??
          "No revocation reason stored.",

        mod:
          str(record, FIELDS.mod),

        date:
          dateOf(record),
      });
    }

    const normalized =
      warnings
        .map(record => {
          const id =
            str(record, ["id"]) ??
            "Unknown";

          const text =
            body(record);

          const expiry =
            parseExpiry(text);

          const removal =
            revoked.get(id) ?? null;

          const status =
            removal
              ? "REMOVED"
              : expiry &&
                  expiry.getTime() <=
                    Date.now()
                ? "EXPIRED"
                : "ACTIVE";

          return {
            id,
            text,
            expiry,
            removal,
            status,
            mod:
              str(
                record,
                FIELDS.mod,
              ),

            date:
              dateOf(record),
          };
        })
        .sort(
          (a, b) =>
            (
              b.date?.getTime() ??
              0
            ) -
            (
              a.date?.getTime() ??
              0
            ),
        );

    const active =
      normalized.filter(
        warning =>
          warning.status ===
          "ACTIVE",
      ).length;

    const expired =
      normalized.filter(
        warning =>
          warning.status ===
          "EXPIRED",
      ).length;

    const removed =
      normalized.filter(
        warning =>
          warning.status ===
          "REMOVED",
      ).length;

    await interaction.reply({
      content:
        `**Warning history for ${user.tag}**\n` +
        `Total: **${normalized.length}** • ` +
        `Active: **${active}** • ` +
        `Expired: **${expired}** • ` +
        `Removed: **${removed}**`,

      ephemeral: true,
    });

    for (
      const warning of normalized
    ) {
      const icon =
        warning.status === "ACTIVE"
          ? "🟢"
          : warning.status ===
              "EXPIRED"
            ? "🟡"
            : "⚪";

      const lines = [
        `${icon} **${warning.status} — ${warning.id}**`,

        `**Reason:** ${
          cut(
            cleanReason(
              warning.text,
            ),
            650,
          )
        }`,

        `**Issued by:** ${
          warning.mod
            ? `<@${warning.mod}> (${warning.mod})`
            : "Unknown / legacy warning"
        }`,

        `**Issued:** ${
          discordTime(
            warning.date,
          )
        }`,

        `**Expires:** ${
          warning.expiry
            ? discordTime(
                warning.expiry,
              )
            : "Never"
        }`,
      ];

      if (warning.removal) {
        lines.push(
          `**Removal reason:** ${
            cut(
              warning.removal.reason,
              350,
            )
          }`,
        );

        lines.push(
          `**Removed by:** ${
            warning.removal.mod
              ? `<@${warning.removal.mod}> (${warning.removal.mod})`
              : "Unknown"
          }`,
        );

        lines.push(
          `**Removed:** ${
            discordTime(
              warning.removal.date,
            )
          }`,
        );
      }

      await interaction.followUp({
        content:
          cut(
            lines.join("\n"),
            1950,
          ),

      });
    }
  },
};
