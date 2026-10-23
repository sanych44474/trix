// The one plan-edit module. Every change to an owner's active plan, from the Mini App API or the
// Telegram bot, goes through applyPlanEdit: it validates the edit, enforces the caps, rounds
// weights, writes the split, keeps training weekdays in step with the day list, translates new
// exercises, checks the plan version and appends the plan-history row. Callers only translate
// user input into a PlanEdit and render the result.
import { FREE_EXERCISE_IDS } from "../../domain/data/freeExerciseIds";
import { updateActivePlanSplit } from "../../adapters/d1/v2Plans";
import { recordPlanChange, type PlanChangeSource } from "../../adapters/d1/v2PlanHistory";
import {
  getCatalogExercise,
  getExerciseTranslation,
  getExerciseTranslations,
  listCandidatesByMuscles,
  setUserVideo,
} from "../../adapters/d1/v2Catalog";
import { updateUser } from "../../adapters/d1/v2Users";
import { awardAchievement } from "../../adapters/d1/v2Gamification";
import { fitSplitToKit, kitFromEquipment } from "../../domain/equipmentFit";
import { swapPlanDays } from "../../domain/recoverySwap";
import { DAY_GROUPS } from "../../domain/dayGroups";
import { t } from "../../locales/i18n";
import { exerciseVideoKey, weekdayName } from "../../render";
import { parseYouTubeId } from "../../youtube";
import { pickDayDifficulty } from "./difficulty";
import { translatePlanExercises } from "./planBuild";
import type { Env, Lang, PlanDay, PlanDoc, PlanExercise, UserDoc, Weekday } from "../../types";
import type { DB } from "../../adapters/d1/shared";

export const MAX_EX_PER_DAY = 12;
/** Weights keep what the user typed, rounded only to this step (plates are the calculator's job). */
export const WEIGHT_STEP_KG = 0.5;
const NOTE_MAX = 300;
const TECHNIQUE_MAX = 1000;
const EQUIPMENT = ["full gym", "home basics (dumbbells, bands)", "dumbbells only", "bodyweight only"];
const FREE_EXERCISE_ID_SET = new Set<string>(FREE_EXERCISE_IDS);

export type PlanEditErrorCode = "bad request" | "not found" | "stale" | "full" | "conflict" | "last";

/** Thrown for an edit the plan cannot take. `code` maps to the HTTP status via planEditStatus. */
export class PlanEditError extends Error {
  constructor(readonly code: PlanEditErrorCode) {
    super(code);
  }
}

const STATUS: Record<PlanEditErrorCode, number> = {
  "bad request": 400,
  "not found": 404,
  stale: 409,
  full: 400,
  conflict: 409,
  last: 400,
};
export function planEditStatus(code: PlanEditErrorCode): number {
  return STATUS[code];
}

/** Day-scoped address of one exercise. `index` may be NaN when the caller sends only `expectName`. */
interface Slot {
  weekday: number;
  index: number;
  expectName?: string;
}

/** A named edit. Caller-supplied `catalogId`/`freeExerciseId` are resolved here; `overrides` win over
 *  the resolved fields (the bot's own default sets/weights for a catalog swap). */
export type PlanEdit =
  | ({ kind: "weight" | "sets" | "wmode" | "video" | "note" | "technique"; value: string } & Slot)
  | ({ kind: "link" | "del" } & Slot)
  | ({ kind: "move"; dir: "up" | "down" } & Slot)
  | ({ kind: "swap"; name: string; catalogId?: string; freeExerciseId?: string; overrides?: Partial<PlanExercise> } & Slot)
  | { kind: "add"; weekday: number; name: string; catalogId?: string; freeExerciseId?: string; overrides?: Partial<PlanExercise> }
  | { kind: "restore"; weekday: number; index: number; exercise: PlanExercise }
  | { kind: "replace"; summary: string; changes: Array<{ weekday: number; index: number; exercise: PlanExercise }> }
  | { kind: "dayadd"; weekday: number; group: string }
  | { kind: "daydel"; weekday: number }
  | { kind: "dayswap"; weekday: number; other: number }
  | { kind: "difficulty"; weekday: number; dir: "up" | "down" }
  | { kind: "fitkit"; equipment?: string };

export interface PlanEditTarget {
  env: Env;
  /** The plan owner (self, or the client a trainer is editing). Mutated: profile follows day sync. */
  owner: UserDoc;
  actorId: number;
  plan: Pick<PlanDoc, "split" | "generatedAt">;
  /** Defaults to "manual" for the owner, "trainer" for anyone else. */
  source?: PlanChangeSource;
  /** Optimistic concurrency: the plan version the caller last saw (ISO generatedAt). */
  expectedVersion?: string;
}

export interface PlanEditResult {
  split: PlanDay[];
  /** One-line history summary; empty when the edit was a no-op and nothing was recorded. */
  summary: string;
  /** Number of exercises swapped (difficulty, fitkit); 0 otherwise. */
  swapped: number;
  /** Per-exercise detail of a fitkit edit, for the bot's reply. */
  fit?: Pick<ReturnType<typeof fitSplitToKit>, "swaps" | "dropped">;
}

/** True when no version was sent, or it is the plan's current version. */
export function planVersionMatches(plan: Pick<PlanDoc, "generatedAt">, expected?: string): boolean {
  return !expected || expected === plan.generatedAt.toISOString();
}

function changeSummary(kind: string, before: string, after: PlanExercise | undefined): string {
  if (kind === "weight") return `weight: ${before} -> ${after?.startWeight ?? "?"}`;
  if (kind === "sets") return `sets: ${before} -> ${after?.sets ?? "?"}`;
  if (kind === "wmode") return `weight mode: ${before} -> ${after?.weightMode ?? "total"}`;
  if (kind === "video") return `video: ${before}`;
  if (kind === "note") return after?.note ? `comment: ${before}` : `comment removed: ${before}`;
  if (kind === "technique") return `technique: ${before}`;
  if (kind === "link") return `superset: ${before}`;
  if (kind === "del") return `removed: ${before}`;
  if (kind === "move") return `reordered: ${before}`;
  if (kind === "swap") return `swap: ${before} -> ${after?.name ?? "?"}`;
  if (kind === "add" || kind === "restore") return `added: ${after?.name ?? "?"}`;
  return kind;
}

function badRequest(): never {
  throw new PlanEditError("bad request");
}

/** Resolve the exercise a slot edit addresses; the name guard catches a plan that shifted under the caller. */
function slotOf(split: PlanDay[], edit: Slot): { day: PlanDay; index: number; ex: PlanExercise } {
  const day = split.find((d) => d.weekday === edit.weekday);
  if (!day) badRequest();
  // The logger's "overwrite the plan" sends the exercise's name, not a position: its list can be
  // reordered, so a name is the reliable reference there.
  const byName = typeof edit.expectName === "string" && !(edit.index >= 0) ? day.exercises.findIndex((e) => e.name === edit.expectName) : -1;
  const index = byName >= 0 ? byName : edit.index;
  const ex = day.exercises[index];
  if (!ex) badRequest();
  if (typeof edit.expectName === "string" && edit.expectName !== ex.name) throw new PlanEditError("stale");
  return { day, index, ex };
}

/** Catalog/free-library resolution shared by swap and add (the Mini App's picker and the bot's catalog). */
async function resolveExercise(
  db: DB,
  lang: Lang,
  edit: { name: string; catalogId?: string; freeExerciseId?: string },
): Promise<{ base: Partial<PlanExercise>; translated: boolean }> {
  const name = edit.name.trim().slice(0, 80);
  if (name.length < 2) badRequest();
  const cat = edit.catalogId ? await getCatalogExercise(db, edit.catalogId).catch(() => null) : null;
  // Picked from the Mini App's exercise library (free-exercise-db): keep its English name as the
  // canonical one (technique pictures match it exactly) and reuse the cached translated steps.
  const libId = typeof edit.freeExerciseId === "string" && FREE_EXERCISE_ID_SET.has(edit.freeExerciseId) ? edit.freeExerciseId : undefined;
  const libSteps = libId
    ? await db.prepare("SELECT steps FROM v2_technique_steps WHERE exerciseId = ? AND lang = ?").bind(libId, lang === "en" ? "en" : "uk").first<{ steps: string }>().catch(() => null)
    : null;
  let localName = cat?.name ?? name;
  let translated = lang === "en" || !cat;
  if (cat && lang !== "en") {
    const tr = await getExerciseTranslation(db, cat.id, lang).catch(() => null);
    if (tr?.name) {
      localName = tr.name;
      translated = true;
    }
  }
  return {
    translated,
    base: {
      name: cat ? localName : name,
      technique: cat?.instructions ?? (libSteps ? (JSON.parse(libSteps.steps) as string[]).join(" ") : ""),
      ...(cat ? { exerciseId: cat.id, canonicalName: cat.name, muscles: cat.muscle } : {}),
      ...(!cat && libId ? { canonicalName: libId.replace(/_/g, " ") } : {}),
    },
  };
}

/** Translate the split through the AI only when a new exercise has no catalog translation. */
async function localizeIfNeeded(env: Env, lang: Lang, split: PlanDay[], db: DB, actorId: number, translated: boolean): Promise<PlanDay[]> {
  if (lang === "en" || translated) return split;
  return translatePlanExercises(env, lang, split, db, actorId);
}

/** Apply one named edit to the owner's active plan and persist it. Throws PlanEditError on refusal. */
export async function applyPlanEdit(target: PlanEditTarget, edit: PlanEdit): Promise<PlanEditResult> {
  const { env, owner, plan } = target;
  const db = env.DB;
  const lang = owner.lang;
  const source: PlanChangeSource = target.source ?? (target.actorId === owner._id ? "manual" : "trainer");
  if (!planVersionMatches(plan, target.expectedVersion)) throw new PlanEditError("stale");

  // Work on a copy: a refused edit must leave the stored split untouched.
  let split: PlanDay[] = structuredClone(plan.split) as PlanDay[];
  let summary = "";
  let splitChanged = true;
  let swapped = 0;
  let fit: PlanEditResult["fit"];

  switch (edit.kind) {
    case "weight": {
      const { ex } = slotOf(split, edit);
      const before = ex.name;
      const raw = String(edit.value ?? "").trim();
      const kg = parseFloat(raw.replace(",", ".").replace(/[^\d.]/g, ""));
      ex.startWeight = Number.isFinite(kg) && kg > 0 && kg <= 1000
        ? `${Math.round(kg / WEIGHT_STEP_KG) * WEIGHT_STEP_KG} kg`
        : raw.slice(0, 24) || ex.startWeight;
      summary = changeSummary("weight", before, ex);
      break;
    }
    case "wmode": {
      const { ex } = slotOf(split, edit);
      const v = String(edit.value ?? "");
      ex.weightMode = v === "perSide" || v === "perHand" ? v : undefined;
      summary = changeSummary("wmode", ex.name, ex);
      break;
    }
    case "sets": {
      const { ex } = slotOf(split, edit);
      const norm = String(edit.value ?? "").trim().replace(/\s+/g, " ").replace(/[xх*]/gi, "×");
      if (!/^\d+\s*×\s*\d+(?:\s*[-–]\s*\d+)?$/.test(norm)) badRequest();
      const before = ex.name;
      ex.sets = norm.replace(/\s*×\s*/g, " × ");
      summary = changeSummary("sets", before, ex);
      break;
    }
    case "video": {
      // Personal video override for this exercise: the plan OWNER's override, so a trainer setting
      // it for a client changes what the client sees. The split itself is not rewritten.
      const { ex } = slotOf(split, edit);
      const videoId = parseYouTubeId(String(edit.value ?? "").trim());
      if (!videoId) badRequest();
      await setUserVideo(db, owner._id, exerciseVideoKey(ex), ex.name, { videoId, url: `https://youtu.be/${videoId}` });
      summary = changeSummary("video", ex.name, ex);
      splitChanged = false;
      break;
    }
    case "note": {
      const { ex } = slotOf(split, edit);
      const note = String(edit.value ?? "").replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
      if (note) ex.note = note;
      else delete ex.note;
      summary = changeSummary("note", ex.name, ex);
      break;
    }
    case "technique": {
      const { ex } = slotOf(split, edit);
      const technique = String(edit.value ?? "").trim().slice(0, TECHNIQUE_MAX);
      if (!technique) badRequest();
      ex.technique = technique;
      summary = changeSummary("technique", ex.name, ex);
      break;
    }
    case "link": {
      const { day, index, ex } = slotOf(split, edit);
      if (index >= day.exercises.length - 1) badRequest();
      const next = day.exercises[index + 1];
      if (ex.supersetGroup && ex.supersetGroup === next.supersetGroup) {
        // unlink: drop this exercise from the group; dissolve a group left with one member
        const g = ex.supersetGroup;
        delete ex.supersetGroup;
        const left = day.exercises.filter((e2) => e2.supersetGroup === g);
        if (left.length === 1) delete left[0].supersetGroup;
      } else if (next.supersetGroup) {
        ex.supersetGroup = next.supersetGroup;
      } else if (ex.supersetGroup) {
        next.supersetGroup = ex.supersetGroup;
      } else {
        const used = new Set(day.exercises.map((e2) => e2.supersetGroup).filter(Boolean));
        const letter = "ABCDEFGH".split("").find((c) => !used.has(c)) ?? "A";
        ex.supersetGroup = letter;
        next.supersetGroup = letter;
      }
      summary = changeSummary("link", ex.name, ex);
      break;
    }
    case "del": {
      const { day, index, ex } = slotOf(split, edit);
      if (day.exercises.length <= 1) throw new PlanEditError("last");
      day.exercises.splice(index, 1);
      summary = changeSummary("del", ex.name, undefined);
      break;
    }
    case "move": {
      const { day, index, ex } = slotOf(split, edit);
      const j = edit.dir === "up" ? index - 1 : index + 1;
      if (j < 0 || j >= day.exercises.length) {
        // no-op at the edge: nothing persisted, nothing recorded
        splitChanged = false;
        break;
      }
      [day.exercises[index], day.exercises[j]] = [day.exercises[j], day.exercises[index]];
      summary = changeSummary("move", ex.name, undefined);
      break;
    }
    case "swap": {
      const { ex, index, day } = slotOf(split, edit);
      const before = ex.name;
      const { base, translated } = await resolveExercise(db, lang, edit);
      // A swap keeps the slot's rep scheme, load and key-lift flag; everything else comes from the new exercise.
      day.exercises[index] = { ...base, sets: ex.sets, startWeight: ex.startWeight || "—", isKeyLift: ex.isKeyLift, ...edit.overrides } as PlanExercise;
      split = await localizeIfNeeded(env, lang, split, db, target.actorId, translated);
      summary = changeSummary("swap", before, split.find((d) => d.weekday === edit.weekday)?.exercises[index]);
      break;
    }
    case "add": {
      const day = split.find((d) => d.weekday === edit.weekday);
      if (!day) badRequest();
      if (day.exercises.length >= MAX_EX_PER_DAY) throw new PlanEditError("full");
      const { base, translated } = await resolveExercise(db, lang, edit);
      const built: PlanExercise = { sets: "3 × 8–12", startWeight: "—", ...base, ...edit.overrides } as PlanExercise;
      if (typeof edit.freeExerciseId === "string" && FREE_EXERCISE_ID_SET.has(edit.freeExerciseId) && target.actorId === owner._id) {
        await awardAchievement(db, owner._id, "library_first").catch(() => {});
      }
      day.exercises.push(built);
      split = await localizeIfNeeded(env, lang, split, db, target.actorId, translated);
      summary = changeSummary("add", "", built);
      break;
    }
    case "restore": {
      // Undo of a delete: put the exercise back where it was (the one-tap undo in the bot).
      const day = split.find((d) => d.weekday === edit.weekday);
      if (!day) badRequest();
      if (day.exercises.length >= MAX_EX_PER_DAY) throw new PlanEditError("full");
      day.exercises.splice(Math.min(edit.index, day.exercises.length), 0, edit.exercise);
      summary = changeSummary("restore", "", edit.exercise);
      break;
    }
    case "replace": {
      // Several slots replaced by one named action (an injury swap or its recovery restore).
      for (const c of edit.changes) {
        const day = split.find((d) => d.weekday === c.weekday);
        if (!day || !day.exercises[c.index]) badRequest();
        day.exercises[c.index] = c.exercise;
      }
      summary = edit.summary;
      break;
    }
    case "dayadd": {
      const wd = Number(edit.weekday);
      if (!Number.isInteger(wd) || wd < 1 || wd > 7) badRequest();
      if (split.length >= 7) throw new PlanEditError("full");
      if (split.some((d) => d.weekday === wd)) throw new PlanEditError("conflict");
      const group = DAY_GROUPS.find((g) => g.id === String(edit.group ?? ""));
      if (!group) badRequest();
      // Auto-fill from the catalog so the new day is usable immediately; the user then tweaks it.
      const candidates = await listCandidatesByMuscles(db, group.muscles, { level: owner.profile.level, perMuscle: 2, total: 5 }).catch(() => []);
      // The catalog is English; the day is written in the owner's language where a translation exists.
      const translatedNames = lang === "en" ? new Map() : await getExerciseTranslations(db, candidates.map((c) => c.id), lang).catch(() => new Map());
      const exercises: PlanExercise[] = candidates.map((c) => ({
        name: translatedNames.get(c.id)?.name || c.name,
        canonicalName: c.name,
        exerciseId: c.id,
        sets: "3 × 8–12",
        startWeight: "—",
        technique: translatedNames.get(c.id)?.instructions || c.instructions || "",
        muscles: c.muscle,
      }));
      const label = t(lang, `pday_g_${group.id}` as Parameters<typeof t>[1]);
      split.push({ weekday: wd as Weekday, muscleGroup: label, exercises });
      split.sort((a, b) => a.weekday - b.weekday);
      const untranslated = lang !== "en" && candidates.some((c) => !translatedNames.get(c.id)?.name);
      split = await localizeIfNeeded(env, lang, split, db, target.actorId, !untranslated);
      summary = `added day: ${weekdayName(lang, wd as Weekday)}`;
      break;
    }
    case "daydel": {
      const wd = Number(edit.weekday);
      if (!Number.isInteger(wd) || wd < 1 || wd > 7) badRequest();
      // Same guard as the bot: a plan with no training days at all is not a plan.
      if (split.length <= 1) throw new PlanEditError("last");
      if (!split.some((d) => d.weekday === wd)) throw new PlanEditError("not found");
      split = split.filter((d) => d.weekday !== wd);
      summary = `removed day: ${weekdayName(lang, wd as Weekday)}`;
      break;
    }
    case "dayswap": {
      const a = Number(edit.weekday);
      const b = Number(edit.other);
      const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= 7;
      if (!valid(a) || !valid(b)) badRequest();
      const swappedSplit = swapPlanDays(split, a as Weekday, b as Weekday);
      if (!swappedSplit) throw new PlanEditError("not found");
      split = swappedSplit;
      summary = `swapped days: ${weekdayName(lang, a as Weekday)} ↔ ${weekdayName(lang, b as Weekday)}`;
      break;
    }
    case "difficulty": {
      const wd = Number(edit.weekday);
      if (!Number.isInteger(wd) || wd < 1 || wd > 7 || (edit.dir !== "up" && edit.dir !== "down")) badRequest();
      const picked = await pickDayDifficulty(db, { split, weekday: wd, direction: edit.dir });
      if (!picked) throw new PlanEditError("not found");
      swapped = picked.swappedCount;
      if (swapped === 0) {
        splitChanged = false;
        break;
      }
      split = await localizeIfNeeded(env, lang, picked.split, db, target.actorId, false);
      summary = `difficulty: ${weekdayName(lang, wd as Weekday)} ${edit.dir} (${swapped} swapped)`;
      break;
    }
    case "fitkit": {
      // Optionally change the owner's equipment first, then fit every exercise to it.
      if (typeof edit.equipment === "string" && EQUIPMENT.includes(edit.equipment) && edit.equipment !== owner.profile.equipment) {
        owner.profile = { ...owner.profile, equipment: edit.equipment };
        await updateUser(db, owner._id, { profile: owner.profile });
      }
      const fitted = fitSplitToKit(split, kitFromEquipment(owner.profile.equipment), lang === "en" ? "en" : "uk");
      swapped = fitted.swaps.length + fitted.dropped.length;
      fit = { swaps: fitted.swaps, dropped: fitted.dropped };
      split = fitted.split;
      if (swapped === 0) {
        splitChanged = false;
        break;
      }
      summary = `fitted to equipment: ${fitted.swaps.length} swapped, ${fitted.dropped.length} removed`;
      break;
    }
  }

  if (splitChanged) await updateActivePlanSplit(db, owner._id, split);

  // Day add/remove keeps the owner's reminder/calendar weekdays in step with the plan's real days.
  // NOT best-effort: if this fails the plan and the reminder schedule disagree, which is a silent,
  // user-visible wrong (a nudge on a rest day, or none on a training day).
  if (edit.kind === "dayadd" || edit.kind === "daydel") {
    const weekdays = [...new Set(split.map((d) => d.weekday))].sort((x, y) => x - y) as Weekday[];
    const profile = { ...owner.profile, trainingWeekdays: weekdays, daysPerWeek: weekdays.length };
    await updateUser(db, owner._id, { profile });
    owner.profile = profile;
  }

  // Audit row: best-effort, a failed write must not fail an edit the user already saw succeed.
  if (summary) await recordPlanChange(db, owner._id, source, summary).catch(() => {});
  return { split, summary, swapped, ...(fit ? { fit } : {}) };
}
