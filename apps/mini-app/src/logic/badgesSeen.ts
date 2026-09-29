// Which earned badges the app has not celebrated yet (Week.tsx's BadgeCelebration). The seen set
// lives in localStorage; the very first run records everything as seen without celebrating, so
// someone with 12 old badges isn't greeted by 12 pop-ups. Pure; test/mini-app-week.test.ts.
export const SEEN_BADGES_KEY = "trix:v2:badges-seen";

export function unseenBadges(earned: string[], seenRaw: string | null): { show: string[]; seen: string[] } {
  let seen: string[] | null = null;
  try {
    const parsed: unknown = seenRaw ? JSON.parse(seenRaw) : null;
    if (Array.isArray(parsed)) seen = parsed.filter((c): c is string => typeof c === "string");
  } catch { /* corrupt: treat as a first run */ }
  if (!seen) return { show: [], seen: [...earned] };
  const have = new Set(seen);
  return { show: earned.filter((c) => !have.has(c)), seen: [...new Set([...seen, ...earned])] };
}
