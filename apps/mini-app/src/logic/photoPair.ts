// Which two progress photos to show side by side on the Progress screen: the newest, and the one
// closest to `targetDays` before it (the oldest if none is that old) — "a month ago vs now" —
// plus the weight logged nearest each photo's date (within 3 days), so the pair tells a story
// with numbers. Pure; test/mini-app-photo-pair.test.ts.

export interface Photo { id: number; takenAt: string }
export interface WeightPoint { date: string; kg: number }

const day = (s: string) => Date.parse(s.slice(0, 10));

export function pickPhotoPair<P extends Photo>(photos: P[], targetDays = 30): { before: P; after: P; days: number } | null {
  const sorted = [...photos].filter((p) => !Number.isNaN(day(p.takenAt))).sort((a, b) => day(a.takenAt) - day(b.takenAt));
  if (sorted.length < 2) return null;
  const after = sorted[sorted.length - 1]!;
  const goal = day(after.takenAt) - targetDays * 86_400_000;
  const earlier = sorted.slice(0, -1).filter((p) => day(p.takenAt) < day(after.takenAt));
  if (!earlier.length) return null;
  const before = earlier.reduce((best, p) => (Math.abs(day(p.takenAt) - goal) < Math.abs(day(best.takenAt) - goal) ? p : best));
  return { before, after, days: Math.round((day(after.takenAt) - day(before.takenAt)) / 86_400_000) };
}

export function weightNear(points: WeightPoint[], date: string, maxDays = 3): number | undefined {
  let best: WeightPoint | undefined;
  for (const p of points) {
    const d = Math.abs(day(p.date) - day(date)) / 86_400_000;
    if (d <= maxDays && (!best || d < Math.abs(day(best.date) - day(date)) / 86_400_000)) best = p;
  }
  return best?.kg;
}
