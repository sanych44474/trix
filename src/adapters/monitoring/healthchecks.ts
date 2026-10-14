// Healthchecks.io dead-man's switch for the cron. The in-app heartbeat (checkCronHeartbeat) only
// notices a dead cron when a request happens to come in; this one is watched from outside, so a
// cron that stops firing, or keeps failing, sends the owner an alert even when nobody uses the bot.
//
// Set HEALTHCHECK_PING_URL (a secret) to the check's ping URL, e.g. https://hc-ping.com/<uuid>.
// The check should have Period = 5 minutes and Grace = 10 minutes: a successful run pings every
// fifth minute, and a failed run pings /fail at once. Unset = no pings.

/** Successful runs ping only every this many minutes: plenty for the alert, a fifth of the requests. */
export const HEALTHCHECK_EVERY_MIN = 5;

export type CronOutcome = "ok" | "fail";

/** Whether this cron run should ping: every failure, and successes on every fifth minute. */
export function healthcheckDue(outcome: CronOutcome, scheduledTime: number): boolean {
  return outcome === "fail" || new Date(scheduledTime).getUTCMinutes() % HEALTHCHECK_EVERY_MIN === 0;
}

/** The URL to ping, or null when unset or not an https URL (a typo must not become a fetch). */
export function healthcheckUrl(base: string | undefined, outcome: CronOutcome): string | null {
  const url = base?.trim().replace(/\/+$/, "");
  if (!url?.startsWith("https://")) return null;
  return outcome === "fail" ? `${url}/fail` : url;
}

/** Best effort: never throws and gives up after 5 s, so monitoring can't break or stall the cron.
 *  `detail` (the error, on failure) shows up in the check's event log. */
export async function pingHealthcheck(base: string | undefined, outcome: CronOutcome, detail?: string): Promise<void> {
  const url = healthcheckUrl(base, outcome);
  if (!url) return;
  try {
    await fetch(url, { method: "POST", body: (detail ?? "").slice(0, 1000), signal: AbortSignal.timeout(5000) });
  } catch {
    /* monitoring is best-effort */
  }
}
