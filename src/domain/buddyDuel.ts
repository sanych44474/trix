// Buddy duels: pure scoring/streak logic for the weekly accountability-buddy competition.
// DB access (allBuddyPairs, recordBuddyDuel, buddyWinCount, buddyDuelHistory) lives in
// db/repos/workouts.ts, next to friendIds — same "social graph" query family.

export interface DuelResult {
  weekKey: string;
  aCount: number;
  bCount: number;
  winnerId: number | null; // null = tie (including 0-0 — neither buddy trained that week)
}

/** Decide a week's winner from each side's completed-workout count. Ties are recorded, not
 * skipped — the duel still "happened" even if nobody won it, so a buddy pair's history stays
 * one row per week without gaps. */
export function decideDuel(userA: number, userB: number, weekKey: string, aCount: number, bCount: number): DuelResult {
  const winnerId = aCount === bCount ? null : aCount > bCount ? userA : userB;
  return { weekKey, aCount, bCount, winnerId };
}

/** Consecutive most-recent duel wins for `userId`, given `history` ordered most-recent-week
 * first (a tie or a loss ends the streak immediately). */
export function currentWinStreak(userId: number, history: { winnerId: number | null }[]): number {
  let n = 0;
  for (const h of history) {
    if (h.winnerId !== userId) break;
    n++;
  }
  return n;
}
