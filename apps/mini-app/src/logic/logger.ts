// Pure state logic of the guided workout logger (TrainView): the exercise list, the draft that
// survives leaving the app, and the decision of what to show when the logger opens. No DOM, no
// Date.now(), no storage -- every time is a parameter -- so it is unit-tested directly in
// test/mini-app-logger.test.ts. The React side (TrainView.tsx and ./train/*) only wires it up.
import type { WorkoutCopyExercise, WorkoutToday } from "../types";
import { EMPTY_QUALITY, type SessionQuality } from "./rest";
import { hydrateSaved } from "./hydrate";

/** One exercise in the logger. `planName` is set when the user swapped it in for a plan
 *  exercise; it is saved with the log so re-opening the day puts it back in the right slot. */
export type LoggerExercise = WorkoutToday["exercises"][number] & { planName?: string };
export type LoggerSet = NonNullable<LoggerExercise["setsDone"]>[number];
export type LoggerWorkout = Omit<WorkoutToday, "exercises"> & { exercises: LoggerExercise[] };

/** The session clock: when the first set/rest happened, the rest tally, and -- once the user
 *  finished -- when it stopped, so editing a typo later doesn't stretch the session. */
export interface SessionClock {
  startedAt: number;
  quality: SessionQuality;
  endedAt?: number;
}

/** What is kept between visits, locally and (as the same JSON) on the server. */
export interface LoggerDraft {
  v: 2;
  date: string; // the day the logger was opened for (today's date from the server)
  exercises: LoggerExercise[];
  logDate: string | null; // back-filling another day
  copiedFrom: string | null; // "repeat" of a past session
  editedAt: number; // last change, epoch ms
  savedAt?: number; // last successful save of exactly this list, epoch ms
  clock?: SessionClock;
}

export const DRAFT_KEY = "trix:v2:workout-draft";
// A measured session longer than this is a stale clock (started this morning, saved tonight).
export const MAX_SESSION_SEC = 5 * 3600;
// Below this, "% of time working" is noise (one set and a rest reads as 18%).
export const DENSITY_MIN_SESSION_SEC = 10 * 60;
// Device and server clocks disagree a little; a server save this much newer than our own is a
// real edit from elsewhere, not skew.
const CLOCK_SKEW_MS = 2 * 60_000;

export function isoWeekday(dateStr: string): number {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  return day === 0 ? 7 : day;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function emptyLoggerSet(metric: LoggerExercise["metric"]): LoggerSet {
  return metric === "time" ? { weight: 0, reps: 0, seconds: 0 } : metric === "distance" ? { weight: 0, reps: 0, meters: 0 } : { weight: 0, reps: 0 };
}

export function isSetFilled(set: LoggerSet): boolean {
  return Boolean(set.reps || set.seconds || set.meters);
}

export function isExerciseFilled(exercise: LoggerExercise): boolean {
  return (exercise.setsDone ?? []).some(isSetFilled);
}

/** Sets a "did exactly what was planned" fill for one exercise would produce. */
export function plannedSetsFor(exercise: LoggerExercise): LoggerSet[] {
  return Array.from({ length: exercise.sets || 1 }, () => exercise.metric === "reps" ? { weight: exercise.weightKg ?? 0, reps: exercise.reps ?? 0 } : exercise.metric === "time" ? { weight: 0, reps: 0, seconds: exercise.reps ?? 0 } : { weight: 0, reps: 0, meters: exercise.reps ?? 0 });
}

export function copyToLoggerExercises(items: WorkoutCopyExercise[]): LoggerExercise[] {
  return items.map((item, index) => ({
    index, name: item.name, metric: item.metric, sets: item.sets.length || 1,
    setsDone: item.sets.map((set) => ({ weight: set.w, reps: set.r, seconds: set.sec || undefined, meters: set.m || undefined, rpe: item.rpe || undefined })),
    ...(item.rpe ? { rpe: item.rpe } : {}),
  }));
}

/** Swap one exercise for another, remembering which plan exercise it stands in for. Swapping
 *  back to the plan's own exercise clears that again. */
export function swapExercise(exercises: LoggerExercise[], index: number, name: string, extra: { videoUrl?: string; videoTitle?: string } = {}): LoggerExercise[] {
  return exercises.map((exercise) => {
    if (exercise.index !== index) return exercise;
    const planName = exercise.planName ?? exercise.name;
    // The plan's technique notes, video and catalog name describe the old exercise, not this one
    // (the info panel looks the new one up by name instead).
    const { planName: _drop, technique: _t, videoUrl: _v, videoTitle: _vt, canonicalName: _c, ...rest } = exercise;
    return { ...rest, name, setsDone: [], ...(planName !== name ? { planName } : {}), ...(extra.videoUrl ? { videoUrl: extra.videoUrl, videoTitle: extra.videoTitle } : {}) };
  });
}

/** The /workout/save entries: only exercises with at least one filled set. */
export function buildSaveEntries(exercises: LoggerExercise[]): Array<{ name: string; sets: LoggerSet[]; rpe?: number; planName?: string }> {
  return exercises.flatMap((exercise) => isExerciseFilled(exercise)
    ? [{ name: exercise.name, sets: exercise.setsDone ?? [], ...(exercise.rpe !== undefined ? { rpe: exercise.rpe } : {}), ...(exercise.planName ? { planName: exercise.planName } : {}) }]
    : []);
}

export function countFilledSets(exercises: LoggerExercise[]): number {
  return exercises.reduce((total, exercise) => total + (exercise.setsDone ?? []).filter(isSetFilled).length, 0);
}

/** Session length in seconds for display/saving, or 0 when there is no trustworthy clock. */
export function sessionElapsedSec(clock: SessionClock | undefined, now: number): number {
  if (!clock) return 0;
  const sec = Math.round(((clock.endedAt ?? now) - clock.startedAt) / 1000);
  return sec > 0 && sec <= MAX_SESSION_SEC ? sec : 0;
}

/** Reads a stored draft. Accepts the pre-v2 shape (a WorkoutToday plus logDate/copiedFrom,
 *  optionally savedAt), so an update never throws away a session someone is in the middle of. */
export function parseDraft(raw: string | null | undefined): LoggerDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<LoggerDraft> & { exercises?: unknown };
    if (!value || typeof value.date !== "string" || !Array.isArray(value.exercises)) return null;
    const clock = value.clock && typeof value.clock.startedAt === "number"
      ? { ...value.clock, quality: { ...EMPTY_QUALITY, ...value.clock.quality } }
      : undefined;
    return {
      v: 2,
      date: value.date,
      exercises: value.exercises as LoggerExercise[],
      logDate: value.logDate ?? null,
      copiedFrom: value.copiedFrom ?? null,
      editedAt: typeof value.editedAt === "number" ? value.editedAt : typeof value.savedAt === "number" ? value.savedAt : 0,
      ...(typeof value.savedAt === "number" ? { savedAt: value.savedAt } : {}),
      ...(clock ? { clock } : {}),
    };
  } catch {
    return null;
  }
}

export function isDraftSaved(draft: LoggerDraft): boolean {
  return draft.savedAt !== undefined && draft.editedAt <= draft.savedAt;
}

export type StartSource = "local" | "server-draft" | "saved" | "plan";

export interface StartState {
  source: StartSource;
  exercises: LoggerExercise[];
  logDate: string | null;
  copiedFrom: string | null;
  saved: boolean; // what is shown is exactly what the server has
  drafted: boolean; // what is shown is unsaved work being restored
  clock?: SessionClock;
  savedAt?: number;
  editedAt: number;
}

/**
 * What the logger shows when it opens: the newest of (a) this device's draft, (b) the server's
 * copy of an unsaved draft -- made on another device, or before this one's cache was cleared --
 * and (c) the saved log. Before, only (a) and (c) existed, (a) was deleted on save and (c)
 * dropped swapped exercises, so leaving the app after saving brought back the plan's originals.
 */
export function chooseStart(server: WorkoutToday, local: LoggerDraft | null): StartState {
  const serverSavedAt = server.savedAt ? Date.parse(server.savedAt) : NaN;
  const remote = parseDraft(server.draft?.body);
  const candidates: Array<{ draft: LoggerDraft; source: StartSource }> = [];
  if (local && local.date === server.date) candidates.push({ draft: local, source: "local" });
  if (remote && remote.date === server.date) candidates.push({ draft: remote, source: "server-draft" });
  const newest = candidates.sort((a, b) => b.draft.editedAt - a.draft.editedAt)[0];

  const fromSaved = (): StartState => ({
    source: "saved",
    exercises: hydrateSaved(server).exercises,
    logDate: null,
    copiedFrom: null,
    saved: true,
    drafted: false,
    editedAt: Number.isFinite(serverSavedAt) ? serverSavedAt : 0,
    ...(Number.isFinite(serverSavedAt) ? { savedAt: serverSavedAt } : {}),
  });

  if (newest) {
    const { draft, source } = newest;
    // A saved log newer than every draft means the day was edited somewhere else since. The
    // skew margin keeps our own save (stamped by our clock) from looking "newer" than itself.
    const savedElsewhere = server.saved?.length && Number.isFinite(serverSavedAt) && serverSavedAt > draft.editedAt + CLOCK_SKEW_MS;
    if (!savedElsewhere) {
      const saved = isDraftSaved(draft);
      return {
        source,
        exercises: draft.exercises,
        logDate: draft.logDate,
        copiedFrom: draft.copiedFrom,
        saved,
        drafted: !saved,
        editedAt: draft.editedAt,
        ...(draft.clock ? { clock: draft.clock } : {}),
        ...(draft.savedAt !== undefined ? { savedAt: draft.savedAt } : {}),
      };
    }
    if (server.saved?.length) return { ...fromSaved(), ...(draft.clock ? { clock: draft.clock } : {}) };
  }
  if (server.saved?.length) return fromSaved();
  return { source: "plan", exercises: server.exercises, logDate: null, copiedFrom: null, saved: false, drafted: false, editedAt: 0 };
}

/** How a save used the engine's targets, for the usage counters: per exercise that had a target
 *  and was logged, "kept" when every filled set used the target weight, else "edited". */
export function targetUse(exercises: LoggerExercise[]): { kept: number; edited: number } {
  let kept = 0, edited = 0;
  for (const e of exercises) {
    if (!e.target) continue;
    const sets = (e.setsDone ?? []).filter(isSetFilled);
    if (!sets.length) continue;
    if (sets.every((s) => Math.abs((s.weight ?? 0) - e.target!.w) < 0.01)) kept++; else edited++;
  }
  return { kept, edited };
}
