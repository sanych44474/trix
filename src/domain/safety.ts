// AI safety gate: the concrete "AI proposes, domain logic decides" boundary for plan edits that
// change WHICH exercise a user does (add/swap). Every writer of the plan funnels through
// applyPlanEdit (features/plan/planEdits.ts): the athlete's editor, a trainer's, and the AI coach's
// actions. It calls checkExerciseAgainstInjuries before writing and refuses a direct conflict with
// 409 "injury:<area>". The in-session swap list (webapp/workout.ts workoutSwapAlternatives) leaves
// such exercises out. Pure: reuses domain/injury.ts's conflictScore rather than duplicating it.
import type { InjuryDoc } from "../types";
import { conflictScore, type ConflictLevel, type ExerciseLike, type InjuryArea, type Severity } from "./injury";

interface InjuryConflictResult {
  blocked: boolean;
  area?: InjuryArea;
  level?: ConflictLevel;
}

/** A DIRECT conflict with any active injury blocks the edit; RELATED conflicts are allowed
 * through (the user/coach may have a good reason) but callers can still surface them as a
 * caution. Only the first direct conflict found is reported — one reason is enough to block. */
export function checkExerciseAgainstInjuries(exercise: ExerciseLike, activeInjuries: InjuryDoc[]): InjuryConflictResult {
  for (const inj of activeInjuries) {
    const level = conflictScore(exercise, inj.area as InjuryArea);
    if (level === "direct") {
      return { blocked: true, area: inj.area as InjuryArea, level };
    }
  }
  return { blocked: false };
}

/** A freshly-reported STRONG injury warrants a professional-care nudge at report time, not just
 * after a follow-up pain score (see shouldEscalateForPainScore) — mild injuries don't. */
export function shouldEscalateForSeverity(severity: Severity): boolean {
  return severity === "strong";
}

/** Centralizes the pain-check-in escalation threshold (previously inlined in the retired bot/injury.ts as
 * `clamped >= 7`) so it's one tested source instead of a magic number at the call site. */
export function shouldEscalateForPainScore(score: number): boolean {
  return score >= 7;
}
