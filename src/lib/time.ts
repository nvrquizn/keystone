const UNITS: Record<string, number> = {
  s: 1_000,
  sec: 1_000,
  secs: 1_000,
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
  w: 604_800_000,
  week: 604_800_000,
  weeks: 604_800_000,
};

export function parseDuration(input: string): number | null {
  const match = input.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([a-z]+)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = UNITS[match[2] ?? ""];
  if (!Number.isFinite(amount) || !unit) return null;
  return Math.floor(amount * unit);
}
