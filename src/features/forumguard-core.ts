/** Conservative text checks: no automatic disciplinary decisions. */
export function normalizeTitle(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

export function titleSimilarity(a: string, b: string): number {
  const left = normalizeTitle(a);
  const right = normalizeTitle(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const x = new Set(left.split(" "));
  const y = new Set(right.split(" "));
  const shared = [...x].filter(word => y.has(word)).length;
  return shared / (x.size + y.size - shared);
}

export interface TitleCandidate { id: string; name: string; }

export function possibleDuplicate(
  title: string,
  candidates: TitleCandidate[],
): (TitleCandidate & { score: number }) | null {
  // Short titles like "Jaguar" and "Snow Leopard" frequently represent different ideas.
  if (normalizeTitle(title).split(" ").length < 3) return null;
  return candidates
    .filter(c => normalizeTitle(c.name).split(" ").length >= 3)
    .map(c => ({ ...c, score: titleSimilarity(title, c.name) }))
    .filter(c => c.score >= 0.85)
    .sort((a, b) => b.score - a.score)[0] ?? null;
}

export function isBumpOnly(message: string): boolean {
  // Match replies whose purpose is only to bump a thread. Do not match normal
  // discussions about bumping, e.g. "why can't we bump?" or "bumping isn't allowed".
  const normalized = message.normalize("NFKC").toLocaleLowerCase("en-US").trim()
    .replace(/^[\s.!?*~_]+|[\s.!?*~_]+$/g, "");
  if (!normalized) return false;
  const tokens = normalized.split(/\s+/);
  if (tokens.length > 4) return false;
  const clean = (token: string): string => token.replace(/[.!?*~_]+$/g, "");
  if (!/^(?:b+u+m+p+(?:ing)?|up+|boost)$/.test(clean(tokens[0]!))) return false;
  return tokens.slice(1).every(token =>
    /^(?:b+u+m+p+(?:ing)?|this|post|thread|again|please|pls|it|up+|boost|for|visibility)$/.test(clean(token))
  );
}

/** Timestamps only, kept in process memory; reset whenever Keystone restarts. */
export class RollingCounter {
  private readonly entries = new Map<string, number[]>();

  add(key: string, now: number, windowMs: number): number {
    const values = (this.entries.get(key) ?? []).filter(t => now - t < windowMs);
    values.push(now);
    this.entries.set(key, values);
    if (this.entries.size > 3000) this.prune(now, 24 * 60 * 60 * 1000);
    return values.length;
  }

  private prune(now: number, maxAge: number): void {
    for (const [key, times] of this.entries) {
      const active = times.filter(t => now - t < maxAge);
      if (active.length) this.entries.set(key, active);
      else this.entries.delete(key);
    }
  }
}