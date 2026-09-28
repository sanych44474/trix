// The guided workout logger. This file only orchestrates: the pure state rules live in
// ./logic/logger.ts (+ hydrate.ts, rest.ts), the live rest timer and session clock in
// ./train/useSession.ts, and the pieces of the screen in ./train/*.tsx.
import { useEffect, useRef, useState } from "react";
import { api, typedBody } from "./api";
import type { Dashboard, SaveResponse, WorkoutCopyExercise, WorkoutHistoryItem, WorkoutToday } from "./types";
import { t, type Lang } from "./i18n";
import { density, fmtDuration, restMetricKey } from "./logic/rest";
import { hydrateSaved } from "./logic/hydrate";
import {
  buildSaveEntries, chooseStart, copyToLoggerExercises, countFilledSets, DENSITY_MIN_SESSION_SEC, DRAFT_KEY,
  emptyLoggerSet, isExerciseFilled, isoDate, isoWeekday, parseDraft, plannedSetsFor, sessionElapsedSec, swapExercise,
  type LoggerDraft, type LoggerExercise, type LoggerWorkout, type StartSource,
} from "./logic/logger";
import { useSession } from "./train/useSession";
import { ExerciseCard, type SetField } from "./train/ExerciseCard";
import { HistoryPanel } from "./train/HistoryPanel";
import { RestBar } from "./train/RestBar";
import { SaveDock, type DockAction, type SyncState } from "./train/SaveDock";
import { SessionSummary, type SaveSummary } from "./train/SessionSummary";
import { Card, Empty, ErrorState, Loading } from "./train/ui";

// How long the logger waits after the last change before copying the draft to the server.
const DRAFT_SYNC_DELAY_MS = 2500;

function readLocalDraft(): LoggerDraft | null {
  try { return parseDraft(localStorage.getItem(DRAFT_KEY)); } catch { return null; }
}

function writeLocalDraft(draft: LoggerDraft | null): void {
  try { if (draft) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); else localStorage.removeItem(DRAFT_KEY); } catch { /* storage is optional */ }
}

/** Telegram's native confirm where the client has it (Bot API 6.2+), the browser's otherwise. */
function confirmDialog(message: string): Promise<boolean> {
  const tg = window.Telegram?.WebApp;
  if (tg?.showConfirm) {
    return new Promise((resolve) => {
      try { tg.showConfirm!(message, (ok) => resolve(ok)); } catch { resolve(window.confirm(message)); }
    });
  }
  return Promise.resolve(window.confirm(message));
}

function scrollToTop(): void {
  try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { window.scrollTo(0, 0); }
}

export function TrainView({ lang, gamification }: { lang: Lang; gamification?: Dashboard["gamification"] }) {
  const session = useSession();
  const [subview, setSubview] = useState<"today" | "history">("today");
  const [server, setServer] = useState<WorkoutToday | null>(null);
  const [workout, setWorkout] = useState<LoggerWorkout | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  // Separate from `error` on purpose: `error` means "couldn't load the view" and replaces the
  // whole screen. An action failing (save/swap/custom -- e.g. a 409 while a slow save is still in
  // flight) is recoverable and must not blank out a half-filled form.
  const [actionError, setActionError] = useState<unknown>(null);
  const [logDate, setLogDate] = useState<string | null>(null);
  const [copiedFrom, setCopiedFrom] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false); // what is shown is exactly what the server has
  const [drafted, setDrafted] = useState(false); // there is unsaved work
  const [savedAt, setSavedAt] = useState<number | undefined>(undefined);
  const [editedAt, setEditedAt] = useState(0);
  const [restoredFrom, setRestoredFrom] = useState<StartSource | null>(null);
  const [sync, setSync] = useState<SyncState>("idle");
  const [summary, setSummary] = useState<SaveSummary | null>(null);
  const [summaryDate, setSummaryDate] = useState<string | null>(null);
  const [history, setHistory] = useState<WorkoutHistoryItem[] | null>(null);
  const [historyError, setHistoryError] = useState<unknown>(null);
  const [historyBusy, setHistoryBusy] = useState<string | null>(null);
  const [missedDate, setMissedDate] = useState("");
  const [restEditFor, setRestEditFor] = useState<number | null>(null);
  const [swapFor, setSwapFor] = useState<number | null>(null);
  const [swapChoices, setSwapChoices] = useState<Array<{ id: string; name: string }>>([]);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [infoFor, setInfoFor] = useState<number | null>(null);
  const [info, setInfo] = useState<{ technique: string; videoUrl?: string; videoTitle?: string } | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [customName, setCustomName] = useState("");
  // The server copy of the draft: the body waiting to be sent, and the request in flight (a save
  // waits for it, so a late autosave can't land after the save and resurrect a stale draft).
  const pendingDraftRef = useRef<{ date: string; body: string } | null>(null);
  const inflightRef = useRef<Promise<unknown> | null>(null);
  const loadedRef = useRef(false);

  const pushDraft = (keepalive = false) => {
    const pending = pendingDraftRef.current;
    if (!pending) return;
    pendingDraftRef.current = null;
    const request = api(`/api/v2/workout/draft?date=${pending.date}`, { method: "PUT", keepalive, body: typedBody<"putWorkoutDraft">({ body: pending.body }) })
      .then(() => setSync("synced"), () => setSync("offline"));
    inflightRef.current = request;
  };

  // Keep the draft wherever the user goes: locally on every change (instant), and on the server
  // shortly after (survives a cleared Telegram cache, and follows the user to another device).
  // Only today's unsaved work goes to the server; a back-filled past day stays local.
  useEffect(() => {
    if (!workout || !loadedRef.current) return;
    const draft: LoggerDraft = {
      v: 2, date: workout.date, exercises: workout.exercises, logDate, copiedFrom, editedAt,
      ...(savedAt !== undefined ? { savedAt } : {}),
      ...(session.clock ? { clock: session.clock } : {}),
    };
    writeLocalDraft(draft);
    if (!drafted || logDate) { pendingDraftRef.current = null; return; }
    pendingDraftRef.current = { date: workout.date, body: JSON.stringify(draft) };
    setSync("pending");
    const id = setTimeout(() => pushDraft(), DRAFT_SYNC_DELAY_MS);
    return () => clearTimeout(id);
  }, [workout, logDate, copiedFrom, editedAt, savedAt, drafted, session.clock]);

  // Leaving (tab switch inside the app, Telegram minimised, view unmounted) must not lose the
  // last few seconds of the debounce -- flush it, with keepalive so it survives the page going away.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") pushDraft(true); };
    document.addEventListener("visibilitychange", onHide);
    return () => { document.removeEventListener("visibilitychange", onHide); pushDraft(true); };
  }, []);

  const load = () => {
    setLoading(true); setError(null);
    api<WorkoutToday>("/api/v2/workout/today").then((raw) => {
      const start = chooseStart(raw, readLocalDraft());
      setServer(raw);
      setWorkout({ ...raw, exercises: start.exercises });
      setLogDate(start.logDate); setCopiedFrom(start.copiedFrom);
      setSaved(start.saved); setDrafted(start.drafted);
      setSavedAt(start.savedAt); setEditedAt(start.editedAt);
      setRestoredFrom(start.source);
      setSync(start.source === "server-draft" ? "synced" : "idle");
      session.restore(start.clock);
      loadedRef.current = true;
    }).catch(setError).finally(() => setLoading(false));
  };
  useEffect(load, []);

  /** Every edit goes through here: it marks the work unsaved and hides a stale summary. */
  const mutate = (change: (exercises: LoggerExercise[]) => LoggerExercise[]) => {
    setWorkout((current) => current ? { ...current, exercises: change(current.exercises) } : current);
    setEditedAt(Date.now()); setSaved(false); setDrafted(true); setSummary(null);
  };
  const mapExercise = (index: number, change: (exercise: LoggerExercise) => LoggerExercise) =>
    mutate((exercises) => exercises.map((exercise) => exercise.index === index ? change(exercise) : exercise));

  const updateSet = (index: number, setIndex: number, field: SetField, value: number) => {
    session.markActive();
    mapExercise(index, (exercise) => {
      const sets = [...(exercise.setsDone ?? [])];
      while (sets.length <= setIndex) sets.push(emptyLoggerSet(exercise.metric));
      sets[setIndex] = { ...sets[setIndex], [field]: value };
      return { ...exercise, setsDone: sets };
    });
  };
  const fillPlanned = (index: number) => mapExercise(index, (exercise) => ({ ...exercise, setsDone: plannedSetsFor(exercise) }));
  const fillPlannedAll = () => mutate((exercises) => exercises.map((exercise) => ({ ...exercise, setsDone: plannedSetsFor(exercise) })));
  const fillLast = (index: number) => mapExercise(index, (exercise) => !exercise.last?.length ? exercise : { ...exercise, setsDone: exercise.last.map((set) => ({ weight: set.w, reps: set.r, seconds: set.sec || undefined, meters: set.m || undefined })) });
  const addSet = (index: number) => mapExercise(index, (exercise) => ({ ...exercise, setsDone: [...(exercise.setsDone ?? []), emptyLoggerSet(exercise.metric)] }));
  const removeSet = (index: number, setIndex: number) => mapExercise(index, (exercise) => ({ ...exercise, setsDone: (exercise.setsDone ?? []).filter((_, i) => i !== setIndex) }));
  const moveExercise = (index: number, direction: -1 | 1) => mutate((exercises) => {
    const at = exercises.findIndex((exercise) => exercise.index === index);
    const to = at + direction;
    if (at < 0 || to < 0 || to >= exercises.length) return exercises;
    const next = [...exercises];
    [next[at], next[to]] = [next[to], next[at]];
    return next.map((exercise, i) => ({ ...exercise, index: i }));
  });
  const removeExercise = (index: number) => {
    const exercise = workout?.exercises.find((item) => item.index === index);
    if (exercise?.setsDone?.some((set) => set.reps || set.seconds || set.meters || set.weight) && !window.confirm(t(lang, "train_delete_typed_confirm"))) return;
    mutate((exercises) => exercises.filter((item) => item.index !== index).map((item, i) => ({ ...item, index: i })));
  };

  const loadHistory = () => { setHistoryError(null); api<{ logs: WorkoutHistoryItem[] }>("/api/v2/workout/history").then((data) => setHistory(data.logs)).catch(setHistoryError); };
  useEffect(() => { if (subview === "history" && history === null) loadHistory(); }, [subview, history]);
  const todayDate = workout?.date ?? isoDate(new Date());
  const minMissedDate = isoDate(new Date(Date.parse(`${todayDate}T00:00:00Z`) - 14 * 86_400_000));

  /** Replace the whole list from somewhere else (history, a past day): unsaved by definition. */
  const replaceWith = (next: LoggerWorkout, nextLogDate: string | null, nextCopiedFrom: string | null) => {
    setWorkout(next); setLogDate(nextLogDate); setCopiedFrom(nextCopiedFrom);
    setEditedAt(Date.now()); setSaved(false); setDrafted(true); setSavedAt(undefined); setSummary(null); setRestoredFrom(null);
    setSubview("today");
  };
  const withHistoryBusy = async (key: string, run: () => Promise<void>) => {
    setHistoryBusy(key);
    try { await run(); } catch (err) { setHistoryError(err); } finally { setHistoryBusy(null); }
  };
  const repeatToday = (date: string) => withHistoryBusy(`repeat:${date}`, async () => {
    if (!workout) return;
    const data = await api<{ exercises: WorkoutCopyExercise[] }>(`/api/v2/workout/past?date=${date}`);
    replaceWith({ ...workout, exercises: copyToLoggerExercises(data.exercises) }, null, date);
  });
  const startMissedBlank = (date: string) => withHistoryBusy(`blank:${date}`, async () => {
    const data = await api<WorkoutToday>(`/api/v2/workout/today?date=${date}`);
    // Keyed to today's date like every other draft, so it is restored if the app is reopened.
    replaceWith({ ...hydrateSaved(data), date: todayDate }, date, null);
  });
  // targetDate === sourceDate is "edit this already-saved day in place": /workout/past returns the
  // exact historical sets, and logDate = that same date makes save() post back to it -- the D1
  // save path (upsertWorkoutLog: ON CONFLICT(accountId,date) DO UPDATE + delete-then-insert of
  // exercises/sets) overwrites the existing session instead of duplicating it.
  const startMissedFromHistory = (targetDate: string, sourceDate: string) => withHistoryBusy(`fill:${sourceDate}`, async () => {
    const data = await api<{ exercises: WorkoutCopyExercise[] }>(`/api/v2/workout/past?date=${sourceDate}`);
    replaceWith({ date: todayDate, weekday: isoWeekday(targetDate), exercises: copyToLoggerExercises(data.exercises) }, targetDate, sourceDate);
  });
  const backToToday = async () => {
    // Discarding a "repeat" of a past session also discards its server copy.
    if (copiedFrom && !logDate && workout) await api(`/api/v2/workout/draft?date=${workout.date}`, { method: "DELETE" }).catch(() => {});
    pendingDraftRef.current = null;
    loadedRef.current = false;
    writeLocalDraft(null);
    setSummary(null);
    session.restore(undefined);
    load();
  };

  const openSwap = async (exercise: LoggerExercise) => {
    const index = exercise.index;
    setSwapFor(index); setActionBusy(`swap:${index}`);
    const planName = exercise.planName ?? exercise.name;
    try {
      const data = await api<{ alternatives: Array<{ id: string; name: string }> }>(`/api/v2/workout/swap?index=${index}&name=${encodeURIComponent(planName)}`);
      setSwapChoices(data.alternatives);
    } catch (err) { setActionError(err); } finally { setActionBusy(null); }
  };
  const applySwap = (name: string) => {
    if (swapFor === null) return;
    const index = swapFor;
    mutate((exercises) => swapExercise(exercises, index, name));
    setSwapFor(null); setSwapChoices([]);
  };
  const addCustom = async () => {
    const name = customName.trim();
    if (name.length < 2) return;
    setActionBusy("custom");
    try {
      const result = await api<{ name: string; videoUrl?: string; videoTitle?: string }>("/api/v2/workout/custom", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"addCustomExercise">({ name }) });
      mutate((exercises) => [...exercises, { index: exercises.length, name: result.name, metric: "reps", sets: 1, ...(result.videoUrl ? { videoUrl: result.videoUrl, videoTitle: result.videoTitle } : {}) }]);
      setCustomName(""); setShowCustom(false);
    } catch (err) { setActionError(err); } finally { setActionBusy(null); }
  };
  const openInfo = async (exercise: LoggerExercise) => {
    if (infoFor === exercise.index) { setInfoFor(null); return; }
    setInfoFor(exercise.index);
    if (exercise.technique || exercise.videoUrl) { setInfo({ technique: exercise.technique ?? "", videoUrl: exercise.videoUrl, videoTitle: exercise.videoTitle }); return; }
    setActionBusy(`info:${exercise.index}`);
    try { setInfo(await api(`/api/v2/workout/exinfo?name=${encodeURIComponent(exercise.name)}`)); } catch { setInfo(null); } finally { setActionBusy(null); }
  };

  const dayLogged = savedAt !== undefined || Boolean(server?.saved?.length);
  const filledSets = workout ? countFilledSets(workout.exercises) : 0;
  const dockAction: DockAction = logDate
    ? (saved ? { kind: "saved" } : { kind: "backfill", date: logDate })
    : saved ? { kind: "saved" } : dayLogged ? { kind: "update" } : { kind: "finish" };

  const save = async () => {
    if (!workout || saving) return;
    const entries = buildSaveEntries(workout.exercises);
    if (!entries.length) return;
    const action = dockAction;
    const startedSave = Date.now();
    // Finishing ends the session clock; editing an already-saved day leaves it (and its stored
    // length) alone, and a back-filled day was never timed.
    const final = action.kind === "finish" ? session.finalClock(startedSave) : undefined;
    const elapsed = sessionElapsedSec(final, startedSave);
    if (action.kind === "finish") {
      const sets = countFilledSets(workout.exercises);
      const ok = await confirmDialog(elapsed ? t(lang, "finish_confirm", { sets, time: fmtDuration(elapsed) }) : t(lang, "finish_confirm_no_time", { sets }));
      if (!ok) return;
    }
    setSaving(true); setActionError(null);
    const targetDate = logDate;
    try {
      pendingDraftRef.current = null;
      await inflightRef.current?.catch(() => {});
      const timing = final && elapsed > 0 ? { durationSec: elapsed, restTotalSec: Math.min(final.quality.restTotalSec, elapsed) } : {};
      const result = await api<SaveResponse>("/api/v2/workout/save", {
        method: "POST",
        idempotencyKey: crypto.randomUUID(),
        body: typedBody<"saveWorkout">({ entries, ...(targetDate ? { date: targetDate } : {}), ...timing }),
      });
      const doneAt = Date.now();
      if (action.kind === "finish") session.finish(final);
      setSaved(true); setDrafted(false); setSavedAt(doneAt); setSync("idle"); setRestoredFrom(null);
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
      if (action.kind !== "update") {
        setSummaryDate(targetDate);
        setSummary({
          prExercises: result.prExercises ?? [],
          newBadges: result.newBadges ?? [],
          level: result.level ?? 1,
          leveledUp: result.leveledUp === true,
          totalWorkouts: result.totalWorkouts ?? 0,
          sets: countFilledSets(workout.exercises),
          elapsedSec: elapsed,
          densityPct: final && elapsed >= DENSITY_MIN_SESSION_SEC ? density(final.startedAt, final.quality.restTotalSec, final.endedAt ?? doneAt) : null,
          bestStreak: final?.quality.bestStreak ?? 0,
        });
        // The summary renders at the top; the button that got pressed is at the bottom.
        scrollToTop();
      }
      if (targetDate) { writeLocalDraft(null); loadedRef.current = false; setHistory(null); load(); }
    } catch (err) {
      // A 409 means the idempotency layer found this exact save still in flight; it clears within
      // ~30s and a retry (fresh key, same form data -- the draft is kept) then succeeds.
      setActionError(err);
      scrollToTop();
    } finally { setSaving(false); }
  };

  if (loading) return <Loading />;
  if (error) return <ErrorState lang={lang} error={error} retry={load} />;
  const tabs = (
    <div className="button-row tabs">
      <button className={subview === "today" ? "button button-primary" : "button button-ghost"} onClick={() => setSubview("today")}>{t(lang, "train_tab_today")}</button>
      <button className={subview === "history" ? "button button-primary" : "button button-ghost"} onClick={() => setSubview("history")}>{t(lang, "train_tab_history")}</button>
    </div>
  );
  if (subview === "history") {
    return (
      <HistoryPanel
        lang={lang} tabs={tabs} history={history} error={historyError} busy={historyBusy}
        todayDate={todayDate} minMissedDate={minMissedDate} missedDate={missedDate}
        onRetry={loadHistory} onRepeat={(date) => void repeatToday(date)} onFillFrom={(target, source) => void startMissedFromHistory(target, source)}
        onStartBlank={(date) => void startMissedBlank(date)} onPickMissed={setMissedDate}
      />
    );
  }
  if (!workout?.exercises?.length) return <div className="view-stack">{tabs}<Empty title={t(lang, "rest_day_title")} detail={t(lang, "rest_day_detail")} /></div>;
  const filled = workout.exercises.filter(isExerciseFilled).length;
  const liveDensity = density(session.clock && !session.clock.endedAt ? session.clock.startedAt : null, session.clock?.quality.restTotalSec ?? 0, Date.now());
  const savedTitle = summaryDate ? t(lang, "session_saved_for_date", { date: summaryDate }) : t(lang, "session_saved");

  return (
    <div className="view-stack">
      <div className="eyebrow">{t(lang, "guided_logger_eyebrow", { date: logDate ?? workout.date })}</div>
      <div className="page-title"><h1>{t(lang, "training_session_title")}</h1><span>{filled}/{workout.exercises.length}</span></div>
      {tabs}
      {gamification && !saved && (
        <div className="train-progress">
          <span className="tag">{t(lang, "level_n", { n: gamification.level })}</span>
          <div className="progress-track"><span style={{ width: `${gamification.needed ? Math.min(100, gamification.intoLevel / gamification.needed * 100) : 100}%` }} /></div>
          {gamification.streak ? <span className="tag">{t(lang, "streak_weeks", { n: gamification.streak })}</span> : null}
        </div>
      )}
      {actionError !== null && (
        <Card tone="muted">
          <div className="error-state">
            <strong>{t(lang, "generic_error")}</strong>
            <button className="button button-ghost" onClick={() => setActionError(null)}>{t(lang, "close")}</button>
          </div>
        </Card>
      )}
      {(logDate || copiedFrom) && <div className="button-row"><button className="text-button" onClick={() => void backToToday()}>{t(lang, "back_to_today")}</button></div>}
      {summary ? <SessionSummary lang={lang} summary={summary} title={savedTitle} date={summaryDate ?? workout.date} /> : saved && dayLogged ? <div className="save-note">{savedTitle}</div> : null}
      {restoredFrom === "server-draft" && drafted && <div className="draft-note">{t(lang, "restored_other_device_note")}</div>}
      {logDate && !saved && <div className="draft-note">{t(lang, "logging_for_date_note", { date: logDate })}</div>}
      {copiedFrom && !logDate && !saved && <div className="draft-note">{t(lang, "repeated_note", { date: copiedFrom })}</div>}
      <div className="progress-track session-progress"><span style={{ width: `${workout.exercises.length ? filled / workout.exercises.length * 100 : 0}%` }} /></div>
      {workout.exercises.length > 1 && <div className="button-row"><button className="button button-ghost" onClick={fillPlannedAll}>{t(lang, "train_as_planned_all_btn")}</button></div>}
      <div className="exercise-list">
        {workout.exercises.map((exercise) => {
          const restSec = exercise.restSec ?? session.restPrefs[restMetricKey(exercise.metric)];
          return (
            <ExerciseCard
              key={`${exercise.index}-${exercise.name}`}
              lang={lang}
              exercise={exercise}
              restSec={restSec}
              restPrefs={session.restPrefs}
              restPrefsOpen={restEditFor === exercise.index}
              swapOpen={swapFor === exercise.index}
              swapChoices={swapChoices}
              info={infoFor === exercise.index ? info : null}
              busy={actionBusy}
              onStartRest={session.startRest}
              onToggleRestPrefs={() => setRestEditFor((current) => current === exercise.index ? null : exercise.index)}
              onPatchRestPrefs={session.patchRestPrefs}
              onFillPlanned={() => fillPlanned(exercise.index)}
              onFillLast={() => fillLast(exercise.index)}
              onOpenSwap={() => void openSwap(exercise)}
              onApplySwap={applySwap}
              onOpenInfo={() => void openInfo(exercise)}
              onUpdateSet={(setIndex, field, value) => updateSet(exercise.index, setIndex, field, value)}
              onAddSet={() => addSet(exercise.index)}
              onRemoveSet={(setIndex) => removeSet(exercise.index, setIndex)}
              onMove={(direction) => moveExercise(exercise.index, direction)}
              onRemove={() => removeExercise(exercise.index)}
            />
          );
        })}
      </div>
      {showCustom ? (
        <Card tone="muted">
          <div className="input-row">
            <input value={customName} maxLength={80} placeholder={t(lang, "train_custom_ph")} onChange={(event) => setCustomName(event.target.value)} />
            <button className="button button-primary" disabled={actionBusy === "custom"} onClick={() => void addCustom()}>{actionBusy === "custom" ? "…" : t(lang, "train_add_custom_btn")}</button>
            <button className="button button-ghost" onClick={() => setShowCustom(false)}>{t(lang, "cancel_btn")}</button>
          </div>
        </Card>
      ) : <button className="button button-ghost button-wide" onClick={() => setShowCustom(true)}>{t(lang, "train_add_exercise_btn")}</button>}
      <div className={session.rest.endAt != null ? "dock-spacer tall" : "dock-spacer"} />
      <SaveDock
        lang={lang}
        action={dockAction}
        saving={saving}
        disabled={filled === 0}
        savedAt={savedAt}
        drafted={drafted}
        sync={sync}
        clock={logDate ? undefined : session.clock}
        filledSets={filledSets}
        onPress={() => void save()}
        restBar={session.rest.endAt != null ? (
          <RestBar lang={lang} rest={session.rest} density={liveDensity} streak={session.clock?.quality.onTargetStreak ?? 0} onAdjust={session.adjustRest} onSkip={session.stopRest} />
        ) : null}
      />
    </div>
  );
}
