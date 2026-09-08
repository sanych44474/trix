// Shareable <pre> week card, extracted from bot.ts. Built for ANY user (self via /progress,
// a trainer's client via the client card, or the Mini App /api/weekcard). Takes a bare db —
// no grammY context needed, so the webapp calls it without faking one.
import { computeXp, levelFromXp } from "../domain/gamification";
import { localParts } from "../domain/progression";
import { recentPrCount, weekStreak } from "../domain/records";
import { weekStats } from "../domain/weekCard";
import { getActivePlan, listStrength, userStatCounts, workoutLogsSince } from "../db/repos";
import { escapeHtml, t } from "../locales/i18n";
import { isoDateMinus } from "./boards";
import type { Lang } from "../types";

export interface WeekCardStats {
  since: string;
  until: string;
  done: number;
  planned: number;
  totalSets: number;
  volumeKg: number;
  prs: number;
  streak: number;
  level: number;
  xp: number;
}

// Shared by buildWeekCard (the <pre> text card) and the Mini App's canvas-rendered PNG version
// (webapp/weekCardApi.ts) — same numbers, two presentations. Returns null when the week has no
// activity to show, same rule both callers already relied on.
export async function computeWeekCardStats(
  db: D1Database,
  userId: number,
  tz: string | undefined,
  frozen?: { from: string; until: string },
): Promise<WeekCardStats | null> {
  const today = localParts(tz).date;
  const since = isoDateMinus(today, 6);
  const [allLogs, plan, statCounts, records] = await Promise.all([
    workoutLogsSince(db, userId, isoDateMinus(today, 120)),
    getActivePlan(db, userId),
    userStatCounts(db, userId).catch(() => ({ workouts: 0, nutrition: 0, checkins: 0, steps: 0, badges: 0 })),
    listStrength(db, userId).catch(() => []),
  ]);
  const stats = weekStats(allLogs.filter((l) => l.date >= since));
  if (!stats.done && !stats.skipped) return null;
  const streak = weekStreak(allLogs.filter((l) => l.completed).map((l) => l.date), today, frozen);
  const planned = plan?.split.length ?? 0;
  const lv = levelFromXp(computeXp(statCounts));
  const prs = recentPrCount(records, since);
  return { since, until: today, done: stats.done, planned, totalSets: stats.totalSets, volumeKg: stats.volumeKg, prs, streak, level: lv.level, xp: lv.xp };
}

// Text formatting split out from the stats computation so a caller that needs BOTH (the Mini
// App's /api/weekcard, which returns the text card AND the raw stats for canvas rendering)
// doesn't pay for the underlying queries twice.
export function formatWeekCardText(s: WeekCardStats, displayName: string, lang: Lang): string {
  const rows: [string, string][] = [
    [t(lang, "wcard_workouts"), s.planned ? `${s.done}/${s.planned}` : `${s.done}`],
    [t(lang, "wcard_sets"), `${s.totalSets}`],
    [t(lang, "wcard_volume"), `${s.volumeKg} ${t(lang, "unit_kg")}`],
    ...(s.prs > 0 ? ([[t(lang, "wcard_prs"), `${s.prs} 🏆`]] as [string, string][]) : []),
    [t(lang, "wcard_streak"), `${s.streak} 🔥`],
    [t(lang, "wcard_level"), `${s.level} ⭐ (${s.xp} XP)`],
  ];
  const w = Math.max(...rows.map(([l]) => l.length));
  const card = [
    `🏋️ ${displayName}`.trim(),
    `${s.since.slice(5)} → ${s.until.slice(5)}`,
    "",
    ...rows.map(([l, v]) => `${l.padEnd(w)}  ${v}`),
  ].join("\n");
  return `<pre>${escapeHtml(card)}</pre>`;
}

// Returns null when the week has no activity to show.
export async function buildWeekCard(
  db: D1Database,
  userId: number,
  tz: string | undefined,
  displayName: string,
  lang: Lang,
  frozen?: { from: string; until: string },
): Promise<string | null> {
  const s = await computeWeekCardStats(db, userId, tz, frozen);
  return s ? formatWeekCardText(s, displayName, lang) : null;
}
