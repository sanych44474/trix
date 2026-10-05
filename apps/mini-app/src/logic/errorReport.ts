// Mini App crashes reach the owner's error report instead of only arriving as user screenshots:
// uncaught errors, unhandled promise rejections and React render crashes go to
// /api/v2/client-error (recorded as kind "webapp", errorType "client_js"). Each distinct message
// is sent once per app session, at most MAX_REPORTS in total, and expected noise is dropped
// (network failures, an aborted fetch, the ResizeObserver loop warning, failed API calls — those
// are already logged on the server). Pure decision + a tiny sender; test/mini-app-error-report.test.ts.

export const MAX_REPORTS = 5;

const NOISE = /ResizeObserver loop|Failed to fetch|NetworkError|Load failed|AbortError|The operation was aborted|Script error\.?$/i;

export interface ErrorReport { message: string; source?: string; line?: number }

/** What to send for this error, or null to skip it (noise, a repeat, over the cap). */
export function toReport(err: unknown, seen: Set<string>, where?: { source?: string; line?: number }): ErrorReport | null {
  if (seen.size >= MAX_REPORTS) return null;
  const e = err as { name?: string; message?: unknown; stack?: unknown; status?: unknown } | null;
  if (e && typeof e === "object" && e.name === "ApiError") return null; // server already knows
  const raw = e && typeof e === "object" && typeof e.message === "string" ? `${e.name && e.name !== "Error" ? `${e.name}: ` : ""}${e.message}` : String(err);
  const message = raw.replace(/\s+/g, " ").trim().slice(0, 150);
  if (!message || NOISE.test(message) || seen.has(message)) return null;
  seen.add(message);
  // First app frame of the stack, so the owner sees roughly where (file:line), not just what.
  const frame = typeof e?.stack === "string" ? /\/assets\/([\w.-]+):(\d+)/.exec(e.stack) : null;
  const source = where?.source || (frame ? frame[1] : undefined);
  const line = where?.line || (frame ? Number(frame[2]) : undefined);
  return { message, ...(source ? { source } : {}), ...(line ? { line } : {}) };
}

const seen = new Set<string>();

export function reportError(err: unknown, where?: { source?: string; line?: number }): void {
  const report = toReport(err, seen, where);
  if (!report) return;
  try {
    const initData = window.Telegram?.WebApp?.initData ?? "";
    void fetch("/api/v2/client-error", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", ...(initData ? { Authorization: `tma ${initData}` } : {}) },
      body: JSON.stringify(report),
    }).catch(() => {});
  } catch { /* reporting must never throw */ }
}

export function installErrorReporting(): void {
  window.addEventListener("error", (ev) => reportError(ev.error ?? ev.message, { source: ev.filename?.split("/").pop(), line: ev.lineno }));
  window.addEventListener("unhandledrejection", (ev) => reportError(ev.reason));
}
