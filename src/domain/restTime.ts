// Rest between sets as written in a plan ("90s", "2-3 min", "3 хв", "1:30", "2") -> seconds.
// The plan text comes from the AI, trainers and the bank, so units vary; parseInt on it read
// "2-3 min" as 2 seconds. A range takes its lower bound; a bare number up to 10 is minutes (no
// one rests 3 seconds between sets), above that seconds. Undefined when nothing usable is there.

const MIN_SEC = 10;
const MAX_SEC = 900;

export function parseRestSec(rest: string | undefined | null): number | undefined {
  const s = String(rest ?? "").trim().toLowerCase().replace(",", ".");
  if (!s) return undefined;
  const clock = /^(\d{1,2}):(\d{2})/.exec(s); // "1:30"
  if (clock) return bound(Number(clock[1]) * 60 + Number(clock[2]));
  const num = /(\d+(?:\.\d+)?)/.exec(s);
  if (!num) return undefined;
  const n = Number(num[1]);
  const minutes = /(min|хв|мин|m\b|')/.test(s);
  const seconds = /(sec|\bs\b|\ds\b|с\b|сек|")/.test(s);
  const sec = minutes ? n * 60 : seconds ? n : n <= 10 ? n * 60 : n;
  return bound(sec);
}

function bound(sec: number): number | undefined {
  if (!Number.isFinite(sec) || sec <= 0) return undefined;
  return Math.min(MAX_SEC, Math.max(MIN_SEC, Math.round(sec)));
}
