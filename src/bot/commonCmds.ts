// Small shared bot pieces: the report window, language default, callback event naming, and the
// coach and feedback entry commands.
import type { Lang } from "../types";
import { t } from "../locales/i18n";
import { reply, setMode, type MyContext } from "../adapters/telegram/context";

export const REPORT_DAYS = 14;

export function defaultLang(code?: string): Lang {
  return code?.toLowerCase().startsWith("uk") ? "uk" : "en";
}

// Reduce a callback_data string to a stable analytics key: drop numeric ids and dates, keep the
// first two meaningful segments. "cl:123:plan"→"cl:plan", "vid:pick:0"→"vid:pick", "menu:plan" stays.
export function normalizeEvent(data: string): string {
  const parts = data.split(":").filter((p) => p && !/^\d+$/.test(p) && !/^\d{4}-\d{2}-\d{2}$/.test(p));
  return parts.slice(0, 2).join(":") || "other";
}

export async function cmdCoach(ctx: MyContext) {
  await setMode(ctx, "coach");
  await reply(ctx, t(ctx.user.lang, "coach_prompt"));
}

export async function cmdFeedback(ctx: MyContext) {
  await setMode(ctx, "feedback");
  await reply(ctx, t(ctx.user.lang, "feedback_prompt"));
}
