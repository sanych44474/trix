// Small, dependency-free helpers shared across the repos/ split. Kept separate from repos.ts
// itself (rather than exported from there) so every repos/*.ts concept file can import them
// without creating a cycle back through the repos.ts barrel.
export type DB = D1Database;

export const nowIso = (): string => new Date().toISOString();

/** Build a partial-UPDATE SET clause from a patch and a column spec. Only keys present
 * (!== undefined) in `patch` are emitted; `[col, ser?]` maps a patch key to its SQL column
 * and an optional value serializer (e.g. bool→int, object→JSON). Returns SET fragments and
 * their bound values in matching order. */
export function buildUpdate<T extends Record<string, unknown>>(
  patch: T,
  spec: { [K in keyof T]?: [col: string, ser?: (v: NonNullable<T[K]>) => unknown] },
): { sets: string[]; vals: unknown[] } {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const key in spec) {
    const v = patch[key];
    if (v === undefined) continue;
    const entry = spec[key]!;
    sets.push(`${entry[0]} = ?`);
    vals.push(entry[1] ? entry[1](v as NonNullable<T[Extract<keyof T, string>]>) : v);
  }
  return { sets, vals };
}

/** Parse a JSON-as-TEXT column, falling back instead of throwing on a malformed row. A crash
 * here previously took out the whole batch a row mapper was called from (e.g. every user in a
 * cron sweep), not just the one bad row — this is the one place that decision gets made. */
export function safeJsonParse<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try { return JSON.parse(text) as T; } catch { return fallback; }
}
