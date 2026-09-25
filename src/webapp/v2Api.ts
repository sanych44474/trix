// Versioned Mini App REST seam. The implementation intentionally delegates to the
// proven handlers while the new contracts and client roll out. This gives us a real
// second adapter at the seam without duplicating business rules or touching legacy URLs.
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
import { handleChallengesApi, handleInjuriesApi, handleBoardsApi, handleClientErrorApi, handlePhotoApi } from "./miscApi";
import { createD1DashboardApplication } from "../adapters/d1/dashboardReader";
import { runIdempotent } from "../adapters/d1/v2Idempotency";
import { recordError } from "../adapters/d1/v2Admin";
import { checkCronHeartbeat } from "../scheduler";
import { logError } from "../log";
import { V2_ERROR_CODES, type V2ErrorCode, type V2Response } from "../contracts/v2";
import type { Env } from "../types";

type LegacyHandler = (req: Request, url: URL, env: Env) => Promise<Response>;

// Handlers that already claim the request's Idempotency-Key themselves (each calls
// runIdempotent internally: workoutApi.ts's save, settingsApi.ts, trainerApi.ts,
// miscApi.ts's handleInjuriesApi). forward() must NOT also wrap these in its own
// runIdempotent -- doing so claims the SAME (accountId, key) pair twice in one request: the
// outer claim commits first, then the inner claim's insert always collides with it (not a race,
// deterministic every time), so the inner handler always gets "still processing" and returns
// 409 -- the real work (e.g. saveWorkout) never runs. Confirmed live: /api/v2/workout/save was
// 409ing on every attempt while v2_workout_sessions received zero writes.
const SELF_IDEMPOTENT_HANDLERS = new Set<LegacyHandler>([handleWorkoutApi, handleSettingsApi, handleTrainerApi, handleInjuriesApi]);

const PATHS: Array<{ prefix: string; legacy: string; handler: LegacyHandler }> = [
  { prefix: "/api/v2/workout", legacy: "/api/workout", handler: handleWorkoutApi },
  { prefix: "/api/v2/plan", legacy: "/api/plan", handler: handlePlanApi },
  { prefix: "/api/v2/nutrition", legacy: "/api/nutrition", handler: handleNutritionApi },
  { prefix: "/api/v2/profile", legacy: "/api/profile", handler: handleProfileApi },
  { prefix: "/api/v2/onboarding", legacy: "/api/onboarding", handler: handleOnboardingApi },
  { prefix: "/api/v2/settings", legacy: "/api/settings", handler: handleSettingsApi },
  { prefix: "/api/v2/log", legacy: "/api/log", handler: handleQuickLogApi },
  { prefix: "/api/v2/trainer/profile", legacy: "/api/trainer/profile", handler: handleExtrasApi },
  { prefix: "/api/v2/trainer/sessions", legacy: "/api/trainer/sessions", handler: handleTrainerScheduleApi },
  { prefix: "/api/v2/trainer/finance", legacy: "/api/trainer/finance", handler: handleTrainerScheduleApi },
  { prefix: "/api/v2/trainer", legacy: "/api/trainer", handler: handleTrainerApi },
  { prefix: "/api/v2/owner", legacy: "/api/owner", handler: handleOwnerApi },
  { prefix: "/api/v2/coach", legacy: "/api/coach", handler: handleCoachApi },
  { prefix: "/api/v2/records", legacy: "/api/records", handler: handleExtrasApi },
  { prefix: "/api/v2/weekcard", legacy: "/api/weekcard", handler: handleExtrasApi },
  { prefix: "/api/v2/photocompare", legacy: "/api/photocompare", handler: handleExtrasApi },
  { prefix: "/api/v2/whatsnew", legacy: "/api/whatsnew", handler: handleExtrasApi },
  { prefix: "/api/v2/plates", legacy: "/api/plates", handler: handleExtrasApi },
  { prefix: "/api/v2/requests", legacy: "/api/requests", handler: handleExtrasApi },
  { prefix: "/api/v2/trainers", legacy: "/api/trainers", handler: handleExtrasApi },
  { prefix: "/api/v2/library", legacy: "/api/library", handler: handleExtrasApi },
  { prefix: "/api/v2/squads", legacy: "/api/squads", handler: handleSquadsApi },
  { prefix: "/api/v2/buddy", legacy: "/api/buddy", handler: handleBuddyApi },
  { prefix: "/api/v2/challenges", legacy: "/api/challenges", handler: handleChallengesApi },
  { prefix: "/api/v2/injuries", legacy: "/api/injuries", handler: handleInjuriesApi },
  { prefix: "/api/v2/boards", legacy: "/api/boards", handler: handleBoardsApi },
  { prefix: "/api/v2/client-error", legacy: "/api/client-error", handler: handleClientErrorApi },
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

async function forward(req: Request, url: URL, env: Env, path: string, handler: LegacyHandler): Promise<Response> {
  const legacyUrl = new URL(url.toString());
  legacyUrl.pathname = path;
  const idempotencyKey = req.method !== "GET" ? req.headers.get("idempotency-key") : null;
  const actor = req.method !== "GET" ? await miniAppUser(req, url, env).catch(() => null) : null;
  const run = async (): Promise<{ status: number; body: unknown }> => {
    const response = await handler(req, legacyUrl, env);
    const body = await jsonBody(response);
    return { status: response.status, body };
  };
  const result = actor && idempotencyKey && !SELF_IDEMPOTENT_HANDLERS.has(handler)
    ? await runIdempotent(env.DB, actor._id, idempotencyKey, run)
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
    const requestId = req.headers.get("x-request-id") ?? undefined;
    return Response.json(
      {
        error: {
          code: codeFor(result.status, legacyError),
          message: legacyError ?? "Request failed",
          ...(requestId ? { requestId } : {}),
        },
      },
      { status: result.status },
    );
  }
  return withMeta(body, req);
}

function routeFor(pathname: string): { handler: LegacyHandler; legacyPath: string } | null {
  for (const route of PATHS) {
    if (!pathname.startsWith(route.prefix)) continue;
    const suffix = pathname.slice(route.prefix.length);
    return { handler: route.handler, legacyPath: route.legacy + (suffix || "") };
  }
  return null;
}

export async function handleV2Api(req: Request, url: URL, env: Env, ctx?: ExecutionContext): Promise<Response> {
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
      return withMeta({ viewer: { id: user._id, role: user.role, onboarded: user.onboarded }, ...payload }, req);
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
  return forward(req, url, env, route.legacyPath, route.handler);
}
