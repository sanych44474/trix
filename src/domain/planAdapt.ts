import type { BankPlan, PlanDay, PlanDoc, PlanExercise, UserProfile, Weekday } from "../types";
import { computeTargets } from "./mealplan";

// Pure per-user adapter: turns a generic bank plan into a personalized PlanDoc — remaps the
// training days to the client's chosen weekdays, scales starting weights to their bodyweight
// and recent PRs, applies caller-resolved disliked-exercise swaps, and recomputes nutrition.
// No DB/AI: disliked swaps are resolved by the caller (which has catalog + translation access)
// and passed in as `replacements`.

// Reference bodyweight the bank's starting weights were authored for (per sex). A lighter or
// heavier client gets loads scaled proportionally, clamped to a sane band.
const REF_BODYWEIGHT = { male: 80, female: 65 };

function scaleWeight(startWeight: string, factor: number): string {
  const m = /^(\d+(?:\.\d+)?)\s*kg$/i.exec(startWeight.trim());
  if (!m) return startWeight; // "Bodyweight" / "Власна вага" / non-numeric → unchanged
  const scaled = Math.max(2.5, Math.round((parseFloat(m[1]) * factor) / 2.5) * 2.5);
  return `${scaled} kg`;
}

/** Parse the recentPRs blob ("Bench Press: 80x5\nSquat: BW x10") → lower-name → best weight kg. */
export function parsePrs(prs?: string): Map<string, number> {
  const map = new Map<string, number>();
  if (!prs) return map;
  for (const line of prs.split(/\n+/)) {
    const m = /^(.+?):\s*(BW|\d+(?:\.\d+)?)\s*x/i.exec(line.trim());
    if (!m) continue;
    const w = m[2].toUpperCase() === "BW" ? 0 : parseFloat(m[2]);
    if (w > 0) map.set(m[1].toLowerCase().trim(), w);
  }
  return map;
}

function prFor(ex: PlanExercise, prs: Map<string, number>): number | undefined {
  for (const [name, w] of prs) {
    const cn = (ex.canonicalName ?? "").toLowerCase();
    const n = ex.name.toLowerCase();
    if (cn === name || n === name || cn.includes(name) || n.includes(name)) return w;
  }
  return undefined;
}

export interface AdaptOpts {
  prs?: string;
  /** Disliked/contraindicated swaps resolved by the caller (EN+UK already attached). Keyed by
   * the lowercased original exercise name OR canonicalName. Only the movement fields
   * (name/technique/muscles/exerciseId/canonicalName) need be set — the original set scheme,
   * RPE and role are preserved. */
  replacements?: Map<string, Partial<PlanExercise>>;
  authoredBy?: number;
}

/** Adapt a bank plan to a specific user. Returns a ready-to-save PlanDoc. */
export function adaptPlan(
  bank: BankPlan,
  profile: UserProfile,
  forUserId: number,
  opts: AdaptOpts = {},
): PlanDoc {
  const ref = REF_BODYWEIGHT[profile.sex ?? "male"];
  const bwFactor = profile.weightKg ? Math.min(1.4, Math.max(0.6, profile.weightKg / ref)) : 1;
  const prs = parsePrs(opts.prs);
  const replacements = opts.replacements ?? new Map<string, Partial<PlanExercise>>();

  // Trim the split to the number of weekdays the client actually trains (a 6-day bank plan
  // for a 5-day-a-week client drops the last day). If they train more days than the plan has,
  // keep all plan days. Never trim below 1.
  const weekdays = (profile.trainingWeekdays ?? []).slice();
  const dayCount = weekdays.length ? Math.min(bank.split.length, Math.max(1, weekdays.length)) : bank.split.length;
  const split: PlanDay[] = bank.split.slice(0, dayCount).map((day, i) => {
    const weekday = (weekdays[i] ?? day.weekday) as Weekday;
    const exercises = day.exercises.map((ex) => {
      const repl = replacements.get((ex.canonicalName ?? "").toLowerCase()) ?? replacements.get(ex.name.toLowerCase());
      const base = repl ? { ...ex, ...repl } : ex;
      const pr = prFor(base, prs);
      const startWeight =
        pr !== undefined
          ? `${Math.max(2.5, Math.round((pr * 0.92) / 2.5) * 2.5)} kg` // start at ~92% of PR
          : scaleWeight(base.startWeight, bwFactor);
      return { ...base, startWeight };
    });
    return { ...day, weekday, exercises };
  });

  const nutrition = computeTargets(profile);
  // Rest-day macros: keep protein, trim carbs ~30% and calories ~12% (mirrors the AI plan rule).
  const restDayNutrition = {
    calories: Math.round((nutrition.calories * 0.88) / 10) * 10,
    protein: nutrition.protein,
    fats: Math.round(nutrition.fats * 0.95),
    carbs: Math.round(nutrition.carbs * 0.7),
  };

  return {
    userId: forUserId,
    active: false,
    status: "active",
    authoredBy: opts.authoredBy,
    split,
    nutrition,
    restDayNutrition,
    supplements: [],
    methodology: bank.methodology,
    ...(bank.movementAudit ? { movementAudit: bank.movementAudit } : {}),
    generatedAt: new Date(),
    ...(typeof bank.stepsTarget === "number" ? { stepsTarget: bank.stepsTarget } : {}),
  };
}
