// Barrel: re-exports the bot modules so tests and older imports can keep using "./bot".
// Code in src/ imports from the declaring modules directly; nothing here declares behaviour.
export * from "./bot/start";
export * from "./bot/planView";
export * from "./bot/menus";
export * from "./bot/commonCmds";
// Core context/plumbing (MyContext, reply, HTML, setMode, plan-owner helpers, TKey) lives in
// adapters/telegram/context.ts now — extracted so the many bot/*.ts feature files that only
// need these don't have to import the whole god-file (roadmap item 1, first slice: this was the
// single biggest source of router.ts's 100+ backward imports from bot.ts). Re-exported here so
// every existing `from "./bot"` consumer keeps working unchanged.
export type { MyContext, TKey } from "./adapters/telegram/context";
export {
  HTML, clearEditOwner, getActivePlanOrReply, isEditingOther, planOwnerId, planOwnerLang, reply, sendLong, setEditOwner, setMode,
} from "./adapters/telegram/context";
// A valid training day must carry a full session — used to reject degenerate AI plans.
export { MIN_EXERCISES_PER_DAY } from "./domain/plan-lint";

// The AI provider's raw plan response shape — canonical definition + runtime validation live in
// domain/plan-schema.ts (AiPlanResponse/parseAiPlanResponse), not duplicated here.
export type { AiPlanResponse as AiPlan } from "./domain/plan-schema";
export * from "./bot/appLinks";
export * from "./bot/exerciseCatalog";
export * from "./bot/todayEdit";
export * from "./bot/recordsCmds";
export * from "./bot/settingsCmds";
export * from "./bot/nutritionCmds";
export * from "./bot/progressCmds";
export { buildOwnerReport, buildErrorReport, buildOwnerMetrics, ownerUsersData } from "./bot/owner";
// Extracted modules — imported for internal use AND re-exported so every existing consumer
// (scheduler, webapp, tests) keeps importing from "./bot" unchanged.
export * from "./features/gamification/boards";
export * from "./features/gamification/weekCard";
export * from "./bot/survey";
export * from "./bot/onboarding";
export * from "./bot/keyboards";
export * from "./bot/plan";
export * from "./bot/router";
export * from "./features/gamification/challenges";
export * from "./bot/vacation";
export * from "./bot/injury";
export * from "./bot/cleanup";
export * from "./bot/cycle";
export * from "./bot/shareConsent";
export * from "./bot/calendar";
export * from "./bot/planDays";
export * from "./bot/report";
export * from "./bot/exportData";
export * from "./bot/planGen";
export * from "./features/nutrition/nutritionLog";
export * from "./bot/coach";
export * from "./bot/workoutSave";
export * from "./bot/feedbackIntake";
export * from "./bot/logSelfEdit";
export * from "./bot/warmup";
export * from "./bot/planExerciseEdit";
export * from "./bot/guidedLog";
export * from "./bot/nextBestAction";

