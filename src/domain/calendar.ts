// Calendar month grid + day markers — pure, no DB. Powers the inline-keyboard month view for
// both the user (plan/log/session at a glance) and the trainer (session counts).
import type { Lang } from "../types";

function isoWeekday(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return ((d.getUTCDay() + 6) % 7) + 1; // 1 = Mon … 7 = Sun
}

/** "YYYY-MM" of a "YYYY-MM-DD". */
export function ymOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}

export function nextMonth(ym: string): string {
  let [y, m] = ym.split("-").map(Number);
  m++;
  if (m > 12) { m = 1; y++; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function prevMonth(ym: string): string {
  let [y, m] = ym.split("-").map(Number);
  m--;
  if (m < 1) { m = 12; y--; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

function daysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Weeks (Monday-first) of ISO date strings for the month, with null padding to full weeks. */
export function monthGrid(ym: string): (string | null)[][] {
  const [y, m] = ym.split("-").map(Number);
  const dim = daysInMonth(ym);
  const firstIdx = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // 0 = Mon … 6 = Sun
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstIdx; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(`${ym}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_UK = ["Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень", "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"];

export function monthTitle(ym: string, lang: Lang): string {
  const [y, m] = ym.split("-").map(Number);
  return `${(lang === "uk" ? MONTHS_UK : MONTHS_EN)[m - 1]} ${y}`;
}

export interface DayCtx {
  today: string;
  plannedWeekdays: Set<number>;
  logs: Map<string, { completed: boolean }>;
}

/**
 * Button label for a day cell. Priority: ✅ completed > ✖️ missed planned past >
 * • planned future > plain number. Today is wrapped in [brackets] (keeping any marker).
 */
export function dayMarker(date: string, ctx: DayCtx): string {
  const n = String(Number(date.slice(8, 10)));
  let symbol = "";
  const planned = ctx.plannedWeekdays.has(isoWeekday(date));
  const log = ctx.logs.get(date);
  if (log?.completed) symbol = "✅";
  else if (planned && date < ctx.today) symbol = "✖️";
  else if (planned) symbol = "•";
  const core = `${symbol}${n}`;
  return date === ctx.today ? `[${core}]` : core;
}
