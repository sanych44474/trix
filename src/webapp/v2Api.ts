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
import { handleTrainerApi } from "./trainerApi";
import { handleOwnerApi } from "./ownerApi";
import { handleBuddyApi } from "./buddyApi";
import { handleChallengesApi, handleInjuriesApi, handleBoardsApi, handleClientErrorApi, handlePhotoApi } from "./miscApi";
import { createD1DashboardApplication } from "../adapters/d1/dashboardReader";
import { projectNutrition, projectPlan, projectUserCore, projectWorkout } from "../adapters/d1/v2Projection";
import { compareV2UserParity } from "../adapters/d1/v2Parity";
import { getWorkoutLog } from "../adapters/d1/v2Workouts";
import { getActivePlan } from "../adapters/d1/v2Plans";
import { getDayMeals } from "../adapters/d1/v2Nutrition";
import { runIdempotent } from "../adapters/d1/v2Idempotency";
import { localParts } from "../domain/progression";
import { logError, logInfo } from "../log";
import { V2_ERROR_CODES, type V2ErrorCode, type V2Response } from "../contracts/v2";
import { v2CohortEnabled } from "../contracts/rollout";
import type { Env, UserDoc } from "../types";

type LegacyHandler = (req: Request, url: URL, env: Env) => Promise<Response>;

const PATHS: Array<{ prefix: string; legacy: string; handler: LegacyHandler }> = [
  { prefix: "/api/v2/workout", legacy: "/api/workout", handler: handleWorkoutApi },
  { prefix: "/api/v2/plan", legacy: "/api/plan", handler: handlePlanApi },
  { prefix: "/api/v2/nutrition", legacy: "/api/nutrition", handler: handleNutritionApi },
  { prefix: "/api/v2/profile", legacy: "/api/profile", handler: handleProfileApi },
  { prefix: "/api/v2/onboarding", legacy: "/api/onboarding", handler: handleOnboardingApi },
  { prefix: "/api/v2/settings", legacy: "/api/settings", handler: handleSettingsApi },
  { prefix: "/api/v2/log", legacy: "/api/log", handler: handleQuickLogApi },
  { prefix: "/api/v2/trainer/profile", legacy: "/api/trainer/profile", handler: handleExtrasApi },
  { prefix: "/api/v2/trainer/sessions", legacy: "/api/trainer/sessions", handler: handleExtrasApi },
  { prefix: "/api/v2/trainer/finance", legacy: "/api/trainer/finance", handler: handleExtrasApi },
  { prefix: "/api/v2/trainer", legacy: "/api/trainer", handler: handleTrainerApi },
  { prefix: "/api/v2/owner", legacy: "/api/owner", handler: handleOwnerApi },
  { prefix: "/api/v2/records", legacy: "/api/records", handler: handleExtrasApi },
  { prefix: "/api/v2/weekcard", legacy: "/api/weekcard", handler: handleExtrasApi },
  { prefix: "/api/v2/photocompare", legacy: "/api/photocompare", handler: handleExtrasApi },
  { prefix: "/api/v2/whatsnew", legacy: "/api/whatsnew", handler: handleExtrasApi },
  { prefix: "/api/v2/plates", legacy: "/api/plates", handler: handleExtrasApi },
  { prefix: "/api/v2/requests", legacy: "/api/requests", handler: handleExtrasApi },
  { prefix: "/api/v2/trainers", legacy: "/api/trainers", handler: handleExtrasApi },
  { prefix: "/api/v2/library", legacy: "/api/library", handler: handleExtrasApi },
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
  const dualWrite = actor ? v2CohortEnabled(env, actor._id) : false;
  let requestBody: Record<string, unknown> | null = null;
  if (actor && req.method !== "GET") {
    requestBody = await req.clone().json().catch(() => null) as Record<string, unknown> | null;
  }
  const run = async (): Promise<{ status: number; body: unknown }> => {
    const response = await handler(req, legacyUrl, env);
    const body = await jsonBody(response);
    if (response.status < 400 && actor && dualWrite) {
      await syncDualWrite(env, path, actor, requestBody).catch((error) => {
        logInfo("v2_dual_write_failure", { resource: path, error: error instanceof Error ? error.message : String(error) });
      });
    }
    return { status: response.status, body };
  };
  const result = actor && idempotencyKey
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

async function syncDualWrite(
  env: Env,
  path: string,
  user: UserDoc,
  body: Record<string, unknown> | null,
): Promise<void> {
  await projectUserCore(env.DB, user);
  if (path.startsWith("/api/plan")) {
    const plan = await getActivePlan(env.DB, user._id);
    if (plan) await projectPlan(env.DB, plan);
    return;
  }
  if (path.startsWith("/api/workout")) {
    const requestedDate = typeof body?.date === "string" ? body.date : localParts(user.profile.timezone).date;
    const workout = await getWorkoutLog(env.DB, user._id, requestedDate);
    if (workout) await projectWorkout(env.DB, workout);
    return;
  }
  if (path.startsWith("/api/nutrition")) {
    const date = localParts(user.profile.timezone).date;
    const meals = await getDayMeals(env.DB, user._id, date);
    await projectNutrition(env.DB, { userId: user._id, date, meals, updatedAt: new Date() });
    return;
  }
  if (path.startsWith("/api/log")) {
    if (body?.kind === "food") {
      const date = localParts(user.profile.timezone).date;
      const meals = await getDayMeals(env.DB, user._id, date);
      await projectNutrition(env.DB, { userId: user._id, date, meals, updatedAt: new Date() });
    } else if (body?.kind === "workout") {
      const date = localParts(user.profile.timezone).date;
      const workout = await getWorkoutLog(env.DB, user._id, date);
      if (workout) await projectWorkout(env.DB, workout);
    }
  }
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
  if (url.pathname === "/api/v2/photo" && req.method === "GET") {
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
    try {
      const payload = await createD1DashboardApplication(env.DB).getDashboard(user);
      if (env.V2_SHADOW_READS === "1") {
        const parity = await compareV2UserParity(env.DB, user._id).catch(() => null);
        if (parity) logInfo("v2_shadow_parity", { ok: parity.ok, legacy: parity.legacy, v2: parity.v2 });
      }
      return withMeta({ viewer: { id: user._id, role: user.role, onboarded: user.onboarded }, ...payload }, req);
    } catch (err) {
      logError("v2_dashboard_failed", err, { userId: user._id });
      return Response.json({ error: { code: "dependency_unavailable", message: "Dashboard unavailable" } }, { status: 503 });
    }
  }

  const route = routeFor(url.pathname);
  if (!route) {
    return Response.json({ error: { code: "not_found", message: "Route not found" } }, { status: 404 });
  }
  return forward(req, url, env, route.legacyPath, route.handler);
}
