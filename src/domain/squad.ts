// Squad scoreboard — pure, no DB. Deliberately NOT the global leaderboard's rank(): that one
// drops anyone on zero, which is right for an opt-in public board and wrong for a group of
// friends, where "who hasn't been in yet this week" is the entire point of the thing existing.

export interface SquadMember {
  userId: number;
  name: string;
}

export interface SquadEntry {
  userId: number;
  name: string;
  workouts: number;
}

export interface SquadWeek {
  entries: SquadEntry[]; // every member, best first; zeros included
  total: number; // sessions logged by the whole squad this week
  silent: number; // members still on zero
}

/**
 * This week's completed sessions per squad member. `dates` is the raw (userId, date) stream of
 * completed workouts; anything before `weekStart` or from a non-member is ignored. Ties break on
 * name so the order is stable from one post to the next.
 */
export function squadWeek(members: SquadMember[], dates: { userId: number; date: string }[], weekStart: string): SquadWeek {
  const counts = new Map<number, number>();
  for (const m of members) counts.set(m.userId, 0);
  const seen = new Set<string>(); // one session per member per day, however it got logged
  for (const d of dates) {
    if (d.date < weekStart || !counts.has(d.userId)) continue;
    const key = `${d.userId}:${d.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    counts.set(d.userId, (counts.get(d.userId) ?? 0) + 1);
  }
  const entries = members
    .map((m) => ({ userId: m.userId, name: m.name, workouts: counts.get(m.userId) ?? 0 }))
    .sort((a, b) => b.workouts - a.workouts || a.name.localeCompare(b.name));
  const total = entries.reduce((s, e) => s + e.workouts, 0);
  return { entries, total, silent: entries.filter((e) => e.workouts === 0).length };
}

/** Medal for a podium place, or a bullet. Ties share a medal — three people on four sessions are
 * all in first place, and pretending otherwise is how a friendly board turns sour. */
export function squadMedal(entries: SquadEntry[], index: number): string {
  const e = entries[index];
  if (!e || e.workouts === 0) return "·";
  const better = entries.filter((x) => x.workouts > e.workouts).length;
  return ["🥇", "🥈", "🥉"][better] ?? "·";
}
