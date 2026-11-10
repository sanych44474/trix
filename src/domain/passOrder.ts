// The order the hourly scheduler pass visits users in. It used to be whatever order the database
// returned, the same every hour, so a pass cut short by a Worker limit dropped the same tail of
// users every hour. Users are visited in id order from a start that moves each hour: a cut-short
// pass still loses someone, but never the same people hour after hour.

/** Knuth's multiplicative hash constant: consecutive hours land on well-spread starts. */
const SPREAD = 2654435761;

export function rotateForHour<T extends { _id: number }>(users: T[], hourIndex: number): T[] {
  if (!users.length) return [];
  const sorted = [...users].sort((a, b) => a._id - b._id);
  const start = Number((BigInt(Math.max(0, Math.floor(hourIndex))) * BigInt(SPREAD)) % BigInt(sorted.length));
  return [...sorted.slice(start), ...sorted.slice(0, start)];
}
