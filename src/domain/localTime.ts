// Local calendar time for a user's IANA timezone (date, weekday, hour) and quiet-hours checks.
// Split out of progression.ts: nothing here is about training. Pure.
import type { Weekday } from "../types";

export interface LocalParts {
  date: string; // YYYY-MM-DD
  weekday: Weekday; // 1=Mon … 7=Sun
  hour: number; // 0..23
  minute: number; // 0..59
}

/** Current local date/weekday/hour/minute for an IANA timezone (defaults to UTC). */
// Do-not-disturb window check. from/to are local hours (0..23); a window may wrap past midnight
// (e.g. 22→7). Undefined bounds = quiet hours off. `to` is exclusive.
export function inQuietHours(hour: number, from?: number, to?: number): boolean {
  if (from === undefined || to === undefined || from === to) return false;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

export function localParts(timezone?: string, now: Date = new Date()): LocalParts {
  const tz = timezone || "UTC";
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "short",
    });
  } catch {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "short",
    });
  }
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0; // some runtimes emit "24" for midnight
  const minute = parseInt(get("minute"), 10) || 0;
  const wmap: Record<string, Weekday> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
  };
  const weekday = wmap[get("weekday")] ?? 1;
  return { date, weekday, hour, minute };
}
