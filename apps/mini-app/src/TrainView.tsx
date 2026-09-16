import { useEffect, useState } from "react";
import { api, ApiError, jsonBody } from "./api";
import type { WorkoutCopyExercise, WorkoutHistoryItem, WorkoutToday } from "./types";
import { t, type Lang } from "./i18n";

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

// ---- Rest timer (mirrors the legacy vanilla logger's lgRest/REST_OPTS intent: a countdown that
// starts once a set's numbers are in, dismissible/resettable) ----
const DEFAULT_REST_SEC = 60;

function fmtRest(sec: number): string {
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return `${m}:${r < 10 ? "0" : ""}${r}`;
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

export function TrainView({ lang }: { lang: Lang }) {
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
  useEffect(() => {
    if (restEndAt == null) return;
    const tick = () => {
      const left = Math.max(0, Math.round((restEndAt - Date.now()) / 1000));
      setRestLeft(left);
      if (left <= 0) {
        setRestEndAt(null); setRestDone(true);
        window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
        setTimeout(() => setRestDone(false), 4000);
      }
    };
    tick();
    const id = setInterval(tick, 500);
    const onResume = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onResume);
    window.addEventListener("focus", onResume);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onResume); window.removeEventListener("focus", onResume); };
  }, [restEndAt]);

  const startRest = (seconds: number) => {
    const bounded = Math.max(30, Math.min(900, Math.round(seconds || DEFAULT_REST_SEC)));
    setRestSeconds(bounded); setRestDone(false); setRestLeft(bounded); setRestEndAt(Date.now() + bounded * 1000);
    void api("/api/v2/workout/rest", { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({ seconds: bounded }) }).catch(() => {});
  };
  const stopRest = () => { setRestEndAt(null); setRestDone(false); };

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
  const backToToday = () => { localStorage.removeItem(draftKey); load(); };
  const openSwap = async (index: number) => { setSwapFor(index); setActionBusy(`swap:${index}`); try { const data = await api<{ alternatives: Array<{ id: string; name: string }> }>(`/api/v2/workout/swap?index=${index}`); setSwapChoices(data.alternatives); } catch (err) { setActionError(err); } finally { setActionBusy(null); } };
  const applySwap = (name: string) => { if (swapFor === null) return; setWorkout((current) => { if (!current) return current; const next = { ...current, exercises: current.exercises.map((exercise) => exercise.index === swapFor ? { ...exercise, name, setsDone: [] } : exercise) }; persistDraft(next, logDate, copiedFrom); return next; }); setSwapFor(null); setSwapChoices([]); };
  const addCustom = async () => { const name = customName.trim(); if (name.length < 2) return; setActionBusy("custom"); try { const result = await api<{ name: string; videoUrl?: string; videoTitle?: string }>("/api/v2/workout/custom", { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({ name }) }); setWorkout((current) => { if (!current) return current; const exercise: LoggerExercise = { index: current.exercises.length, name: result.name, metric: "reps", sets: 1, ...(result.videoUrl ? { videoUrl: result.videoUrl, videoTitle: result.videoTitle } : {}) }; const next = { ...current, exercises: [...current.exercises, exercise] }; persistDraft(next, logDate, copiedFrom); return next; }); setCustomName(""); setShowCustom(false); } catch (err) { setActionError(err); } finally { setActionBusy(null); } };
  const openInfo = async (exercise: LoggerExercise) => { if (infoFor === exercise.index) { setInfoFor(null); return; } setInfoFor(exercise.index); if (exercise.technique || exercise.videoUrl) { setInfo({ technique: exercise.technique ?? "", videoUrl: exercise.videoUrl, videoTitle: exercise.videoTitle }); return; } setActionBusy(`info:${exercise.index}`); try { setInfo(await api(`/api/v2/workout/exinfo?name=${encodeURIComponent(exercise.name)}`)); } catch { setInfo(null); } finally { setActionBusy(null); } };
  const save = async () => { if (!workout) return; setSaving(true); setSaved(false); setActionError(null); const targetDate = logDate; try { await api("/api/v2/workout/save", { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({ entries: workout.exercises.filter((e) => e.setsDone?.some((set) => set.reps || set.seconds || set.meters)).map((e) => ({ name: e.name, sets: e.setsDone, ...(e.rpe !== undefined ? { rpe: e.rpe } : {}) })), ...(targetDate ? { date: targetDate } : {}) }) }); localStorage.removeItem(draftKey); setDrafted(false); setSaved(true); setSaveNoteDate(targetDate); window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success"); if (targetDate) { setHistory(null); load(); } } catch (err) {
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
  return <div className="view-stack"><div className="eyebrow">{t(lang, "guided_logger_eyebrow", { date: logDate ?? workout.date })}</div><div className="page-title"><h1>{t(lang, "training_session_title")}</h1><span>{filled}/{workout.exercises.length}</span></div>{tabs}{actionError !== null && <Card tone="muted"><div className="error-state"><strong>{t(lang, "generic_error")}</strong><button className="button button-ghost" onClick={() => setActionError(null)}>{t(lang, "close")}</button></div></Card>}{(logDate || copiedFrom) &&<div className="button-row"><button className="text-button" onClick={backToToday}>{t(lang, "back_to_today")}</button></div>}{saved && <div className="save-note">{saveNoteDate ? t(lang, "session_saved_for_date", { date: saveNoteDate }) : t(lang, "session_saved")}</div>}{logDate && !saved && <div className="draft-note">{t(lang, "logging_for_date_note", { date: logDate })}</div>}{copiedFrom && !logDate && !saved && <div className="draft-note">{t(lang, "repeated_note", { date: copiedFrom })}</div>}{drafted && <div className="draft-note">{t(lang, "draft_saved_note")}</div>}<div className="progress-track session-progress"><span style={{ width: `${workout.exercises.length ? filled / workout.exercises.length * 100 : 0}%` }} /></div>{workout.exercises.length > 1 && <div className="button-row"><button className="button button-ghost" onClick={fillPlannedAll}>{t(lang, "train_as_planned_all_btn")}</button></div>}<div className="exercise-list">{workout.exercises.map((exercise) => { const restSec = exercise.restSec ?? restSeconds; const sets = exercise.setsDone ?? []; const completed = sets.some((set) => set.reps || set.seconds || set.meters); return <Card key={`${exercise.index}-${exercise.name}`} tone={completed ? "muted" : "default"}><div className="exercise-head"><div><span className="exercise-index">{String(exercise.index + 1).padStart(2, "0")}</span><h2>{completed ? "✓ " : ""}{exercise.name}</h2></div><div className="button-row"><span className="tag">{t(lang, exercise.metric === "reps" ? "metric_tag_reps" : exercise.metric === "time" ? "metric_tag_time" : "metric_tag_distance")}</span><button type="button" className="text-button" onClick={() => startRest(restSec)}>{t(lang, "train_start_rest_btn", { sec: restSec })}</button></div></div><p className="muted">{exercise.planSets ? `${exercise.planSets}${exercise.planWeight ? ` · ${exercise.planWeight}` : ""}` : t(lang, "exercise_sets_line", { n: exercise.sets, detail: exercise.metric === "reps" ? t(lang, "controlled_reps") : t(lang, "measured_effort") })}</p><div className="button-row exercise-actions"><button className="text-button" onClick={() => fillPlanned(exercise.index)}>{t(lang, "train_as_planned_btn")}</button>{exercise.last?.length ? <button className="text-button" onClick={() => fillLast(exercise.index)}>{t(lang, "train_repeat_last_btn")}</button> : null}<button className="text-button" onClick={() => void openSwap(exercise.index)}>{actionBusy === `swap:${exercise.index}` ? "…" : t(lang, "train_swap_btn")}</button><button className="text-button" onClick={() => void openInfo(exercise)}>{actionBusy === `info:${exercise.index}` ? "…" : t(lang, "train_info_btn")}</button></div>{swapFor === exercise.index && <div className="choice-list">{swapChoices.length ? swapChoices.map((choice) => <button className="choice-button" key={choice.id} onClick={() => applySwap(choice.name)}>{choice.name}</button>) : <span className="muted">{t(lang, "train_no_swaps")}</span>}</div>}{infoFor === exercise.index && info && <div className="info-box"><p>{info.technique || t(lang, "train_no_info")}</p>{info.videoUrl && <a href={info.videoUrl} target="_blank" rel="noreferrer">{info.videoTitle || t(lang, "train_watch_video")}</a>}</div>}<div className="set-list">{sets.map((set, setIndex) => <div className="set-row" key={setIndex}><span className="set-number">{setIndex + 1}</span>{exercise.metric === "reps" ? <><label><span>{t(lang, "field_load")}</span><input type="number" inputMode="decimal" value={set.weight || ""} placeholder={t(lang, "ph_kg")} onChange={(event) => updateSet(exercise.index, setIndex, "weight", Number(event.target.value))} /></label><label><span>{t(lang, "field_reps")}</span><input type="number" inputMode="numeric" value={set.reps || ""} placeholder={t(lang, "ph_reps")} onChange={(event) => updateSet(exercise.index, setIndex, "reps", Number(event.target.value))} onBlur={(event) => { if (Number(event.target.value) > 0) startRest(restSec); }} /></label></> : exercise.metric === "time" ? <label><span>{t(lang, "field_seconds")}</span><input type="number" inputMode="numeric" value={set.seconds || ""} placeholder={t(lang, "ph_sec")} onChange={(event) => updateSet(exercise.index, setIndex, "seconds", Number(event.target.value))} onBlur={(event) => { if (Number(event.target.value) > 0) startRest(restSec); }} /></label> : <label><span>{t(lang, "field_meters")}</span><input type="number" inputMode="decimal" value={set.meters || ""} placeholder={t(lang, "ph_m")} onChange={(event) => updateSet(exercise.index, setIndex, "meters", Number(event.target.value))} onBlur={(event) => { if (Number(event.target.value) > 0) startRest(restSec); }} /></label>}<div className="rpe-chips">{[6, 7, 8, 9, 10].map((rpe) => <button type="button" className={set.rpe === rpe ? "rpe-chip selected" : "rpe-chip"} key={rpe} onClick={() => updateSet(exercise.index, setIndex, "rpe", rpe)}>{rpe}</button>)}</div><button type="button" className="icon-button set-remove" onClick={() => removeSet(exercise.index, setIndex)} aria-label={t(lang, "train_remove_set_aria")}>×</button></div>)}</div><div className="button-row exercise-footer"><button className="button button-ghost" onClick={() => addSet(exercise.index)}>{t(lang, "train_add_set_btn")}</button><button className="text-button" onClick={() => moveExercise(exercise.index, -1)}>↑</button><button className="text-button" onClick={() => moveExercise(exercise.index, 1)}>↓</button><button className="text-button danger-button" onClick={() => removeExercise(exercise.index)}>{t(lang, "train_delete_btn")}</button></div></Card>; })}</div>{showCustom ? <Card tone="muted"><div className="input-row"><input value={customName} maxLength={80} placeholder={t(lang, "train_custom_ph")} onChange={(event) => setCustomName(event.target.value)} /><button className="button button-primary" disabled={actionBusy === "custom"} onClick={() => void addCustom()}>{actionBusy === "custom" ? "…" : t(lang, "train_add_custom_btn")}</button><button className="button button-ghost" onClick={() => setShowCustom(false)}>{t(lang, "cancel_btn")}</button></div></Card> : <button className="button button-ghost button-wide" onClick={() => setShowCustom(true)}>{t(lang, "train_add_exercise_btn")}</button>}{restEndAt != null && <div className="draft-note">{t(lang, "train_resting_label", { time: fmtRest(restLeft) })} <button type="button" className="text-button" onClick={stopRest}>{t(lang, "train_rest_stop_btn")}</button></div>}{restDone && <div className="save-note">{t(lang, "train_rest_done_note")}</div>}<button className="button button-primary button-wide" onClick={save} disabled={saving || filled === 0}>{saving ? t(lang, "saving_ellipsis") : logDate ? t(lang, "save_for_date", { date: logDate }) : t(lang, "save_session")}</button></div>;
}
