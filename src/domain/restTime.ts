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
  // The unit is the one right after the first number (or range): "90 s (1.5 min)" is 90 s.
  // \b is ASCII-only, so Cyrillic units end at a non-letter instead.
  const first = /(\d+(?:\.\d+)?)(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*(min|хв|мин|m(?!\p{L})|'|sec|сек|s(?!\p{L})|с(?!\p{L})|")?/u.exec(s);
  if (!first) return undefined;
  const n = Number(first[1]);
  const unit = first[2] ?? "";
  if (/^(min|хв|мин|m|')$/.test(unit)) {
    // "1 хв 30 с" / "1 min 30 s": add the seconds that follow.
    const extra = /^\s*(\d+)\s*(sec|сек|s|с|")(?!\p{L})/u.exec(s.slice(first.index + first[0].length));
    return bound(n * 60 + (extra ? Number(extra[1]) : 0));
  }
  if (unit) return bound(n);
  return bound(n <= 10 ? n * 60 : n);
}

function bound(sec: number): number | undefined {
  if (!Number.isFinite(sec) || sec <= 0) return undefined;
  return Math.min(MAX_SEC, Math.max(MIN_SEC, Math.round(sec)));
}
