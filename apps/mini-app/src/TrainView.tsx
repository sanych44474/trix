import { useEffect, useRef, useState } from "react";
import { api, ApiError, jsonBody, typedBody } from "./api";
import type { Dashboard, SaveResponse, WorkoutCopyExercise, WorkoutHistoryItem, WorkoutToday } from "./types";
import { t, type Lang } from "./i18n";
import {
  clampRest, density, DEFAULT_REST_PREFS, DEFAULT_REST_SEC, EMPTY_QUALITY, fmtRest,
  parseRestPrefs, REST_ADJUST_SEC, REST_OVERRUN_CAP_SEC, REST_PREFS_KEY, restMetricKey,
  restProgress, restRingPct, scoreRest,
  type RestPrefs, type SessionQuality,
} from "./logic/rest";

// ---- Local UI atoms: duplicated rather than imported from App.tsx on purpose (same convention
// Workspace.tsx/ProfileView.tsx already use) -- keeps this file free of a circular import back to
// the module that renders <TrainView />. ----

function Card({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "accent" | "muted" }) {
  return <section className={`card card-${tone}`}>{children}</section>;
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="empty"><span className="empty-mark">—</span><strong>{title}</strong><small>{detail}</small></div>;
}

function ErrorState({ lang, error, retry }: { lang: Lang; error: unknown; retry: () => void }) {
  const message = error instanceof ApiError && error.code === "unauthorized" ? t(lang, "unauthorized_error") : t(lang, "generic_error");
  return <Card tone="muted"><div className="error-state"><strong>{message}</strong><button className="button button-ghost" onClick={retry}>{t(lang, "retry")}</button></div></Card>;
}

function Loading() { return <div className="view-stack"><div className="skeleton skeleton-hero" /><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>; }

// ---- Train view helpers: repeat a past session / log a missed day ----

function isoWeekday(dateStr: string): number {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  return day === 0 ? 7 : day;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---- Rest timer ----
// The pure parts (clamping, formatting, preference parsing, density, streak scoring) live in
// ./logic/rest so they can be unit-tested without a DOM -- see test/mini-app-rest.test.ts. What
// stays here is the part that genuinely needs the browser: localStorage and the audio context.

function loadRestPrefs(): RestPrefs {
  try { return parseRestPrefs(localStorage.getItem(REST_PREFS_KEY)); } catch { return DEFAULT_REST_PREFS; }
}

function saveRestPrefs(prefs: RestPrefs): void {
  try { localStorage.setItem(REST_PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage is optional */ }
}



// What saveWorkout() already returns (SaveResult, src/webapp/workout.ts) plus the locally
// measured session quality. The server has always computed the PR/badge/level payload; the app
// used to throw the whole response away and show a one-line "saved" note instead.
interface SaveSummary {
  prExercises: string[];
  newBadges: string[];
  level: number;
  leveledUp: boolean;
  totalWorkouts: number;
  sets: number;
  elapsedSec: number;
  restTotalSec: number;
  densityPct: number | null;
  bestStreak: number;
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

type LoggerExercise = WorkoutToday["exercises"][number];
type LoggerSet = NonNullable<LoggerExercise["setsDone"]>[number];

function emptyLoggerSet(metric: LoggerExercise["metric"]): LoggerSet {
  return metric === "time" ? { weight: 0, reps: 0, seconds: 0 } : metric === "distance" ? { weight: 0, reps: 0, meters: 0 } : { weight: 0, reps: 0 };
}

function hydrateSaved(data: WorkoutToday): WorkoutToday {
  if (!data.saved?.length) return data;
  return { ...data, exercises: data.exercises.map((exercise) => {
    const saved = data.saved?.find((item) => item.name === exercise.name);
    if (!saved) return exercise;
    return {
      ...exercise,
      setsDone: saved.sets.map((set) => ({ weight: set.w, reps: set.r, seconds: set.sec || undefined, meters: set.m || undefined, rpe: saved.rpe })),
      ...(saved.rpe !== undefined ? { rpe: saved.rpe } : {}),
    };
  }) };
}

function copyToLoggerExercises(items: WorkoutCopyExercise[]): WorkoutToday["exercises"] {
  return items.map((item, index) => ({
    index, name: item.name, metric: item.metric, sets: item.sets.length || 1,
    setsDone: item.sets.map((set) => ({ weight: set.w, reps: set.r, seconds: set.sec || undefined, meters: set.m || undefined, rpe: item.rpe || undefined })),
    ...(item.rpe ? { rpe: item.rpe } : {}),
  }));
}

/** Sets a "did exactly what was planned" fill for one exercise would produce -- shared by the
 * per-exercise "As planned" button and the per-session "fill all" button. */
function plannedSetsFor(exercise: LoggerExercise): LoggerSet[] {
  return Array.from({ length: exercise.sets || 1 }, () => exercise.metric === "reps" ? { weight: exercise.weightKg ?? 0, reps: exercise.reps ?? 0 } : exercise.metric === "time" ? { weight: 0, reps: 0, seconds: exercise.reps ?? 0 } : { weight: 0, reps: 0, meters: exercise.reps ?? 0 });
}

export function TrainView({ lang, gamification }: { lang: Lang; gamification?: Dashboard["gamification"] }) {
  const draftKey = "trix:v2:workout-draft";
  const [subview, setSubview] = useState<"today" | "history">("today");
  const [workout, setWorkout] = useState<WorkoutToday | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveNoteDate, setSaveNoteDate] = useState<string | null>(null);
  const [drafted, setDrafted] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // Separate from `error` on purpose: `error` means "couldn't load the view, nothing to show" and
  // replaces the whole screen with ErrorState. An action (save/swap/custom-exercise) failing --
  // e.g. a 409 from the idempotency claim layer while a slow save is still genuinely in flight --
  // is recoverable and must NOT blank out an already-rendered, partially-filled form; it shows as
  // a small dismissible inline note instead.
  const [actionError, setActionError] = useState<unknown>(null);
  const [logDate, setLogDate] = useState<string | null>(null);
  const [copiedFrom, setCopiedFrom] = useState<string | null>(null);
  const [history, setHistory] = useState<WorkoutHistoryItem[] | null>(null);
  const [historyError, setHistoryError] = useState<unknown>(null);
  const [historyBusy, setHistoryBusy] = useState<string | null>(null);
  const [missedDate, setMissedDate] = useState("");
  const [restEndAt, setRestEndAt] = useState<number | null>(null);
  const [restLeft, setRestLeft] = useState(0);
  const [restDone, setRestDone] = useState(false);
  const [restSeconds, setRestSeconds] = useState(DEFAULT_REST_SEC);
  // The rest the running countdown was started with -- the ring needs the planned length, not
  // the remaining time, and +15/-15 must not rescale the ring's own 100%.
  const [restTarget, setRestTarget] = useState(DEFAULT_REST_SEC);
  const [restOver, setRestOver] = useState(0); // seconds past zero; the number that says the session is drifting
  const [restLabel, setRestLabel] = useState(""); // "Bench Press · set 2", so a pinned bar says what it belongs to
  const [restPrefs, setRestPrefs] = useState<RestPrefs>(loadRestPrefs);
  const [restEditFor, setRestEditFor] = useState<number | null>(null);
  const [quality, setQuality] = useState<SessionQuality>(EMPTY_QUALITY);
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [summary, setSummary] = useState<SaveSummary | null>(null);
  // Refs, not state: these describe the rest currently open and are read inside callbacks, where
  // a stale closure over state would silently mis-measure. They also change on every rest, and
  // nothing renders directly from them.
  const restStartedRef = useRef<number | null>(null);
  const restTargetRef = useRef<number>(DEFAULT_REST_SEC);
  const [swapFor, setSwapFor] = useState<number | null>(null);
  const [swapChoices, setSwapChoices] = useState<Array<{ id: string; name: string }>>([]);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [infoFor, setInfoFor] = useState<number | null>(null);
  const [info, setInfo] = useState<{ technique: string; videoUrl?: string; videoTitle?: string } | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [customName, setCustomName] = useState("");

  // Timestamp-based countdown (restEndAt is an absolute epoch ms, not a decrement counter), so a
  // throttled/suspended tab (Telegram Mini App backgrounded / screen locked) can't desync it --
  // every tick recomputes from Date.now(). The visibilitychange/focus listeners below just make
  // resumption immediate instead of waiting up to 500ms for the next interval tick, so a
  // rest-done haptic (or the done-note) that would otherwise only fire once the interval catches
  // up fires right when the user comes back.
  //
  // Past zero the timer does NOT disappear: it flips to counting up. A four-second "rest done"
  // note used to erase the one number that tells a lifter the session is drifting, and it was
  // gone before anyone scrolled back to it.
  //
  // `warned` and `fired` are effect-scoped locals, not state: the effect re-runs only when
  // restEndAt changes (i.e. per rest), so they persist across this rest's ticks and reset for
  // the next one, without re-render churn on every 500ms tick.
  useEffect(() => {
    if (restEndAt == null) return;
    let warned = -1;
    let fired = false;
    const tick = () => {
      const { left, over, done } = restProgress(restEndAt, Date.now());
      if (!done) {
        setRestLeft(left); setRestOver(0);
        // 3-2-1 countdown, one light tap per second, so the last seconds are felt not watched.
        if (left <= 3 && left !== warned) {
          warned = left;
          window.Telegram?.WebApp.HapticFeedback?.impactOccurred("light");
        }
        return;
      }
      setRestLeft(0); setRestOver(over);
      if (!fired) {
        fired = true;
        setRestDone(true);
        window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
        if (restPrefs.sound) chirp();
      }
      if (over >= REST_OVERRUN_CAP_SEC) { setRestEndAt(null); setRestDone(false); setRestOver(0); }
    };
    tick();
    const id = setInterval(tick, 500);
    const onResume = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("focus", onResume);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onResume); window.removeEventListener("focus", onResume); };
  }, [restEndAt, restPrefs.sound]);

  // Measures the rest that was open (from armed until now -- the REAL rest, overrun included,
  // not the planned length) and scores it against what was planned. Called when the next rest
  // starts or when one is skipped, so every rest is counted exactly once.
  const closeOpenRest = () => {
    const startedAt = restStartedRef.current;
    if (startedAt == null) return;
    restStartedRef.current = null;
    const actual = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    const target = restTargetRef.current;
    setQuality((current) => scoreRest(current, actual, target));
  };

  // One place that arms both the local countdown and the server row, so they can never disagree
  // about when this rest ends. setRestTimer upserts on accountId, so re-arming (a new set, or
  // +15/-15 below) just moves dueAt rather than stacking rows.
  const armRest = (seconds: number, label: string, target: number) => {
    const bounded = clampRest(seconds);
    closeOpenRest();
    setSessionStartedAt((current) => current ?? Date.now());
    restStartedRef.current = Date.now();
    restTargetRef.current = target;
    setRestSeconds(bounded); setRestTarget(target); setRestLabel(label);
    setRestDone(false); setRestOver(0); setRestLeft(bounded);
    setRestEndAt(Date.now() + bounded * 1000);
    void api("/api/v2/workout/rest", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"startRestTimer">({ seconds: bounded }) }).catch(() => {});
  };
  const startRest = (seconds: number, label = "") => armRest(seconds, label, clampRest(seconds));
  // Cancelling has to reach the server too: the pending v2_rest_timers row is what the
  // minute-cron turns into a Telegram "rest is over" push, so clearing only local state left
  // the user getting pinged for a rest they had just skipped.
  const stopRest = () => {
    closeOpenRest();
    setRestEndAt(null); setRestDone(false); setRestOver(0); setRestLabel("");
    void api("/api/v2/workout/rest", { method: "DELETE" }).catch(() => {});
  };
  // Nudge a running rest. Re-arms from the remaining time (not from the original length), and
  // re-posts so the Telegram push moves with it; the ring keeps its original 100% so the bar
  // reads as "more/less than planned" rather than silently rescaling.
  const adjustRest = (delta: number) => {
    if (restEndAt == null) return;
    const remaining = Math.max(0, Math.round((restEndAt - Date.now()) / 1000));
    const next = clampRest(remaining + delta);
    setRestDone(false); setRestOver(0); setRestLeft(next);
    setRestEndAt(Date.now() + next * 1000);
    // Deliberately adjusting a rest moves the target with it -- otherwise tapping +15 would
    // score as "missed the target" for doing exactly what the user intended.
    const elapsed = restStartedRef.current == null ? 0 : Math.round((Date.now() - restStartedRef.current) / 1000);
    restTargetRef.current = elapsed + next;
    window.Telegram?.WebApp.HapticFeedback?.impactOccurred("light");
    void api("/api/v2/workout/rest", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"startRestTimer">({ seconds: next }) }).catch(() => {});
  };
  const patchRestPrefs = (patch: Partial<RestPrefs>) => {
    setRestPrefs((current) => { const next = { ...current, ...patch }; saveRestPrefs(next); return next; });
  };
  // What rest to use for an exercise: the plan's own value wins (a coach set it deliberately),
  // then this viewer's remembered preference for that metric.
  const restForExercise = (exercise: LoggerExercise): number => exercise.restSec ?? restPrefs[restMetricKey(exercise.metric)];
  const liveDensity = density(sessionStartedAt, quality.restTotalSec, Date.now());

  const persistDraft = (next: WorkoutToday, nextLogDate: string | null, nextCopiedFrom: string | null) => {
    try { localStorage.setItem(draftKey, JSON.stringify({ ...next, logDate: nextLogDate, copiedFrom: nextCopiedFrom })); setDrafted(true); } catch { /* storage is optional */ }
  };

  const load = () => {
    setLoading(true); setError(null);
    api<WorkoutToday>("/api/v2/workout/today").then((raw) => {
      const data = hydrateSaved(raw);
      setLogDate(null); setCopiedFrom(null); setSaved(false); setSaveNoteDate(null);
      try {
        const stored = localStorage.getItem(draftKey);
        const draft = stored ? JSON.parse(stored) as WorkoutToday & { logDate?: string; copiedFrom?: string } : null;
        if (draft?.date === data.date && Array.isArray(draft.exercises)) {
          setWorkout({ ...data, exercises: draft.exercises }); setLogDate(draft.logDate ?? null); setCopiedFrom(draft.copiedFrom ?? null); setDrafted(true); return;
        }
      } catch { localStorage.removeItem(draftKey); }
      setWorkout(data); setDrafted(false);
    }).catch(setError).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const updateSet = (index: number, setIndex: number, key: "weight" | "reps" | "seconds" | "meters" | "rpe", value: number) => setWorkout((current) => {
    if (!current) return current;
    const next = { ...current, exercises: current.exercises.map((exercise) => {
      if (exercise.index !== index) return exercise;
      const sets = [...(exercise.setsDone ?? [])];
      while (sets.length <= setIndex) sets.push(emptyLoggerSet(exercise.metric));
      sets[setIndex] = { ...sets[setIndex], [key]: value };
      return { ...exercise, setsDone: sets };
    }) };
    persistDraft(next, logDate, copiedFrom); return next;
  });
  const fillPlanned = (index: number) => setWorkout((current) => {
    if (!current) return current;
    const next = { ...current, exercises: current.exercises.map((exercise) => exercise.index !== index ? exercise : { ...exercise, setsDone: plannedSetsFor(exercise) }) };
    persistDraft(next, logDate, copiedFrom); return next;
  });
  const fillPlannedAll = () => setWorkout((current) => {
    if (!current) return current;
    const next = { ...current, exercises: current.exercises.map((exercise) => ({ ...exercise, setsDone: plannedSetsFor(exercise) })) };
    persistDraft(next, logDate, copiedFrom); return next;
  });
  const fillLast = (index: number) => setWorkout((current) => {
    if (!current) return current;
    const next = { ...current, exercises: current.exercises.map((exercise) => exercise.index !== index || !exercise.last?.length ? exercise : { ...exercise, setsDone: exercise.last.map((set) => ({ weight: set.w, reps: set.r, seconds: set.sec || undefined, meters: set.m || undefined })) }) };
    persistDraft(next, logDate, copiedFrom); return next;
  });
  const addSet = (index: number) => setWorkout((current) => {
    if (!current) return current;
    const next = { ...current, exercises: current.exercises.map((exercise) => exercise.index === index ? { ...exercise, setsDone: [...(exercise.setsDone ?? []), emptyLoggerSet(exercise.metric)] } : exercise) };
    persistDraft(next, logDate, copiedFrom); return next;
  });
  const removeSet = (index: number, setIndex: number) => setWorkout((current) => {
    if (!current) return current;
    const next = { ...current, exercises: current.exercises.map((exercise) => exercise.index === index ? { ...exercise, setsDone: (exercise.setsDone ?? []).filter((_, i) => i !== setIndex) } : exercise) };
    persistDraft(next, logDate, copiedFrom); return next;
  });
  const moveExercise = (index: number, direction: -1 | 1) => setWorkout((current) => {
    if (!current) return current;
    const at = current.exercises.findIndex((exercise) => exercise.index === index); const to = at + direction;
    if (at < 0 || to < 0 || to >= current.exercises.length) return current;
    const exercises = [...current.exercises]; [exercises[at], exercises[to]] = [exercises[to], exercises[at]];
    const next = { ...current, exercises: exercises.map((exercise, i) => ({ ...exercise, index: i })) };
    persistDraft(next, logDate, copiedFrom); return next;
  });
  const removeExercise = (index: number) => setWorkout((current) => {
    if (!current) return current;
    const exercise = current.exercises.find((item) => item.index === index);
    if (exercise?.setsDone?.some((set) => set.reps || set.seconds || set.meters || set.weight) && !window.confirm(t(lang, "train_delete_typed_confirm"))) return current;
    const next = { ...current, exercises: current.exercises.filter((item) => item.index !== index).map((item, i) => ({ ...item, index: i })) };
    persistDraft(next, logDate, copiedFrom); return next;
  });

  const loadHistory = () => { setHistoryError(null); api<{ logs: WorkoutHistoryItem[] }>("/api/v2/workout/history").then((data) => setHistory(data.logs)).catch(setHistoryError); };
  useEffect(() => { if (subview === "history" && history === null) loadHistory(); }, [subview, history]);
  const todayDate = workout?.date ?? isoDate(new Date());
  const minMissedDate = isoDate(new Date(Date.parse(`${todayDate}T00:00:00Z`) - 14 * 86_400_000));
  const repeatToday = async (date: string) => { if (!workout) return; setHistoryBusy(`repeat:${date}`); try { const data = await api<{ exercises: WorkoutCopyExercise[] }>(`/api/v2/workout/past?date=${date}`); const next = { ...workout, exercises: copyToLoggerExercises(data.exercises) }; setWorkout(next); setLogDate(null); setCopiedFrom(date); persistDraft(next, null, date); setSubview("today"); } catch (err) { setHistoryError(err); } finally { setHistoryBusy(null); } };
  const startMissedBlank = async (date: string) => { setHistoryBusy(`blank:${date}`); try { const data = await api<WorkoutToday>(`/api/v2/workout/today?date=${date}`); const next = hydrateSaved(data); setWorkout(next); setLogDate(date); setCopiedFrom(null); persistDraft(next, date, null); setSubview("today"); } catch (err) { setHistoryError(err); } finally { setHistoryBusy(null); } };
  // targetDate === sourceDate is "edit this already-saved day in place": /workout/past returns the
  // exact historical sets (assembleWorkoutCopy, not plan-template-dependent like startMissedBlank's
  // hydrateSaved), logDate is set to the SAME date so save() posts back with that date -- the D1
  // save path (upsertWorkoutLog: ON CONFLICT(accountId,date) DO UPDATE + delete-then-insert of
  // exercises/sets) overwrites the existing session instead of duplicating it, confirmed in
  // src/adapters/d1/v2Workouts.ts -- so this reuse is safe, not just convenient.
  const startMissedFromHistory = async (targetDate: string, sourceDate: string) => { setHistoryBusy(`fill:${sourceDate}`); try { const data = await api<{ exercises: WorkoutCopyExercise[] }>(`/api/v2/workout/past?date=${sourceDate}`); const next: WorkoutToday = { date: targetDate, weekday: isoWeekday(targetDate), exercises: copyToLoggerExercises(data.exercises) }; setWorkout(next); setLogDate(targetDate); setCopiedFrom(sourceDate); persistDraft(next, targetDate, sourceDate); setSubview("today"); } catch (err) { setHistoryError(err); } finally { setHistoryBusy(null); } };
  const backToToday = () => { localStorage.removeItem(draftKey); setSummary(null); setQuality(EMPTY_QUALITY); setSessionStartedAt(null); restStartedRef.current = null; load(); };
  const openSwap = async (index: number) => { setSwapFor(index); setActionBusy(`swap:${index}`); try { const data = await api<{ alternatives: Array<{ id: string; name: string }> }>(`/api/v2/workout/swap?index=${index}`); setSwapChoices(data.alternatives); } catch (err) { setActionError(err); } finally { setActionBusy(null); } };
  const applySwap = (name: string) => { if (swapFor === null) return; setWorkout((current) => { if (!current) return current; const next = { ...current, exercises: current.exercises.map((exercise) => exercise.index === swapFor ? { ...exercise, name, setsDone: [] } : exercise) }; persistDraft(next, logDate, copiedFrom); return next; }); setSwapFor(null); setSwapChoices([]); };
  const addCustom = async () => { const name = customName.trim(); if (name.length < 2) return; setActionBusy("custom"); try { const result = await api<{ name: string; videoUrl?: string; videoTitle?: string }>("/api/v2/workout/custom", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"addCustomExercise">({ name }) }); setWorkout((current) => { if (!current) return current; const exercise: LoggerExercise = { index: current.exercises.length, name: result.name, metric: "reps", sets: 1, ...(result.videoUrl ? { videoUrl: result.videoUrl, videoTitle: result.videoTitle } : {}) }; const next = { ...current, exercises: [...current.exercises, exercise] }; persistDraft(next, logDate, copiedFrom); return next; }); setCustomName(""); setShowCustom(false); } catch (err) { setActionError(err); } finally { setActionBusy(null); } };
  const openInfo = async (exercise: LoggerExercise) => { if (infoFor === exercise.index) { setInfoFor(null); return; } setInfoFor(exercise.index); if (exercise.technique || exercise.videoUrl) { setInfo({ technique: exercise.technique ?? "", videoUrl: exercise.videoUrl, videoTitle: exercise.videoTitle }); return; } setActionBusy(`info:${exercise.index}`); try { setInfo(await api(`/api/v2/workout/exinfo?name=${encodeURIComponent(exercise.name)}`)); } catch { setInfo(null); } finally { setActionBusy(null); } };
  const save = async () => { if (!workout) return; setSaving(true); setSaved(false); setActionError(null); const targetDate = logDate; try { const entries = workout.exercises.flatMap((e) => e.setsDone && e.setsDone.some((set) => set.reps || set.seconds || set.meters) ? [{ name: e.name, sets: e.setsDone, ...(e.rpe !== undefined ? { rpe: e.rpe } : {}) }] : []); const result = await api<SaveResponse>("/api/v2/workout/save", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"saveWorkout">({ entries, ...(targetDate ? { date: targetDate } : {}) }) }); closeOpenRest(); localStorage.removeItem(draftKey); setDrafted(false); setSaved(true); setSaveNoteDate(targetDate); setSummary({ prExercises: result.prExercises ?? [], newBadges: result.newBadges ?? [], level: result.level ?? 1, leveledUp: result.leveledUp === true, totalWorkouts: result.totalWorkouts ?? 0, sets: entries.reduce((total, e) => total + e.sets.filter((set) => set.reps || set.seconds || set.meters).length, 0), elapsedSec: sessionStartedAt == null ? 0 : Math.round((Date.now() - sessionStartedAt) / 1000), restTotalSec: quality.restTotalSec, densityPct: density(sessionStartedAt, quality.restTotalSec, Date.now()), bestStreak: quality.bestStreak }); window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success"); if (targetDate) { setHistory(null); load(); } } catch (err) {
    // A 409 here means the idempotency layer found this exact save still genuinely in-flight
    // (src/adapters/d1/v2Idempotency.ts's ClaimResult "cached: null" branch) -- typically a
    // network-level retry of the same request racing its own still-processing first attempt.
    // It resolves itself within ~30s (CLAIM_STALE_MS); a fresh idempotency key on the next click
    // (a normal retry with the SAME form data, nothing lost -- the draft is still in
    // localStorage) succeeds once the original attempt completes or the stale claim is taken over.
    setActionError(err);
  } finally { setSaving(false); } };

  if (loading) return <Loading />;
  if (error) return <ErrorState lang={lang} error={error} retry={load} />;
  const tabs = <div className="button-row tabs"><button className={subview === "today" ? "button button-primary" : "button button-ghost"} onClick={() => setSubview("today")}>{t(lang, "train_tab_today")}</button><button className={subview === "history" ? "button button-primary" : "button button-ghost"} onClick={() => setSubview("history")}>{t(lang, "train_tab_history")}</button></div>;
  if (subview === "history") return <div className="view-stack"><div className="eyebrow">{t(lang, "history_eyebrow")}</div><div className="page-title"><h1>{t(lang, "history_title")}</h1></div>{tabs}{historyError !== null && <ErrorState lang={lang} error={historyError} retry={loadHistory} />}{historyError === null && history === null && <Loading />}{historyError === null && history !== null && (history.length === 0 ? <Empty title={t(lang, "history_empty_title")} detail={t(lang, "history_empty_detail")} /> : <div className="exercise-list">{history.map((item) => <Card key={item.date}><div className="exercise-head"><div><h2>{item.date}</h2></div><span className="tag">{t(lang, "history_row_exercises", { n: item.n })}</span></div><p className="muted">{item.title}</p><div className="button-row"><button className="button button-primary" disabled={historyBusy !== null} onClick={() => void repeatToday(item.date)}>{historyBusy === `repeat:${item.date}` ? t(lang, "saving_ellipsis") : t(lang, "repeat_btn")}</button><button className="button button-ghost" disabled={historyBusy !== null} onClick={() => void startMissedFromHistory(item.date, item.date)}>{historyBusy === `fill:${item.date}` ? t(lang, "saving_ellipsis") : t(lang, "train_edit_saved_btn")}</button>{item.date >= minMissedDate && item.date < todayDate && <button className="button button-ghost" disabled={historyBusy !== null} onClick={() => setMissedDate(item.date)}>{t(lang, "log_missed_btn")}</button>}</div></Card>)}</div>)}<Card tone="muted"><div className="section-head"><div><span className="eyebrow">{t(lang, "log_missed_eyebrow")}</span><h2>{t(lang, "log_missed_title")}</h2></div></div><p className="muted">{t(lang, "log_missed_detail")}</p><div className="input-row"><label className="form-field"><span>{t(lang, "pick_date_label")}</span><input type="date" min={minMissedDate} max={todayDate} value={missedDate} onChange={(event) => setMissedDate(event.target.value)} /></label></div>{missedDate && <div className="button-row"><button className="button button-primary" disabled={historyBusy !== null} onClick={() => void startMissedBlank(missedDate)}>{historyBusy === `blank:${missedDate}` ? t(lang, "saving_ellipsis") : t(lang, "start_blank_btn")}</button>{(history ?? []).filter((item) => item.date !== missedDate).slice(0, 3).map((item) => <button key={item.date} className="button button-ghost" disabled={historyBusy !== null} onClick={() => void startMissedFromHistory(missedDate, item.date)}>{historyBusy === `fill:${item.date}` ? t(lang, "saving_ellipsis") : `${t(lang, "use_these_exercises_btn")} (${item.date})`}</button>)}</div>}</Card></div>;
  if (!workout?.exercises?.length) return <div className="view-stack">{tabs}<Empty title={t(lang, "rest_day_title")} detail={t(lang, "rest_day_detail")} /></div>;
  const filled = workout.exercises.filter((exercise) => exercise.setsDone?.some((set) => set.reps || set.seconds || set.meters)).length;
  return <div className="view-stack"><div className="eyebrow">{t(lang, "guided_logger_eyebrow", { date: logDate ?? workout.date })}</div><div className="page-title"><h1>{t(lang, "training_session_title")}</h1><span>{filled}/{workout.exercises.length}</span></div>{tabs}{gamification && !saved && <div className="train-progress"><span className="tag">{t(lang, "level_n", { n: gamification.level })}</span><div className="progress-track"><span style={{ width: `${gamification.needed ? Math.min(100, gamification.intoLevel / gamification.needed * 100) : 100}%` }} /></div>{gamification.streak ? <span className="tag">{t(lang, "streak_weeks", { n: gamification.streak })}</span> : null}</div>}{actionError !== null && <Card tone="muted"><div className="error-state"><strong>{t(lang, "generic_error")}</strong><button className="button button-ghost" onClick={() => setActionError(null)}>{t(lang, "close")}</button></div></Card>}{(logDate || copiedFrom) &&<div className="button-row"><button className="text-button" onClick={backToToday}>{t(lang, "back_to_today")}</button></div>}{saved && summary ? <Card tone="accent">
      <div className="section-head"><div><span className="eyebrow">{t(lang, "session_summary_eyebrow")}</span><h2>{saveNoteDate ? t(lang, "session_saved_for_date", { date: saveNoteDate }) : t(lang, "session_saved")}</h2></div><span className="tag">{t(lang, "level_n", { n: summary.level })}</span></div>
      <div className="session-stats">
        <div><strong>{summary.sets}</strong><small>{t(lang, "summary_sets")}</small></div>
        <div><strong>{fmtRest(summary.elapsedSec)}</strong><small>{t(lang, "summary_elapsed")}</small></div>
        {summary.densityPct !== null && <div><strong>{summary.densityPct}%</strong><small>{t(lang, "summary_density")}</small></div>}
        {summary.bestStreak > 0 && <div><strong>🎯 {summary.bestStreak}</strong><small>{t(lang, "summary_rest_streak")}</small></div>}
      </div>
      {summary.leveledUp && <p className="summary-hit">{t(lang, "summary_level_up", { n: summary.level })}</p>}
      {summary.prExercises.length > 0 && <p className="summary-hit">{t(lang, "summary_prs", { names: summary.prExercises.join(", ") })}</p>}
      {summary.newBadges.length > 0 && <p className="summary-hit">{t(lang, "summary_badges", { names: summary.newBadges.join(", ") })}</p>}
      <p className="muted">{t(lang, "summary_total_workouts", { n: summary.totalWorkouts })}</p>
    </Card> : saved ? <div className="save-note">{saveNoteDate ? t(lang, "session_saved_for_date", { date: saveNoteDate }) : t(lang, "session_saved")}</div> : null}{logDate && !saved && <div className="draft-note">{t(lang, "logging_for_date_note", { date: logDate })}</div>}{copiedFrom && !logDate && !saved && <div className="draft-note">{t(lang, "repeated_note", { date: copiedFrom })}</div>}{drafted && <div className="draft-note">{t(lang, "draft_saved_note")}</div>}<div className="progress-track session-progress"><span style={{ width: `${workout.exercises.length ? filled / workout.exercises.length * 100 : 0}%` }} /></div>{workout.exercises.length > 1 && <div className="button-row"><button className="button button-ghost" onClick={fillPlannedAll}>{t(lang, "train_as_planned_all_btn")}</button></div>}<div className="exercise-list">{workout.exercises.map((exercise) => { const restSec = restForExercise(exercise); const sets = exercise.setsDone ?? []; const completed = sets.some((set) => set.reps || set.seconds || set.meters); return <Card key={`${exercise.index}-${exercise.name}`} tone={completed ? "muted" : "default"}><div className="exercise-head"><div><span className="exercise-index">{String(exercise.index + 1).padStart(2, "0")}</span><h2>{completed ? "✓ " : ""}{exercise.name}</h2></div><div className="button-row"><span className="tag">{t(lang, exercise.metric === "reps" ? "metric_tag_reps" : exercise.metric === "time" ? "metric_tag_time" : "metric_tag_distance")}</span><button type="button" className="text-button" onClick={() => startRest(restSec, exercise.name)}>{t(lang, "train_start_rest_btn", { sec: restSec })}</button><button type="button" className="text-button" aria-label={t(lang, "train_rest_prefs_aria")} onClick={() => setRestEditFor((current) => current === exercise.index ? null : exercise.index)}>⚙</button></div></div>{restEditFor === exercise.index && <div className="rest-prefs">{[45, 60, 90, 120, 180].map((sec) => <button type="button" key={sec} className={restPrefs[restMetricKey(exercise.metric)] === sec ? "rest-chip selected" : "rest-chip"} onClick={() => patchRestPrefs({ [restMetricKey(exercise.metric)]: sec })}>{sec}s</button>)}<button type="button" className={restPrefs.auto ? "rest-chip selected" : "rest-chip"} onClick={() => patchRestPrefs({ auto: !restPrefs.auto })}>{t(lang, "train_rest_auto")}</button><button type="button" className={restPrefs.sound ? "rest-chip selected" : "rest-chip"} onClick={() => patchRestPrefs({ sound: !restPrefs.sound })}>{t(lang, "train_rest_sound")}</button>{exercise.restSec != null && <small className="muted">{t(lang, "train_rest_plan_wins")}</small>}</div>}<p className="muted">{exercise.planSets ? `${exercise.planSets}${exercise.planWeight ? ` · ${exercise.planWeight}` : ""}` : t(lang, "exercise_sets_line", { n: exercise.sets, detail: exercise.metric === "reps" ? t(lang, "controlled_reps") : t(lang, "measured_effort") })}</p><div className="button-row exercise-actions"><button className="text-button" onClick={() => fillPlanned(exercise.index)}>{t(lang, "train_as_planned_btn")}</button>{exercise.last?.length ? <button className="text-button" onClick={() => fillLast(exercise.index)}>{t(lang, "train_repeat_last_btn")}</button> : null}<button className="text-button" onClick={() => void openSwap(exercise.index)}>{actionBusy === `swap:${exercise.index}` ? "…" : t(lang, "train_swap_btn")}</button><button className="text-button" onClick={() => void openInfo(exercise)}>{actionBusy === `info:${exercise.index}` ? "…" : t(lang, "train_info_btn")}</button></div>{swapFor === exercise.index && <div className="choice-list">{swapChoices.length ? swapChoices.map((choice) => <button className="choice-button" key={choice.id} onClick={() => applySwap(choice.name)}>{choice.name}</button>) : <span className="muted">{t(lang, "train_no_swaps")}</span>}</div>}{infoFor === exercise.index && info && <div className="info-box"><p>{info.technique || t(lang, "train_no_info")}</p>{info.videoUrl && <a href={info.videoUrl} target="_blank" rel="noreferrer">{info.videoTitle || t(lang, "train_watch_video")}</a>}</div>}<div className="set-list">{sets.map((set, setIndex) => <div className="set-row" key={setIndex}><span className="set-number">{setIndex + 1}</span>{exercise.metric === "reps" ? <><label><span>{t(lang, "field_load")}</span><input type="number" inputMode="decimal" value={set.weight || ""} placeholder={t(lang, "ph_kg")} onChange={(event) => updateSet(exercise.index, setIndex, "weight", Number(event.target.value))} /></label><label><span>{t(lang, "field_reps")}</span><input type="number" inputMode="numeric" value={set.reps || ""} placeholder={t(lang, "ph_reps")} onChange={(event) => updateSet(exercise.index, setIndex, "reps", Number(event.target.value))} onBlur={(event) => { if (restPrefs.auto && Number(event.target.value) > 0) startRest(restSec, t(lang, "train_rest_for", { name: exercise.name, n: setIndex + 1 })); }} /></label></> : exercise.metric === "time" ? <label><span>{t(lang, "field_seconds")}</span><input type="number" inputMode="numeric" value={set.seconds || ""} placeholder={t(lang, "ph_sec")} onChange={(event) => updateSet(exercise.index, setIndex, "seconds", Number(event.target.value))} onBlur={(event) => { if (restPrefs.auto && Number(event.target.value) > 0) startRest(restSec, t(lang, "train_rest_for", { name: exercise.name, n: setIndex + 1 })); }} /></label> : <label><span>{t(lang, "field_meters")}</span><input type="number" inputMode="decimal" value={set.meters || ""} placeholder={t(lang, "ph_m")} onChange={(event) => updateSet(exercise.index, setIndex, "meters", Number(event.target.value))} onBlur={(event) => { if (restPrefs.auto && Number(event.target.value) > 0) startRest(restSec, t(lang, "train_rest_for", { name: exercise.name, n: setIndex + 1 })); }} /></label>}<div className="rpe-chips">{[6, 7, 8, 9, 10].map((rpe) => <button type="button" className={set.rpe === rpe ? "rpe-chip selected" : "rpe-chip"} key={rpe} onClick={() => updateSet(exercise.index, setIndex, "rpe", rpe)}>{rpe}</button>)}</div><button type="button" className="icon-button set-remove" onClick={() => removeSet(exercise.index, setIndex)} aria-label={t(lang, "train_remove_set_aria")}>×</button></div>)}</div><div className="button-row exercise-footer"><button className="button button-ghost" onClick={() => addSet(exercise.index)}>{t(lang, "train_add_set_btn")}</button><button className="text-button" onClick={() => moveExercise(exercise.index, -1)}>↑</button><button className="text-button" onClick={() => moveExercise(exercise.index, 1)}>↓</button><button className="text-button danger-button" onClick={() => removeExercise(exercise.index)}>{t(lang, "train_delete_btn")}</button></div></Card>; })}</div>{showCustom ? <Card tone="muted"><div className="input-row"><input value={customName} maxLength={80} placeholder={t(lang, "train_custom_ph")} onChange={(event) => setCustomName(event.target.value)} /><button className="button button-primary" disabled={actionBusy === "custom"} onClick={() => void addCustom()}>{actionBusy === "custom" ? "…" : t(lang, "train_add_custom_btn")}</button><button className="button button-ghost" onClick={() => setShowCustom(false)}>{t(lang, "cancel_btn")}</button></div></Card> : <button className="button button-ghost button-wide" onClick={() => setShowCustom(true)}>{t(lang, "train_add_exercise_btn")}</button>}{restEndAt != null && <div className={restDone ? "rest-bar over" : "rest-bar"} role="status" aria-live="polite"><div className="rest-ring" style={{ ["--rest-pct" as string]: `${restRingPct(restTarget, restLeft)}%` }}><span>{restDone ? `+${fmtRest(restOver)}` : fmtRest(restLeft)}</span></div><div className="rest-meta"><strong>{restDone ? t(lang, "train_rest_over_label") : t(lang, "train_resting_label", { time: fmtRest(restLeft) })}</strong><small>{restLabel ? `${restLabel} · ` : ""}{liveDensity !== null ? t(lang, "rest_bar_density", { n: liveDensity }) : ""}{quality.onTargetStreak > 1 ? ` · 🎯 ${quality.onTargetStreak}` : ""}</small></div><div className="rest-actions"><button type="button" className="rest-adjust" onClick={() => adjustRest(-REST_ADJUST_SEC)} aria-label={t(lang, "train_rest_minus_aria", { sec: REST_ADJUST_SEC })}>−{REST_ADJUST_SEC}</button><button type="button" className="rest-adjust" onClick={() => adjustRest(REST_ADJUST_SEC)} aria-label={t(lang, "train_rest_plus_aria", { sec: REST_ADJUST_SEC })}>+{REST_ADJUST_SEC}</button><button type="button" className="rest-skip" onClick={stopRest}>{t(lang, "train_rest_skip_btn")}</button></div></div>}<button className="button button-primary button-wide" onClick={save} disabled={saving || filled === 0}>{saving ? t(lang, "saving_ellipsis") : logDate ? t(lang, "save_for_date", { date: logDate }) : t(lang, "save_session")}</button></div>;
}
