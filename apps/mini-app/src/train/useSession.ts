import { useEffect, useRef, useState } from "react";
import { api, typedBody } from "../api";
import {
  clampRest, EMPTY_QUALITY, parseRestPrefs, REST_OVERRUN_CAP_SEC, REST_PREFS_KEY, restProgress, scoreRest,
  DEFAULT_REST_PREFS, DEFAULT_REST_SEC, type RestPrefs,
} from "../logic/rest";
import type { SessionClock } from "../logic/logger";

function loadRestPrefs(): RestPrefs {
  try { return parseRestPrefs(localStorage.getItem(REST_PREFS_KEY)); } catch { return DEFAULT_REST_PREFS; }
}

function saveRestPrefs(prefs: RestPrefs): void {
  try { localStorage.setItem(REST_PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage is optional */ }
}

// A short two-tone chirp so the phone can sit on the bench face-down. Built on demand and torn
// down after: holding an AudioContext open across a whole session is what gets a webview's audio
// throttled. Entirely best-effort -- autoplay policy may refuse it, and the haptic is the real
// signal.
function chirp(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const play = (at: number, hz: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.18);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(ctx.currentTime + at); osc.stop(ctx.currentTime + at + 0.2);
    };
    play(0, 660); play(0.22, 880);
    setTimeout(() => void ctx.close().catch(() => {}), 900);
  } catch { /* audio is optional */ }
}

export interface RestState {
  endAt: number | null; // absolute epoch ms; null = no rest running
  left: number;
  over: number; // seconds past zero -- the number that says the session is drifting
  done: boolean;
  target: number; // the planned length, so +15/-15 doesn't rescale the ring's own 100%
  label: string; // "Bench Press · set 2", so a pinned bar says what it belongs to
}

const IDLE_REST: RestState = { endAt: null, left: 0, over: 0, done: false, target: DEFAULT_REST_SEC, label: "" };

/**
 * The live half of a session: the rest countdown and the session clock (start time + rest tally).
 *
 * The clock is plain state that TrainView persists with the draft, so it survives switching tabs
 * or closing the app -- it used to live only here, in memory, and a long session came out as the
 * few minutes since the user last came back.
 */
export function useSession() {
  const [clock, setClock] = useState<SessionClock | undefined>(undefined);
  const [rest, setRest] = useState<RestState>(IDLE_REST);
  const [restPrefs, setRestPrefs] = useState<RestPrefs>(loadRestPrefs);
  // Refs, not state: these describe the rest currently open and are read inside callbacks, where
  // a stale closure over state would silently mis-measure. Nothing renders directly from them.
  const restStartedRef = useRef<number | null>(null);
  const restTargetRef = useRef<number>(DEFAULT_REST_SEC);

  // Timestamp-based countdown (endAt is absolute), so a throttled/suspended webview can't desync
  // it -- every tick recomputes from Date.now(), and visibilitychange/focus make resumption
  // immediate. Past zero the timer flips to counting up rather than disappearing. `warned` and
  // `fired` are effect-scoped: the effect re-runs per rest, so they reset for the next one.
  useEffect(() => {
    const endAt = rest.endAt;
    if (endAt == null) return;
    let warned = -1;
    let fired = false;
    const tick = () => {
      const { left, over, done } = restProgress(endAt, Date.now());
      if (!done) {
        setRest((current) => current.endAt === endAt ? { ...current, left, over: 0 } : current);
        // 3-2-1 countdown, one light tap per second, so the last seconds are felt not watched.
        if (left <= 3 && left !== warned) {
          warned = left;
          window.Telegram?.WebApp.HapticFeedback?.impactOccurred("light");
        }
        return;
      }
      if (over >= REST_OVERRUN_CAP_SEC) { setRest((current) => current.endAt === endAt ? { ...current, endAt: null, done: false, over: 0 } : current); return; }
      setRest((current) => current.endAt === endAt ? { ...current, left: 0, over, done: true } : current);
      if (!fired) {
        fired = true;
        window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
        if (restPrefs.sound) chirp();
      }
    };
    tick();
    const id = setInterval(tick, 500);
    const onResume = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("focus", onResume);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onResume); window.removeEventListener("focus", onResume); };
  }, [rest.endAt, restPrefs.sound]);

  /** The rest that is open (armed until now -- the REAL rest, overrun included), scored against
   *  its target; consumed, so every rest is counted exactly once. */
  const takeOpenRest = (now: number): ((quality: SessionClock["quality"]) => SessionClock["quality"]) => {
    const startedAt = restStartedRef.current;
    if (startedAt == null) return (quality) => quality;
    restStartedRef.current = null;
    const actual = Math.max(0, Math.round((now - startedAt) / 1000));
    const target = restTargetRef.current;
    return (quality) => scoreRest(quality, actual, target);
  };

  /** Starts the session clock at the first logged set or rest; no-op once it runs. */
  const markActive = () => setClock((current) => current ?? { startedAt: Date.now(), quality: EMPTY_QUALITY });

  // One place that arms both the local countdown and the server row (the minute-cron turns it
  // into a Telegram "rest is over" push), so they can never disagree about when this rest ends.
  const armRest = (seconds: number, label: string, target: number) => {
    const bounded = clampRest(seconds);
    const now = Date.now();
    const score = takeOpenRest(now);
    setClock((current) => {
      // A finished session stays finished: a rest started while fixing a typo afterwards must
      // not reopen or stretch it.
      if (current?.endedAt) return current;
      const base = current ?? { startedAt: now, quality: EMPTY_QUALITY };
      return { ...base, quality: score(base.quality) };
    });
    restStartedRef.current = now;
    restTargetRef.current = target;
    setRest({ endAt: now + bounded * 1000, left: bounded, over: 0, done: false, target, label });
    void api("/api/v2/workout/rest", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"startRestTimer">({ seconds: bounded }) }).catch(() => {});
  };
  const startRest = (seconds: number, label = "") => armRest(seconds, label, clampRest(seconds));

  const clearRest = () => {
    setRest((current) => ({ ...IDLE_REST, target: current.target }));
    // The pending server row would otherwise still push "rest is over" for a skipped rest.
    void api("/api/v2/workout/rest", { method: "DELETE" }).catch(() => {});
  };

  const stopRest = () => {
    const score = takeOpenRest(Date.now());
    setClock((current) => current && !current.endedAt ? { ...current, quality: score(current.quality) } : current);
    clearRest();
  };

  // Nudge a running rest from the remaining time; a deliberate +15 moves the target with it, so
  // it isn't scored as "missed" for doing exactly what the user intended.
  const adjustRest = (delta: number) => {
    if (rest.endAt == null) return;
    const now = Date.now();
    const remaining = Math.max(0, Math.round((rest.endAt - now) / 1000));
    const next = clampRest(remaining + delta);
    setRest((current) => ({ ...current, endAt: now + next * 1000, left: next, over: 0, done: false }));
    const elapsed = restStartedRef.current == null ? 0 : Math.round((now - restStartedRef.current) / 1000);
    restTargetRef.current = elapsed + next;
    window.Telegram?.WebApp.HapticFeedback?.impactOccurred("light");
    void api("/api/v2/workout/rest", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"startRestTimer">({ seconds: next }) }).catch(() => {});
  };

  /** The clock as it would be if the session ended now -- computed, not applied, so a failed
   *  save leaves the session running. Apply it with finish() once the save succeeded. */
  const finalClock = (now: number): SessionClock | undefined => {
    if (!clock) return undefined;
    if (clock.endedAt) return clock;
    const startedAt = restStartedRef.current;
    const quality = startedAt == null ? clock.quality : scoreRest(clock.quality, Math.max(0, Math.round((now - startedAt) / 1000)), restTargetRef.current);
    return { ...clock, quality, endedAt: now };
  };

  const finish = (final: SessionClock | undefined) => {
    restStartedRef.current = null;
    setClock(final);
    if (rest.endAt != null) clearRest();
  };

  /** Replace the clock wholesale: restoring a saved draft, or starting over. */
  const restore = (next: SessionClock | undefined) => {
    restStartedRef.current = null;
    setClock(next);
  };

  const patchRestPrefs = (patch: Partial<RestPrefs>) => {
    setRestPrefs((current) => { const next = { ...current, ...patch }; saveRestPrefs(next); return next; });
  };

  return { clock, rest, restPrefs, patchRestPrefs, markActive, startRest, stopRest, adjustRest, finalClock, finish, restore };
}

export type Session = ReturnType<typeof useSession>;
