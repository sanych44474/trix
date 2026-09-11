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
import { AsyncLocalStorage } from "node:async_hooks";

interface LogContext {
  reqId: string;
}

const als = new AsyncLocalStorage<LogContext>();

export function runWithRequestId<T>(reqId: string, fn: () => T): T {
  return als.run({ reqId }, fn);
}

export function currentRequestId(): string | undefined {
  return als.getStore()?.reqId;
}

function baseFields(): Record<string, unknown> {
  const reqId = currentRequestId();
  return { ts: new Date().toISOString(), ...(reqId ? { reqId } : {}) };
}

/** One structured JSON line per call -- easy to grep/filter in Workers Logs, and carries the
 * ambient request id (if any) without the caller having to pass it in. */
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
}

/** One structured JSON line for a request/run summary (method, path, status, duration, ...). */
export function logInfo(scope: string, extra?: Record<string, unknown>): void {
  console.log(JSON.stringify({ level: "info", scope, ...extra, ...baseFields() }));
}
