// The "no plan" state of Today and the Plan screen, kept apart from a rest day and from an error.
// An account has no active plan after leaving a trainer (the plan is switched off), as a trainer who
// never did the questionnaire, or while a plan build is running or after it failed.
// Pure, tested by test/mini-app-no-plan.test.ts.

/** build: start the plan build; questionnaire: open onboarding; trainer: the trainer prepares it; building: the first plan is on its way. */
export type NoPlanAction = "build" | "questionnaire" | "trainer" | "building";

export interface NoPlanViewer { role: string; onboarded: boolean; planPending?: boolean }

export function noPlanAction(viewer: NoPlanViewer): NoPlanAction {
  if (viewer.planPending) return "building";
  // The questionnaire comes first for everyone: the server builds no plan without it (409 not_onboarded).
  if (!viewer.onboarded) return "questionnaire";
  // A client who has a trainer cannot rebuild (403 trainer_managed): the trainer assigns the plan.
  if (viewer.role === "client") return "trainer";
  return "build";
}

/** The dashboard's plan day summaries are empty exactly when there is no active plan with days. */
export function hasActivePlan(calendar: { split: unknown[] }): boolean {
  return calendar.split.length > 0;
}

/** GET /api/v2/plan answers 404 with code not_found and message no_plan when the account has no plan. */
export function isNoPlanError(err: unknown): boolean {
  return err instanceof Error && (err as Error & { code?: unknown }).code === "not_found" && err.message === "no_plan";
}
