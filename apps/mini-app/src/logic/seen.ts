// "Last seen" for the owner roster: today / yesterday / N days ago / a date. Pure; test/mini-app-seen.test.ts.
export type SeenLabel = { key: "seen_never" | "seen_today" | "seen_yesterday" | "seen_days" | "seen_date"; n?: number; date?: string };

export function seenLabel(iso: string | undefined, now: Date): SeenLabel {
  if (!iso) return { key: "seen_never" };
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return { key: "seen_never" };
  const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const days = Math.round((day(now) - day(new Date(t))) / 86_400_000);
  if (days <= 0) return { key: "seen_today" };
  if (days === 1) return { key: "seen_yesterday" };
  if (days <= 30) return { key: "seen_days", n: days };
  return { key: "seen_date", date: iso.slice(0, 10) };
}

/** Never-seen last; otherwise most recent first. */
export function bySeenDesc<T extends { lastSeen?: string }>(a: T, b: T): number {
  return (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "");
}
