// Rest-timer and session-quality logic, extracted from TrainView.tsx so it can be tested.
//
// The Mini App had no automated coverage at all -- 4.5k lines behind a typecheck and a build --
// and this is the part of it most worth covering: the numbers here are what a user reads
// mid-session (time left, overrun, how much of the session was work) and what a wrong answer
// would quietly mis-report rather than crash.
//
// Everything in this file is pure and DOM-free on purpose: `now` is a parameter rather than a
// Date.now() call, and preference parsing takes the raw string rather than touching
// localStorage. That keeps it runnable under the repo's existing node:test pool (see
// test/mini-app-rest.test.ts) without a browser environment or a React harness. The thin
// storage/clock wrappers stay in TrainView.tsx.

export const DEFAULT_REST_SEC = 60;
export const REST_MIN_SEC = 30;
export const REST_MAX_SEC = 900;
/** Stop counting up eventually, so a rest left running while the user wandered off doesn't pin
 *  a bar to the screen forever. */
export const REST_OVERRUN_CAP_SEC = 300;
export const REST_ADJUST_SEC = 15;
/** A rest counts as "on target" if it ended within this of the planned length -- early enough to
 *  be honest, loose enough that racking a bar doesn't break a streak. */
export const REST_ON_TARGET_TOLERANCE_SEC = 15;

export const REST_PREFS_KEY = "trix:v2:rest-prefs";

export type RestMetric = "reps" | "time" | "distance";
export type RestPrefs = { reps: number; time: number; distance: number; sound: boolean; auto: boolean };

export const DEFAULT_REST_PREFS: RestPrefs = {
  reps: DEFAULT_REST_SEC,
  time: DEFAULT_REST_SEC,
  distance: DEFAULT_REST_SEC,
  sound: false,
  auto: true,
};

/** `M:SS`. Used for both the countdown and the overrun, so it never renders a sign itself. */
export function fmtRest(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const m = Math.floor(safe / 60);
  const r = safe % 60;
  return `${m}:${r < 10 ? "0" : ""}${r}`;
}

export function clampRest(seconds: number): number {
  return Math.max(REST_MIN_SEC, Math.min(REST_MAX_SEC, Math.round(seconds || DEFAULT_REST_SEC)));
}

/** Which remembered rest applies to an exercise. A timed hold and a heavy compound want
 *  different rests, so the preference is per metric rather than one global number. */
export function restMetricKey(metric: string | undefined): RestMetric {
  return metric === "time" ? "time" : metric === "distance" ? "distance" : "reps";
}

/** Parse stored preferences defensively: the value is whatever was in a viewer's browser, which
 *  may predate a field, or be hand-edited, or be from a different version entirely. */
export function parseRestPrefs(raw: string | null): RestPrefs {
  if (!raw) return DEFAULT_REST_PREFS;
  try {
    const parsed = JSON.parse(raw) as Partial<RestPrefs> | null;
    if (!parsed || typeof parsed !== "object") return DEFAULT_REST_PREFS;
    return {
      reps: clampRest(Number(parsed.reps) || DEFAULT_REST_SEC),
      time: clampRest(Number(parsed.time) || DEFAULT_REST_SEC),
      distance: clampRest(Number(parsed.distance) || DEFAULT_REST_SEC),
      sound: parsed.sound === true,
      auto: parsed.auto !== false,
    };
  } catch {
    return DEFAULT_REST_PREFS;
  }
}

export interface SessionQuality {
  restCount: number; // rests actually taken this session
  restTotalSec: number; // wall-clock time spent resting
  onTargetStreak: number; // consecutive rests ended within tolerance
  bestStreak: number;
}

export const EMPTY_QUALITY: SessionQuality = { restCount: 0, restTotalSec: 0, onTargetStreak: 0, bestStreak: 0 };

/** Fold one finished rest into the session's running quality.
 *
 *  `actualSec` is the REAL rest -- from armed until the next set, overrun included -- not the
 *  planned length, because overshooting the timer by two minutes is exactly what this is meant
 *  to surface. */
export function scoreRest(current: SessionQuality, actualSec: number, targetSec: number): SessionQuality {
  const onTarget = Math.abs(actualSec - targetSec) <= REST_ON_TARGET_TOLERANCE_SEC;
  const onTargetStreak = onTarget ? current.onTargetStreak + 1 : 0;
  return {
    restCount: current.restCount + 1,
    restTotalSec: current.restTotalSec + Math.max(0, actualSec),
    onTargetStreak,
    bestStreak: Math.max(current.bestStreak, onTargetStreak),
  };
}

/** Share of elapsed session time spent working rather than resting, 0-100.
 *
 *  Derived from wall clock and measured rest, stored nowhere -- so it cannot drift out of sync
 *  with a persisted number or need a migration. Null before the first rest, when there is no
 *  session to measure yet. */
export function density(startedAt: number | null, restTotalSec: number, now: number): number | null {
  if (startedAt == null) return null;
  const elapsed = Math.max(1, Math.round((now - startedAt) / 1000));
  return Math.max(0, Math.min(100, Math.round(((elapsed - restTotalSec) / elapsed) * 100)));
}

/** Seconds left (>= 0) and seconds past zero, from one absolute deadline. Recomputed from
 *  `now` on every tick rather than decremented, so a throttled or suspended webview cannot
 *  desync it. */
export function restProgress(endAt: number, now: number): { left: number; over: number; done: boolean } {
  const deltaMs = endAt - now;
  if (deltaMs > 0) return { left: Math.ceil(deltaMs / 1000), over: 0, done: false };
  // Math.max also normalises the -0 that Math.floor(-0 / 1000) produces exactly at the
  // deadline: harmless in a template string, but it makes the value awkward to assert on and
  // to compare.
  return { left: 0, over: Math.max(0, Math.floor(-deltaMs / 1000)), done: true };
}

/** Ring fill for the rest bar, 0-100. Uses the rest's ORIGINAL length so a +15s tap reads as
 *  "more than planned" instead of silently rescaling the ring back to part-full. */
export function restRingPct(targetSec: number, leftSec: number): number {
  if (targetSec <= 0) return 100;
  return Math.max(0, Math.min(100, ((targetSec - leftSec) / targetSec) * 100));
}
