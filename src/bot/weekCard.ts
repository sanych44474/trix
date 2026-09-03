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

// Returns null when the week has no activity to show.
export async function buildWeekCard(
  db: D1Database,
  userId: number,
  tz: string | undefined,
  displayName: string,
  lang: Lang,
  frozen?: { from: string; until: string },
): Promise<string | null> {
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
  const rows: [string, string][] = [
    [t(lang, "wcard_workouts"), planned ? `${stats.done}/${planned}` : `${stats.done}`],
    [t(lang, "wcard_sets"), `${stats.totalSets}`],
    [t(lang, "wcard_volume"), `${stats.volumeKg} ${t(lang, "unit_kg")}`],
    ...(prs > 0 ? ([[t(lang, "wcard_prs"), `${prs} 🏆`]] as [string, string][]) : []),
    [t(lang, "wcard_streak"), `${streak} 🔥`],
    [t(lang, "wcard_level"), `${lv.level} ⭐ (${lv.xp} XP)`],
  ];
  const w = Math.max(...rows.map(([l]) => l.length));
  const card = [
    `🏋️ ${displayName}`.trim(),
    `${since.slice(5)} → ${today.slice(5)}`,
    "",
    ...rows.map(([l, v]) => `${l.padEnd(w)}  ${v}`),
  ].join("\n");
  return `<pre>${escapeHtml(card)}</pre>`;
}
