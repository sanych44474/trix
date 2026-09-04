// XP / levels on top of the existing logs — pure math, derived from all-time counts (no new
// tables, no state to migrate). The same numbers render in /progress, the week card and the
// Mini-App, so the formula must stay deterministic from counts alone.

export interface XpCounts {
  workouts: number; // completed workout logs
  nutrition: number; // days with a food log
  checkins: number; // wellbeing check-ins
  steps: number; // days with a step log
  badges: number; // earned achievements
}

export function computeXp(c: XpCounts): number {
  return c.workouts * 50 + c.nutrition * 10 + c.checkins * 5 + c.steps * 5 + c.badges * 100;
}

/** Level L starts at 250·L·(L−1) XP → L2 at 500, L3 at 1500, L4 at 3000, L5 at 5000… */
export function xpForLevel(level: number): number {
  return 250 * level * (level - 1);
}

export interface LevelInfo {
  level: number;
  xp: number;
  intoLevel: number; // XP earned inside the current level
  needed: number; // XP span of the current level (intoLevel/needed → progress bar)
}

export function levelFromXp(xp: number): LevelInfo {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  const base = xpForLevel(level);
  return { level, xp, intoLevel: xp - base, needed: xpForLevel(level + 1) - base };
}

export interface LevelTransition {
  level: number;
  changed: boolean; // lastLevel is stale and should be persisted
  leveledUp: boolean; // level actually went up (not just first sighting)
  badge: "level_10" | "level_5" | null;
}

/** Decides what a fresh level reading means against the user's last-seen level — shared by
 * every XP-earning surface (chat celebration, Mini App save response) so the level-up threshold
 * and badge tier are decided once. Does not touch storage; the caller persists `level` when
 * `changed` and awards `badge` when non-null. */
export function levelTransition(level: number, lastLevel: number | undefined): LevelTransition {
  const changed = lastLevel !== level;
  const leveledUp = changed && lastLevel !== undefined && level > lastLevel;
  const badge = leveledUp ? (level >= 10 ? "level_10" : level >= 5 ? "level_5" : null) : null;
  return { level, changed, leveledUp, badge };
}
