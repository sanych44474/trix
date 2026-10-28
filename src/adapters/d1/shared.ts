// Small, dependency-free helpers shared by the D1 adapters (formerly src/db/repos/shared.ts).
export type DB = D1Database;

export const nowIso = (): string => new Date().toISOString();

/** SELECT ... IN (...) over any number of values: D1 binds at most 100 parameters per statement, so
 * the query runs once per slice. `fixed` params (e.g. accountId, lang) are bound before each slice;
 * `buildQuery` gets the slice's "?,?,..." list. Rows come back concatenated. */
export async function allInChunks<T>(db: DB, values: unknown[], fixed: unknown[], buildQuery: (placeholders: string) => string): Promise<T[]> {
  const size = 100 - fixed.length;
  const out: T[] = [];
  for (let i = 0; i < values.length; i += size) {
    const chunk = values.slice(i, i + size);
    const r = await db.prepare(buildQuery(chunk.map(() => "?").join(","))).bind(...fixed, ...chunk).all<T>();
    out.push(...(r.results ?? []));
  }
  return out;
}

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
