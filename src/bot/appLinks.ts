// Mini App links and the timezone shortlist: leaf data every keyboard builder needs, kept out of
// bot.ts so keyboards (and through them the Telegram context) do not import the whole bot.
import { APP_VERSION } from "../webapp/appVersion";

export const COMMON_TZ = [
  "Europe/Kyiv",
  "Europe/Warsaw",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "UTC",
];

// Mini App base URL, captured once in createBot so pure keyboard builders can use it without
// threading env through every call site. Undefined (e.g. local dev) hides the dashboard buttons.
export let APP_URL: string | undefined;

export let APP_PATH = "/app";

// Setter so the extracted router module can populate this module-owned binding at bot startup
// (an imported binding can't be assigned to across modules).
export function setAppUrl(v: string | undefined, path = "/app"): void {
  APP_URL = v;
  APP_PATH = path === "/app-v2" ? "/app-v2" : "/app";
}

export function dashboardUrl(): string | undefined {
  return APP_URL ? `${APP_URL}${APP_PATH}?v=${APP_VERSION}` : undefined;
}
