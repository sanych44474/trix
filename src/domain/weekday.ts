// ISO date → weekday (1 = Monday … 7 = Sunday).
import type { Weekday } from "../types";

export function weekdayOf(date: string): Weekday {
  return (((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1) as Weekday;
}
