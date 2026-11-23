// The trainer's form for logging a client's workout (workspace/ClientLogView.tsx, ADR-0018) and the
// voice proposal that fills it. Pure: test/mini-app-trainer-log.test.ts.
import type { TrainerVoiceProposal } from "../types";
import { emptyLoggerSet, isSetFilled, type LoggerExercise, type LoggerSet } from "./logger";

export type ProposedEntry = NonNullable<TrainerVoiceProposal["entries"]>[number];
export type ProposedAction = NonNullable<TrainerVoiceProposal["actions"]>[number];

/** Rows the form shows for an exercise: the sets logged so far, or as many empty rows as the plan
 *  has sets (the plan's numbers are the placeholders, never pre-filled as if they were done). */
export function formRows(exercise: LoggerExercise): LoggerSet[] {
  const done = exercise.setsDone ?? [];
  if (done.length) return done;
  return Array.from({ length: Math.max(1, exercise.sets || 1) }, () => emptyLoggerSet(exercise.metric));
}

const metricOf = (sets: ProposedEntry["sets"]): LoggerExercise["metric"] =>
  sets.some((s) => s.meters) ? "distance" : sets.some((s) => s.seconds) && sets.every((s) => !s.reps) ? "time" : "reps";

const toSet = (s: ProposedEntry["sets"][number]): LoggerSet => ({
  weight: s.weight, reps: s.reps, ...(s.seconds ? { seconds: s.seconds } : {}), ...(s.meters ? { meters: s.meters } : {}),
});

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Put a voice proposal into the form: an exercise already in it (by name, or the plan name it
 *  stands in for) gets the spoken sets in place of its own; a new one is added at the end. */
export function mergeProposalEntries(exercises: LoggerExercise[], entries: ProposedEntry[]): LoggerExercise[] {
  const out = exercises.map((e) => ({ ...e }));
  let next = Math.max(-1, ...out.map((e) => e.index)) + 1;
  for (const entry of entries) {
    const sets = entry.sets.map(toSet);
    if (!sets.length) continue;
    const at = out.findIndex((e) => sameName(e.name, entry.name) || (e.planName !== undefined && sameName(e.planName, entry.name)));
    if (at >= 0) {
      out[at] = { ...out[at], setsDone: sets, sets: Math.max(out[at].sets || 1, sets.length), ...(entry.rpe !== undefined ? { rpe: entry.rpe } : {}) };
    } else {
      out.push({ index: next++, name: entry.name, metric: metricOf(entry.sets), sets: sets.length, setsDone: sets, ...(entry.rpe !== undefined ? { rpe: entry.rpe } : {}) });
    }
  }
  return out;
}

/** Change one cell of the form. A row past the logged ones grows the list up to it. */
export function setCell(exercise: LoggerExercise, row: number, field: "weight" | "reps" | "seconds" | "meters", value: number): LoggerExercise {
  const rows = formRows(exercise).map((s) => ({ ...s }));
  while (rows.length <= row) rows.push(emptyLoggerSet(exercise.metric));
  rows[row] = { ...rows[row], [field]: Number.isFinite(value) && value >= 0 ? value : 0 };
  return { ...exercise, setsDone: rows, sets: Math.max(exercise.sets || 1, rows.length) };
}

export function addRow(exercise: LoggerExercise): LoggerExercise {
  const rows = [...formRows(exercise), emptyLoggerSet(exercise.metric)];
  return { ...exercise, setsDone: rows, sets: Math.max(exercise.sets || 1, rows.length) };
}

/** A new exercise the trainer typed or picked in the catalog search. */
export function addExercise(exercises: LoggerExercise[], name: string): LoggerExercise[] {
  const clean = name.trim();
  if (!clean || exercises.some((e) => sameName(e.name, clean))) return exercises;
  const index = Math.max(-1, ...exercises.map((e) => e.index)) + 1;
  return [...exercises, { index, name: clean, metric: "reps", sets: 1, setsDone: [emptyLoggerSet("reps")] }];
}

/** The save body: only exercises with a filled set, only the filled sets. */
export function trainerSaveEntries(exercises: LoggerExercise[]): Array<{ name: string; sets: LoggerSet[]; rpe?: number; planName?: string }> {
  return exercises.flatMap((e) => {
    const sets = (e.setsDone ?? []).filter(isSetFilled);
    return sets.length ? [{ name: e.name, sets, ...(e.rpe !== undefined ? { rpe: e.rpe } : {}), ...(e.planName ? { planName: e.planName } : {}) }] : [];
  });
}

const PLAN_ACTION: Record<string, "weight" | "sets" | "del" | "swap" | "add"> = { weight: "weight", sets: "sets", delete: "del", swap: "swap", add: "add" };

/** One coach/voice plan action as the plan editor's POST /api/v2/plan body, or null when the editor
 *  cannot apply it. `clientId` edits the client's plan (trainers); omit it for one's own. Shared by
 *  the coach chat and the trainer's voice proposal. */
export function actionToPlanEditBody(
  a: { kind: string; weekday?: number; index?: number; exercise?: string; value?: string; target?: string },
  clientId?: number,
): { action: "weight" | "sets" | "del" | "swap" | "add"; weekday: number; index: number; value?: string; expectName?: string; clientId?: number } | null {
  const action = PLAN_ACTION[a.kind];
  if (!action || !a.weekday) return null;
  return {
    action,
    weekday: a.weekday,
    index: a.index ?? -1,
    value: a.kind === "swap" || a.kind === "add" ? a.exercise : a.value,
    ...(a.target ? { expectName: a.target } : {}),
    ...(clientId ? { clientId } : {}),
  };
}
