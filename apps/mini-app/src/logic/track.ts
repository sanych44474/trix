// Feature-usage counters (POST /api/v2/event): which of the app's features people actually use,
// so the owner can keep what works and drop what doesn't. Batched per tick, fire-and-forget,
// never throws; names must match the server's app_* allowlist (src/webapp/miscApi.ts).
const queue: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

export function track(event: string): void {
  if (!/^app_[a-z0-9_]{2,40}$/.test(event)) return;
  queue.push(event);
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const events = queue.splice(0, 10);
    if (!events.length) return;
    try {
      const initData = window.Telegram?.WebApp?.initData ?? "";
      void fetch("/api/v2/event", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json", ...(initData ? { Authorization: `tma ${initData}` } : {}) },
        body: JSON.stringify({ events }),
      }).catch(() => {});
    } catch { /* tracking is optional */ }
  }, 400);
}
