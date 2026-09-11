// Request-id + structured logging. A Worker isolate can process several requests concurrently,
// so a plain module-level "current request id" variable would leak between them — this uses
// AsyncLocalStorage (available via the nodejs_compat flag already on in wrangler.toml) to carry
// the id implicitly through the whole call chain of ONE request/cron run, with no need to thread
// it as an explicit parameter through every function in between.
//
// Scope: this wraps the two entrypoints (index.ts's fetch/scheduled) and their immediate
// top-level error handling, giving every request and every cron run one correlatable id and one
// structured summary line. It does NOT retrofit the many pre-existing `console.error(...)` calls
// deep in bot.ts/scheduler.ts's per-user loops -- those already carry their own useful context
// (an action name + userId) and rewriting dozens of them for a decorative reqId is not what this
// closes. New logging code, or a call site to touch anyway, should prefer logError/logInfo below.
//
// Analytics Engine (docs/slos.md): the SAME ambient context also carries `env`, so every
// logInfo/logError call additionally writes an Analytics Engine data point when the ANALYTICS
// binding exists -- one place emits both the console line (Workers Logs, human-grep-able) and
// the queryable data point (Grafana), instead of every one of the ~25 call sites across the
// codebase doing both separately. `env` is optional on the context on purpose: a caller that
// hasn't set up the context (there shouldn't be any left, but fail safe) just gets the console
// line, never a crash.
import { AsyncLocalStorage } from "node:async_hooks";
import type { Env } from "./types";

interface LogContext {
  reqId: string;
  env?: Env;
}

const als = new AsyncLocalStorage<LogContext>();

export function runWithRequestId<T>(reqId: string, env: Env, fn: () => T): T {
  return als.run({ reqId, env }, fn);
}

export function currentRequestId(): string | undefined {
  return als.getStore()?.reqId;
}

function baseFields(): Record<string, unknown> {
  const reqId = currentRequestId();
  return { ts: new Date().toISOString(), ...(reqId ? { reqId } : {}) };
}

// Analytics Engine's data model is positional, not named columns -- blob1/blob2/blob3 and
// index1 below are the actual column names a Grafana SQL query reads back. Keep this the single
// place that convention is defined, since it's shared by every event.
function writeAnalytics(level: "info" | "error", scope: string, extra?: Record<string, unknown>): void {
  const env = als.getStore()?.env;
  if (!env?.ANALYTICS) return;
  try {
    env.ANALYTICS.writeDataPoint({
      indexes: [scope], // what a query cheaply filters/groups by
      blobs: [scope, level, JSON.stringify(extra ?? {})],
      doubles: [1], // a constant "1" per row so SUM(double1) counts events, same as COUNT(*)
    });
  } catch {
    // best-effort -- an analytics hiccup must never break the caller's actual request
  }
}

/** One structured JSON line per call -- easy to grep/filter in Workers Logs, and carries the
 * ambient request id (if any) without the caller having to pass it in. Also writes an Analytics
 * Engine data point (see writeAnalytics) when the binding is configured. */
export function logError(scope: string, err: unknown, extra?: Record<string, unknown>): void {
  console.error(
    JSON.stringify({
      level: "error",
      scope,
      message: err instanceof Error ? err.message : String(err),
      ...(err instanceof Error && err.stack ? { stack: err.stack } : {}),
      ...extra,
      ...baseFields(),
    }),
  );
  writeAnalytics("error", scope, extra);
}

/** One structured JSON line for a request/run summary (method, path, status, duration, ...) or a
 * product event (docs/slos.md). Also writes an Analytics Engine data point when configured. */
export function logInfo(scope: string, extra?: Record<string, unknown>): void {
  console.log(JSON.stringify({ level: "info", scope, ...extra, ...baseFields() }));
  writeAnalytics("info", scope, extra);
}

/** Adds a header to a Response, rebuilding via a fresh Headers instance rather than mutating in
 * place -- a Response with an immutable header guard (Response.redirect(), most notably: GET /v
 * shipped 500ing in production because of exactly this) throws on `.headers.set()` directly. */
export function withHeader(res: Response, name: string, value: string): Response {
  const headers = new Headers(res.headers);
  headers.set(name, value);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
