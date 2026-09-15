// Domain-rule checks on a PlanDoc, run just before it's persisted (setActivePlan/saveDraftPlan).
// Pure: takes pre-fetched context so it's unit-testable without D1. Complements plan-schema.ts
// (shape validation) with rules that need cross-referencing other data — the catalog and active
// injuries — and can't be expressed as a zod shape. Scoped to structural corruption that's
// invalid for ANY plan regardless of who authored it (AI, trainer, bank adapt) — AI-specific
// quality gates like a minimum exercise count live on the generation path instead (see
// MIN_EXERCISES_PER_DAY below). Equipment matching needs a structured lookup this repo doesn't
// have yet (user equipment is free text, PlanExercise isn't reliably catalog-grounded) and is
// left to the safety layer (item 7 of the roadmap).
import type { InjurySwap, PlanDoc, UserProfile } from "../types";

export type LintSeverity = "critical" | "warning";

export interface LintIssue {
  severity: LintSeverity;
  code: string;
  message: string;
  weekday?: number;
  exerciseName?: string;
}

export interface LintContext {
  /** Catalog exercise ids known to exist, for validating grounded exercises (exerciseId set).
   * Ungrounded AI exercises (no exerciseId) are not checked against the catalog — that's the
   * expected, valid case for free-text AI programming. */
  knownCatalogIds: Set<string>;
  /** Swaps from this user's currently-active injuries — an exercise reappearing here means the
   * new plan re-introduces something that was pulled for an unresolved injury. */
  activeInjurySwaps: InjurySwap[];
}

// A valid AI-GENERATED training day must carry a full session — this is a quality gate on the
// AI generation path specifically (bot/plan.ts's aiJSON `validate` callback +
// healPlanIfDegenerate), not a general plan_lint rule: trainer-authored plans, shared/bank
// plans and single-exercise draft edits are legitimately allowed a lighter day, so lintPlan
// below does not enforce this for every save.
export const MIN_EXERCISES_PER_DAY = 5;

/** Short or endurance-focused sessions legitimately need fewer exercise slots than a normal
 * strength session. Keep the generation gate aligned with the prompt instead of rejecting a
 * valid 25-minute or endurance plan as if it were the old one-exercise degeneration bug. */
export function exerciseCountLimits(profile: Pick<UserProfile, "goal" | "sessionMinutes">): { min: number; max: number } {
  const goal = (profile.goal ?? "").toLowerCase();
  const endurance = /endurance|running|cycling|swimming|triathlon|marathon|5k|10k/.test(goal);
  if (endurance || (profile.sessionMinutes ?? 999) <= 30) return { min: 3, max: 4 };
  if ((profile.sessionMinutes ?? 999) <= 45) return { min: 4, max: 5 };
  return { min: MIN_EXERCISES_PER_DAY, max: 6 };
}

// A bug/corruption trap, not dietetic guidance: no legitimate adult nutrition target is ever
// this low, regardless of sex/bodyweight/deficit aggressiveness. Catches a unit mix-up or a
// truncated/malformed AI response before it reaches a user, without asserting a specific
// clinical minimum (which depends on context this function doesn't have).
export const MIN_PLAUSIBLE_CALORIES = 800;

function normalizedExerciseKey(name: string, canonicalName?: string): string {
  return (canonicalName || name).trim().toLowerCase();
}

export function lintPlan(plan: PlanDoc, ctx: LintContext): LintIssue[] {
  const issues: LintIssue[] = [];

  if (plan.split.length === 0) {
    issues.push({ severity: "critical", code: "empty_split", message: "Plan has no training days" });
  }

  const injuredKeys = new Set(ctx.activeInjurySwaps.map((s) => normalizedExerciseKey(s.original.name, s.original.canonicalName)));

  for (const day of plan.split) {
    const seen = new Set<string>();
    for (const ex of day.exercises) {
      const key = normalizedExerciseKey(ex.name, ex.canonicalName);

      if (seen.has(key)) {
        issues.push({
          severity: "critical",
          code: "duplicate_exercise",
          message: `Duplicate exercise "${ex.name}" on day ${day.weekday}`,
          weekday: day.weekday,
          exerciseName: ex.name,
        });
      }
      seen.add(key);

      if (ex.exerciseId && !ctx.knownCatalogIds.has(ex.exerciseId)) {
        issues.push({
          severity: "critical",
          code: "unknown_catalog_id",
          message: `Exercise "${ex.name}" references unknown catalog id ${ex.exerciseId}`,
          weekday: day.weekday,
          exerciseName: ex.name,
        });
      }

      if (injuredKeys.has(key)) {
        issues.push({
          severity: "warning",
          code: "injury_conflict",
          message: `"${ex.name}" was previously swapped out for an active injury and reappears in this plan`,
          weekday: day.weekday,
          exerciseName: ex.name,
        });
      }
    }
  }

  if (!Number.isFinite(plan.nutrition.calories) || plan.nutrition.calories <= 0) {
    issues.push({ severity: "critical", code: "invalid_nutrition", message: "Plan calories must be a positive number" });
  } else if (plan.nutrition.calories < MIN_PLAUSIBLE_CALORIES) {
    // Not a clinical minimum (that depends on sex/bodyweight/context this function doesn't have)
    // — a bug/corruption trap. No legitimate adult target is ever this low; this catches things
    // like a unit mix-up or a truncated AI response, not borderline-aggressive cuts.
    issues.push({
      severity: "critical",
      code: "implausible_calories",
      message: `Plan calories (${plan.nutrition.calories}) is below the ${MIN_PLAUSIBLE_CALORIES} kcal/day sanity floor`,
    });
  }
  for (const [field, value] of Object.entries({
    protein: plan.nutrition.protein,
    fats: plan.nutrition.fats,
    carbs: plan.nutrition.carbs,
  })) {
    if (!Number.isFinite(value) || value < 0) {
      issues.push({ severity: "critical", code: "invalid_nutrition", message: `Plan nutrition.${field} must be a non-negative number` });
    }
  }

  return issues;
}

export function hasCriticalIssues(issues: LintIssue[]): boolean {
  return issues.some((i) => i.severity === "critical");
}
