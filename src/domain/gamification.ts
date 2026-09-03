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
