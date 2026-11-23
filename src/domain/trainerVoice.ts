// A trainer's spoken (or typed) command about a client, turned into a PROPOSAL the trainer confirms:
// either workout entries for the client's log or edits to the client's plan (ADR-0018). Nothing here
// applies anything. Pure; test/trainer-voice.test.ts.
//
// Plain set dictation ("жим 80 на 6, 80 на 5") is parsed without the AI; anything else (plan edits,
// loose phrasing) goes to the model, whose answer is validated here before it reaches the trainer.
import { z } from "zod";
import { validateCoachActions, type CoachAction } from "./coachActions";
import { normalizeExercise, parseWorkoutText } from "./workoutText";

/** Words that mean "change the plan", not "log what was done". Their presence sends the text to the
 * AI even when it also contains numbers ("заміни жим на 80 х 6" is an edit, not a set). */
export const PLAN_CUE =
  /\b(?:plan|replace|swap|remove|delete|add to)\b|план|замін|замен|поміня|поменя|видал|удали|прибер|убер|додай|добав/iu;

interface ProposedSet { weight: number; reps: number; seconds?: number; meters?: number }
export interface ProposedEntry { name: string; sets: ProposedSet[]; rpe?: number }

/** Spoken numbers as the parser reads them: "80 кг на 6" / "80 by 6" / "80 по 6" become "80x6". */
export function normalizeSpokenSets(text: string): string {
  return text
    .replace(/(\d)\s*(?:кг|kg|кілограм\p{L}*|килограмм\p{L}*)/giu, "$1")
    .replace(/(\d)\s+(?:на|by|по|times)\s+(\d)/giu, "$1x$2");
}

/** Group parsed sets into entries by exercise, in the order they were said. */
function groupEntries(sets: ReturnType<typeof parseWorkoutText>, candidates: string[]): ProposedEntry[] {
  const out: ProposedEntry[] = [];
  for (const s of sets) {
    const name = normalizeExercise(s.exercise, candidates);
    let entry = out.find((e) => e.name === name);
    if (!entry) {
      entry = { name, sets: [] };
      out.push(entry);
    }
    entry.sets.push({ weight: s.weight, reps: s.reps, ...(s.seconds ? { seconds: s.seconds } : {}), ...(s.meters ? { meters: s.meters } : {}) });
    if (s.rpe !== undefined) entry.rpe = s.rpe;
  }
  return out;
}

/** The no-AI proposal: every non-empty line must parse into sets under a named exercise, and the text
 * must not ask for a plan change. Anything less returns null and the AI decides. `candidates` are the
 * client's plan and recently logged names, so "жим" lands on the exercise the plan already has. */
export function quickWorkoutProposal(text: string, candidates: string[]): ProposedEntry[] | null {
  if (PLAN_CUE.test(text)) return null;
  const lines = normalizeSpokenSets(text).split(/[\n;]+/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const all: ReturnType<typeof parseWorkoutText> = [];
  for (const line of lines) {
    const sets = parseWorkoutText(line);
    if (!sets.length || sets.some((s) => s.exercise === "exercise")) return null; // a line with no sets, or sets with no name
    all.push(...sets);
  }
  const entries = groupEntries(all, candidates);
  return entries.length ? entries : null;
}

const setSchema = z.object({
  weight: z.number().min(0).max(1000),
  reps: z.number().int().min(0).max(1000),
  seconds: z.number().min(1).max(86_400).optional(),
  meters: z.number().min(1).max(200_000).optional(),
});
const entrySchema = z.object({
  name: z.string().refine((v) => v.trim().length > 0, "name must not be blank").max(80),
  sets: z.array(setSchema).min(1).max(20),
  rpe: z.number().min(0).max(10).optional(),
});
const resultSchema = z.object({
  kind: z.enum(["workout", "plan", "none"]),
  reply: z.string().refine((v) => v.trim().length > 0, "reply must not be blank").max(1000),
  entries: z.array(entrySchema).max(30).optional(),
  actions: z.array(z.unknown()).max(4).optional(),
});

export interface TrainerVoiceResult {
  kind: "workout" | "plan" | "none";
  reply: string;
  entries?: ProposedEntry[];
  actions?: CoachAction[];
}

/** Validate the model's answer; a throw makes the AI layer try the next provider. A "workout" answer
 * must carry entries and a "plan" answer actions, so the trainer is never shown an empty proposal. */
export function validateTrainerVoiceResult(raw: unknown): void {
  const r = resultSchema.safeParse(raw);
  if (!r.success) throw new Error(`trainer voice output is invalid: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "result"}: ${i.message}`).join("; ")}`);
  if (r.data.kind === "workout" && !r.data.entries?.length) throw new Error("trainer voice output: workout without entries");
  if (r.data.kind === "plan") {
    if (!r.data.actions?.length) throw new Error("trainer voice output: plan without actions");
    validateCoachActions(r.data.actions);
  }
}

/** Entries from the model, with names matched to the client's own and sets cleaned the way a save is. */
export function normalizeVoiceEntries(entries: ProposedEntry[], candidates: string[]): ProposedEntry[] {
  const out: ProposedEntry[] = [];
  for (const e of entries) {
    const sets = e.sets
      .filter((s) => s.reps > 0 || s.seconds || s.meters)
      .map((s) => ({ weight: s.weight, reps: Math.round(s.reps), ...(s.seconds ? { seconds: Math.round(s.seconds) } : {}), ...(s.meters ? { meters: Math.round(s.meters) } : {}) }));
    if (!sets.length) continue;
    out.push({ name: normalizeExercise(e.name.trim(), candidates), sets, ...(e.rpe !== undefined ? { rpe: e.rpe } : {}) });
  }
  return out;
}

const ORDER: Record<string, number> = { weight: 0, sets: 0, swap: 0, delete: 1, add: 2 };

/** The order to apply plan actions one at a time so an earlier one never shifts a later one's index:
 * edits that keep positions first, then deletes from the end of each day backwards, then adds. */
export function orderPlanActions<T extends { kind: string; weekday?: number; index?: number }>(actions: T[]): T[] {
  return actions
    .map((a, i) => ({ a, i }))
    .sort((x, y) => {
      const k = (ORDER[x.a.kind] ?? 3) - (ORDER[y.a.kind] ?? 3);
      if (k) return k;
      if (x.a.kind === "delete") return (x.a.weekday ?? 0) - (y.a.weekday ?? 0) || (y.a.index ?? 0) - (x.a.index ?? 0);
      return x.i - y.i;
    })
    .map((x) => x.a);
}
