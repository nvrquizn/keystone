import { randomInt } from "node:crypto";

export type GiveawayStatus = "active" | "ending" | "ended" | "cancelled";

export interface GiveawayRecord {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string;
  creatorId: string;
  prize: string;
  description?: string;
  requiredRoleId?: string;
  winnersCount: number;
  createdAt: number;
  endsAt: number;
  status: GiveawayStatus;
  entries: string[];
  winners: string[];
  pastWinners: string[];
  announced: boolean;
  announcementMessageId?: string;
  lastRerollAt?: number;
  closedBy?: string;
}

export interface GiveawaysFile {
  guilds: Record<string, Record<string, GiveawayRecord>>;
}

export const DEFAULT_GIVEAWAYS: GiveawaysFile = { guilds: {} };

const UNIT_MS: Record<string, number> = {
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000,
};

export function parseGiveawayDuration(value: string): number | null {
  const match = /^(\d{1,3})\s*([mhd])$/i.exec(value.trim());
  if (!match) return null;
  const n = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  const total = n * (unit ? UNIT_MS[unit]! : 0);
  return total >= 60_000 && total <= 30 * UNIT_MS.d ? total : null;
}

/** Uniform random selection without replacement; historical winners never re-enter. */
export function selectWinners(
  entries: readonly string[],
  count: number,
  excluded: readonly string[] = [],
): string[] {
  const forbidden = new Set(excluded);
  const candidates = [...new Set(entries)].filter(id => !forbidden.has(id));
  const drawn: string[] = [];
  for (let i = 0; i < count && candidates.length; i++) {
    const index = randomInt(candidates.length);
    drawn.push(candidates[index]!);
    candidates[index] = candidates[candidates.length - 1]!;
    candidates.pop();
  }
  return drawn;
}
