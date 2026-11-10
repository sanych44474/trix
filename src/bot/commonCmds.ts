// Small shared bot pieces: the language default and callback event naming.
import type { Lang } from "../types";


export function defaultLang(code?: string): Lang {
  return code?.toLowerCase().startsWith("uk") ? "uk" : "en";
}

// Reduce a callback_data string to a stable analytics key: drop numeric ids and dates, keep the
// first two meaningful segments. "cl:123:plan"→"cl:plan", "vid:pick:0"→"vid:pick", "menu:plan" stays.
export function normalizeEvent(data: string): string {
  const parts = data.split(":").filter((p) => p && !/^\d+$/.test(p) && !/^\d{4}-\d{2}-\d{2}$/.test(p));
  return parts.slice(0, 2).join(":") || "other";
}
