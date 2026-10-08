// Versioned Mini App REST seam. The implementation intentionally delegates to the
// proven handlers while the new contracts and client roll out. This gives us a real
// second adapter at the seam without duplicating business rules or touching legacy URLs.
import { BOOKMARK_HEADER, openReadSession } from "../adapters/d1/session";
import { handleStravaApi } from "./stravaApi";
import { miniAppUser } from "./auth";
import { handleWorkoutApi } from "./workoutApi";
import { handlePlanApi } from "./planApi";
import { handleNutritionApi } from "./nutritionApi";
import { handleProfileApi, handleOnboardingApi } from "./profileApi";
import { handleSettingsApi } from "./settingsApi";
import { handleQuickLogApi } from "./quickLogApi";
import { handleExtrasApi } from "./extrasApi";
import { handleSquadsApi } from "./squadApi";
import { handleTrainerApi } from "./trainerApi";
import { handleTrainerScheduleApi } from "./trainerScheduleApi";
import { handleOwnerApi } from "./ownerApi";
import { handleCoachApi } from "./coachApi";
import { handleBuddyApi } from "./buddyApi";
import { handleMediaApi } from "./mediaApi";
import { handleChatApi } from "./chatApi";
import { handleProgramsApi } from "./programsApi";
import { handleChallengesApi, handleInjuriesApi, handleBoardsApi, handleClientErrorApi, handleAppEventApi, handlePhotoApi } from "./miscApi";
import { createD1DashboardApplication } from "../adapters/d1/dashboardReader";
import { runIdempotent, WORKOUT_SAVE_WINDOW_HOURS } from "../adapters/d1/v2Idempotency";
import { expensiveBucket, withinLimit } from "../limits";
import { apiFailure, ERROR_RECORDED_HEADER } from "./apiError";
import { recordError } from "../adapters/d1/v2AiTelemetry";
import { checkCronHeartbeat } from "../scheduler";
import { logError, withHeader } from "../log";
import { V2_ERROR_CODES, type V2ErrorCode, type V2Response } from "../contracts/v2";
import type { Env } from "../types";

type LegacyHandler = (req: Request, url: URL, env: Env, ctx?: ExecutionContext) => Promise<Response>;

const PATHS: Array<{ prefix: string; legacy: string; handler: LegacyHandler }> = [
  { prefix: "/api/v2/workout", legacy: "/api/workout", handler: handleWorkoutApi },
  { prefix: "/api/v2/plan", legacy: "/api/plan", handler: handlePlanApi },
  { prefix: "/api/v2/nutrition", legacy: "/api/nutrition", handler: handleNutritionApi },
  { prefix: "/api/v2/profile", legacy: "/api/profile", handler: handleProfileApi },
  { prefix: "/api/v2/onboarding", legacy: "/api/onboarding", handler: handleOnboardingApi },
  { prefix: "/api/v2/settings", legacy: "/api/settings", handler: handleSettingsApi },
  { prefix: "/api/v2/log", legacy: "/api/log", handler: handleQuickLogApi },
  { prefix: "/api/v2/trainer/profile", legacy: "/api/trainer/profile", handler: handleExtrasApi },
  { prefix: "/api/v2/trainer/invite", legacy: "/api/trainer/invite", handler: handleExtrasApi },
  { prefix: "/api/v2/trainer/sessions", legacy: "/api/trainer/sessions", handler: handleTrainerScheduleApi },
  { prefix: "/api/v2/trainer/finance", legacy: "/api/trainer/finance", handler: handleTrainerScheduleApi },
  { prefix: "/api/v2/trainer", legacy: "/api/trainer", handler: handleTrainerApi },
  { prefix: "/api/v2/owner", legacy: "/api/owner", handler: handleOwnerApi },
  { prefix: "/api/v2/coach", legacy: "/api/coach", handler: handleCoachApi },
  { prefix: "/api/v2/records", legacy: "/api/records", handler: handleExtrasApi },
  { prefix: "/api/v2/weekcard", legacy: "/api/weekcard", handler: handleExtrasApi },
  { prefix: "/api/v2/story", legacy: "/api/story", handler: handleExtrasApi },
  { prefix: "/api/v2/support", legacy: "/api/support", handler: handleExtrasApi },
  { prefix: "/api/v2/inbox", legacy: "/api/inbox", handler: handleExtrasApi },
  { prefix: "/api/v2/strava", legacy: "/api/strava", handler: handleStravaApi },
  { prefix: "/api/v2/photocompare", legacy: "/api/photocompare", handler: handleExtrasApi },
  { prefix: "/api/v2/whatsnew", legacy: "/api/whatsnew", handler: handleExtrasApi },
  { prefix: "/api/v2/plates", legacy: "/api/plates", handler: handleExtrasApi },
  { prefix: "/api/v2/requests", legacy: "/api/requests", handler: handleExtrasApi },
  { prefix: "/api/v2/trainers", legacy: "/api/trainers", handler: handleExtrasApi },
  { prefix: "/api/v2/library", legacy: "/api/library", handler: handleExtrasApi },
  { prefix: "/api/v2/squads", legacy: "/api/squads", handler: handleSquadsApi },
  { prefix: "/api/v2/chat", legacy: "/api/chat", handler: handleChatApi },
  { prefix: "/api/v2/programs", legacy: "/api/programs", handler: handleProgramsApi },
  { prefix: "/api/v2/media", legacy: "/api/media", handler: handleMediaApi },
  { prefix: "/api/v2/buddy", legacy: "/api/buddy", handler: handleBuddyApi },
  { prefix: "/api/v2/challenges", legacy: "/api/challenges", handler: handleChallengesApi },
  { prefix: "/api/v2/injuries", legacy: "/api/injuries", handler: handleInjuriesApi },
  { prefix: "/api/v2/boards", legacy: "/api/boards", handler: handleBoardsApi },
  { prefix: "/api/v2/client-error", legacy: "/api/client-error", handler: handleClientErrorApi },
  { prefix: "/api/v2/event", legacy: "/api/event", handler: handleAppEventApi },
];

function codeFor(status: number, legacyError?: string): V2ErrorCode {
  if (legacyError === "bad request" || legacyError === "incomplete") return "validation_error";
  if (legacyError === "conflict" || status === 409) return "conflict";
  if (status === 401 || legacyError === "unauthorized") return "unauthorized";
  if (status === 403 || legacyError === "forbidden") return "forbidden";
  if (status === 404 || legacyError === "not found" || legacyError === "no_plan") return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "dependency_unavailable";
  return V2_ERROR_CODES.includes(legacyError as V2ErrorCode) ? (legacyError as V2ErrorCode) : "dependency_unavailable";
}

async function jsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text.slice(0, 200) };
  }
}

function withMeta<T>(data: T, req: Request): Response {
  const requestId = req.headers.get("x-request-id") ?? undefined;
  const body: V2Response<T> = { data, meta: { version: 2, ...(requestId ? { requestId } : {}) } };
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}

function validateV2Headers(req: Request): Response | null {
  const key = req.headers.get("idempotency-key");
  if (key !== null && (key.length < 8 || key.length > 128)) {
    return Response.json({ error: { code: "validation_error", message: "Idempotency-Key must be 8-128 characters" } }, { status: 400 });
  }
  const ifMatch = req.headers.get("if-match");
  if (ifMatch !== null && ifMatch.length > 128) {
    return Response.json({ error: { code: "validation_error", message: "If-Match is too long" } }, { status: 400 });
  }
  return null;
}

/** The same envelope every v2 failure uses. */
function failure(req: Request, status: number, code: V2ErrorCode, message: string, headers?: Record<string, string>): Response {
  const requestId = req.headers.get("x-request-id") ?? undefined;
  return Response.json({ error: { code, message, ...(requestId ? { requestId } : {}) } }, { status, ...(headers ? { headers } : {}) });
}

/** How long a replayed Idempotency-Key is honoured. Only a workout save outlives the default. */
function idempotencyWindowHours(method: string, pathname: string): number | undefined {
  return method === "POST" && pathname === "/api/v2/workout/save" ? WORKOUT_SAVE_WINDOW_HOURS : undefined;
}

/** `/api/v2/workout/save` -> `api_workout`: the owner report's per-surface error kind. */
function surfaceKind(pathname: string): string {
  return `api_${pathname.split("/")[3] ?? "unknown"}`;
}

/**
 * The one pipeline every /api/v2/* call goes through, in this order:
 *   1. authenticate (non-GET only; reads authenticate inside their handler)
 *   2. throttle the expensive actions (limits.ts)
 *   3. claim the Idempotency-Key (v2Idempotency.ts), with the window that route needs
 *   4. run the handler; a throw or an untraced 5xx reaches the owner report (error_events)
 *   5. translate the legacy reply into the v2 envelope
 * When this pipeline holds the idempotency claim it removes the header from the request it hands the
 * handler, so a handler's own runIdempotent sees no key and cannot claim the same key a second time
 * (which 409'd every /workout/save when the two were first stacked). That used to be a hand-kept
 * list of "self-idempotent" handlers; now it holds by construction.
 */
async function forward(req: Request, url: URL, env: Env, path: string, handler: LegacyHandler, ctx?: ExecutionContext): Promise<Response> {
  const legacyUrl = new URL(url.toString());
  legacyUrl.pathname = path;
  const mutating = req.method !== "GET";
  const actor = mutating ? await miniAppUser(req, url, env).catch(() => null) : null;

  const bucket = actor ? expensiveBucket(req.method, url.pathname) : null;
  if (actor && bucket && !(await withinLimit(env, "expensive", `${bucket}:${actor._id}`))) {
    return failure(req, 429, "rate_limited", "Too many requests, slow down", { "retry-after": "60" });
  }

  const idempotencyKey = mutating ? req.headers.get("idempotency-key") : null;
  const holdsClaim = !!(actor && idempotencyKey);
  let handlerReq = req;
  if (holdsClaim) {
    const headers = new Headers(req.headers);
    headers.delete("idempotency-key");
    handlerReq = new Request(req, { headers });
  }

  const run = async (): Promise<{ status: number; body: unknown }> => {
    let response: Response;
    try {
      response = await handler(handlerReq, legacyUrl, env, ctx);
    } catch (err) {
      response = await apiFailure(env, surfaceKind(url.pathname), err, { userId: actor?._id ?? 0 });
    }
    // A 5xx no handler wrote down (media and quick-log only logged) still has to reach error_events.
    if (response.status >= 500 && !response.headers.has(ERROR_RECORDED_HEADER)) {
      await recordError(env.DB, { userId: actor?._id, kind: surfaceKind(url.pathname), errorType: "exception", message: `HTTP ${response.status}` }).catch(() => {});
    }
    return { status: response.status, body: await jsonBody(response) };
  };
  const result = holdsClaim
    ? await runIdempotent(env.DB, actor!._id, idempotencyKey, run, { windowHours: idempotencyWindowHours(req.method, url.pathname) })
    : await run();

  const body = result.body;
  if (result.status >= 400) {
    const legacyError = body && typeof body === "object"
      ? (typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : typeof (body as { message?: unknown }).message === "string"
          ? (body as { message: string }).message
          : undefined)
      : undefined;
    return failure(req, result.status, codeFor(result.status, legacyError), legacyError ?? "Request failed");
  }
  return withMeta(body, req);
}

function routeFor(pathname: string): { handler: LegacyHandler; legacyPath: string } | null {
  for (const route of PATHS) {
    // Whole path segments only: "/api/v2/workoutX" is not the workout surface.
    if (pathname !== route.prefix && !pathname.startsWith(`${route.prefix}/`)) continue;
    const suffix = pathname.slice(route.prefix.length);
    return { handler: route.handler, legacyPath: route.legacy + (suffix || "") };
  }
  return null;
}

export async function handleV2Api(req: Request, url: URL, env: Env, ctx?: ExecutionContext): Promise<Response> {
  // Every Mini App call runs on a D1 session (adapters/d1/session): replica reads where enabled,
  // read-your-writes across calls via the bookmark the client echoes back.
  const session = openReadSession(env.DB, req.headers.get(BOOKMARK_HEADER));
  const res = await handleV2ApiInner(req, url, session ? { ...env, DB: session.db } : env, ctx);
  const bookmark = session?.bookmark();
  return bookmark ? withHeader(res, BOOKMARK_HEADER, bookmark) : res;
}

async function handleV2ApiInner(req: Request, url: URL, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const headerError = validateV2Headers(req);
  if (headerError) return headerError;
  if (url.pathname === "/api/v2/photo" && (req.method === "GET" || req.method === "POST")) {
    const legacyUrl = new URL(url.toString());
    legacyUrl.pathname = "/api/photo";
    const execution = ctx ?? ({ waitUntil: () => {} } as unknown as ExecutionContext);
    return handlePhotoApi(req, legacyUrl, env, execution);
  }
  if (url.pathname === "/api/v2/dashboard" && req.method === "GET") {
    const user = await miniAppUser(req, url, env);
    if (!user) {
      return Response.json({ error: { code: "unauthorized", message: "Authentication required" } }, { status: 401 });
    }
    // Dead-man switch for the cron rides the hottest fetch path (detached, never blocks). The
    // legacy /api/dashboard branch in index.ts has always done this, but every user is on the v2
    // client now (V2_APP_ENABLED), so without this the alert could no longer fire at all.
    if (ctx) ctx.waitUntil(checkCronHeartbeat(env));
    try {
      const payload = await createD1DashboardApplication(env.DB).getDashboard(user);
      return withMeta({ viewer: { id: user._id, role: user.role, onboarded: user.onboarded, planPending: !user.onboarded && user.session.mode === "plan_pending" }, ...payload }, req);
    } catch (err) {
      logError("v2_dashboard_failed", err, { userId: user._id });
      // Also the D1 sink, which is what /ownerreport's Errors section and the error-spike alert
      // read — logError alone reaches Workers Logs and Analytics Engine but neither of those.
      await recordError(env.DB, {
        userId: user._id,
        kind: "v2_dashboard_failed",
        errorType: "exception",
        message: String(err).slice(0, 200),
      }).catch(() => {});
      return Response.json({ error: { code: "dependency_unavailable", message: "Dashboard unavailable" } }, { status: 503 });
    }
  }

  const route = routeFor(url.pathname);
  if (!route) {
    return Response.json({ error: { code: "not_found", message: "Route not found" } }, { status: 404 });
  }
  return forward(req, url, env, route.legacyPath, route.handler, ctx);
}
