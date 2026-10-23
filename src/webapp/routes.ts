// The one table of Mini App handler routes. Two readers use it:
//   - v2Api.ts: /api/v2/X is the legacy /api/X path, matched on whole path segments.
//   - index.ts: the unversioned /api/* dispatch, for the entries with a `legacy` match mode.
// Entries are in order of precedence: a more specific path must come before the path it sits under.
// `legacy` is undefined for routes the unversioned surface never dispatched (they are reachable only
// through /api/v2); "exact" and "prefix" are the match modes index.ts always used for them.
import { handleStravaApi } from "./stravaApi";
import { handleWorkoutApi } from "./workoutApi";
import { handlePlanApi } from "./planApi";
import { handleNutritionApi } from "./nutritionApi";
import { handleProfileApi, handleOnboardingApi } from "./profileApi";
import { handleSettingsApi } from "./settingsApi";
import { handleQuickLogApi } from "./quickLogApi";
import { handleTrainingExtrasApi } from "./trainingExtrasApi";
import { handleExtrasApi } from "./extrasApi";
import { handleSquadsApi } from "./squadApi";
import { handleTrainerApi } from "./trainerApi";
import { handleTrainerScheduleApi } from "./trainerScheduleApi";
import { handleOwnerApi } from "./ownerApi";
import { handleCoachApi } from "./coachApi";
import { handleBuddyApi } from "./buddyApi";
import { handleMediaApi } from "./mediaApi";
import { handleChatApi } from "./chatApi";
import { handleDailyApi } from "./dailyApi";
import { handleProgramsApi } from "./programsApi";
import { handleChallengesApi, handleInjuriesApi, handleBoardsApi, handleClientErrorApi, handleAppEventApi } from "./miscApi";
import type { Env } from "../types";

export type MiniAppHandler = (req: Request, url: URL, env: Env, ctx?: ExecutionContext) => Promise<Response>;

export interface MiniAppRoute {
  /** The unversioned path, e.g. /api/trainer. The v2 path is /api/v2 plus the same suffix. */
  path: string;
  handler: MiniAppHandler;
  legacy?: "exact" | "prefix";
}

export const MINI_APP_ROUTES: readonly MiniAppRoute[] = [
  { path: "/api/workout", handler: handleWorkoutApi, legacy: "prefix" },
  { path: "/api/plan", handler: handlePlanApi, legacy: "exact" },
  { path: "/api/nutrition", handler: handleNutritionApi, legacy: "exact" },
  { path: "/api/profile", handler: handleProfileApi, legacy: "exact" },
  { path: "/api/onboarding", handler: handleOnboardingApi, legacy: "exact" },
  { path: "/api/settings", handler: handleSettingsApi, legacy: "exact" },
  { path: "/api/log", handler: handleQuickLogApi },
  { path: "/api/cardio", handler: handleTrainingExtrasApi },
  { path: "/api/standards", handler: handleTrainingExtrasApi },
  { path: "/api/comeback", handler: handleTrainingExtrasApi },
  { path: "/api/checkin/adaptive", handler: handleTrainingExtrasApi },
  { path: "/api/trainer/profile", handler: handleExtrasApi, legacy: "exact" },
  { path: "/api/trainer/invite", handler: handleExtrasApi },
  { path: "/api/trainer/sessions", handler: handleTrainerScheduleApi, legacy: "exact" },
  { path: "/api/trainer/finance", handler: handleTrainerScheduleApi, legacy: "exact" },
  { path: "/api/trainer", handler: handleTrainerApi, legacy: "prefix" },
  { path: "/api/owner", handler: handleOwnerApi, legacy: "prefix" },
  { path: "/api/coach", handler: handleCoachApi },
  { path: "/api/records", handler: handleExtrasApi, legacy: "exact" },
  { path: "/api/weekcard", handler: handleExtrasApi, legacy: "exact" },
  { path: "/api/story", handler: handleExtrasApi },
  { path: "/api/support", handler: handleExtrasApi },
  { path: "/api/inbox", handler: handleExtrasApi },
  { path: "/api/strava", handler: handleStravaApi },
  { path: "/api/photocompare", handler: handleExtrasApi },
  { path: "/api/whatsnew", handler: handleExtrasApi, legacy: "exact" },
  { path: "/api/plates", handler: handleExtrasApi, legacy: "exact" },
  { path: "/api/requests", handler: handleExtrasApi, legacy: "exact" },
  { path: "/api/trainers", handler: handleExtrasApi, legacy: "exact" },
  { path: "/api/library", handler: handleExtrasApi, legacy: "exact" },
  { path: "/api/squads", handler: handleSquadsApi },
  { path: "/api/chat", handler: handleChatApi },
  { path: "/api/programs", handler: handleProgramsApi },
  { path: "/api/media", handler: handleMediaApi },
  { path: "/api/buddy", handler: handleBuddyApi, legacy: "exact" },
  { path: "/api/challenges", handler: handleChallengesApi, legacy: "exact" },
  { path: "/api/injuries", handler: handleInjuriesApi, legacy: "exact" },
  { path: "/api/boards", handler: handleBoardsApi, legacy: "exact" },
  { path: "/api/client-error", handler: handleClientErrorApi, legacy: "exact" },
  { path: "/api/event", handler: handleAppEventApi },
  { path: "/api/wellbeing", handler: handleDailyApi },
  { path: "/api/survey", handler: handleDailyApi },
];

/** The route a v2 path reaches: /api/v2/X matches the entry for /api/X on whole path segments. */
export function v2RouteFor(pathname: string): { route: MiniAppRoute; legacyPath: string } | null {
  if (!pathname.startsWith("/api/v2/")) return null;
  const legacyPath = `/api${pathname.slice("/api/v2".length)}`;
  const route = MINI_APP_ROUTES.find((r) => legacyPath === r.path || legacyPath.startsWith(`${r.path}/`));
  return route ? { route, legacyPath } : null;
}

/** The route the unversioned /api/* surface dispatches to, or null. Only entries with a `legacy` mode. */
export function legacyRouteFor(pathname: string): MiniAppRoute | null {
  return (
    MINI_APP_ROUTES.find((r) => {
      if (r.legacy === "exact") return pathname === r.path;
      if (r.legacy === "prefix") return pathname.startsWith(`${r.path}/`);
      return false;
    }) ?? null
  );
}
