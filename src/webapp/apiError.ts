// One place where a Mini App handler's unhandled failure becomes visible.
//
// The bot funnels every failure through router.ts's onError -> recordError, which is what makes
// /ownerreport's "Errors" section and the proactive "🚨 Error spike" alert (scheduler.ts) reflect
// what users actually hit. The Mini App handlers did not: each caught to a bare console.error, so
// a 500 on every save for every user produced no error_events row and no Analytics Engine data
// point. The primary UI was outside observability entirely.
//
// Both sinks are needed and they are different: logError writes the structured Workers Logs line
// plus the Analytics Engine point (Grafana), recordError writes the D1 row the owner report and
// the spike alert read. Pairing them here means a new handler cannot accidentally wire up only one.
import { recordError } from "../adapters/d1/v2Admin";
import { logError } from "../log";
import type { Env } from "../types";

/**
 * Records a handler failure in both sinks and returns the 500 the caller should send.
 * `scope` doubles as the owner report's `kind`, so keep it per-surface (api_workout, api_plan, ...)
 * — that is what makes the report able to say WHICH surface is failing.
 */
export async function apiFailure(
  env: Env,
  scope: string,
  err: unknown,
  ctx: { userId: number; action?: string | null },
): Promise<Response> {
  logError(scope, err, { userId: ctx.userId, ...(ctx.action ? { action: ctx.action } : {}) });
  await recordError(env.DB, {
    userId: ctx.userId,
    kind: scope,
    errorType: "exception",
    message: String(err).slice(0, 200),
  }).catch(() => {});
  return Response.json({ error: "error" }, { status: 500 });
}
