// Client-card helpers for the trainer view. Pure — the share-with-trainer permission gate,
// birthday parsing/formatting, and anthropometry line rendering. No DB, no i18n, no clock:
// callers pass todayIso and label strings, so everything is deterministic and unit-testable.

import type { UserProfile } from "../types";

export type ShareKey = "body" | "health";

/** Strict opt-in: only an explicit `true` grants visibility (absent/false = hidden). */
export function trainerCanSee(profile: UserProfile, key: ShareKey): boolean {
  return profile.shareWithTrainer?.[key] === true;
}

/** Parse trainer input "DD.MM.YYYY", "DD.MM" or "YYYY-MM-DD" into the canonical stored form:
 * "YYYY-MM-DD" (year known) or "MM-DD" (year unknown). Rejects impossible calendar dates
 * (a yearless 29.02 validates against a leap year) and years outside 1920..current year.
 * Returns null on anything invalid. */
export function parseBirthdayInput(text: string, todayIso: string): string | null {
  const s = text.trim();
  let year: number | null = null;
  let month: number;
  let day: number;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s))) {
    day = Number(m[1]); month = Number(m[2]); year = Number(m[3]);
  } else if ((m = /^(\d{1,2})\.(\d{1,2})$/.exec(s))) {
    day = Number(m[1]); month = Number(m[2]);
  } else if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) {
    year = Number(m[1]); month = Number(m[2]); day = Number(m[3]);
  } else {
    return null;
  }
  if (year !== null && (year < 1920 || year > Number(todayIso.slice(0, 4)))) return null;
  // Round-trip through Date.UTC to reject impossible dates (31.02 rolls to March, etc.).
  const checkYear = year ?? 2000; // 2000 is a leap year — allows a yearless 29.02
  const d = new Date(Date.UTC(checkYear, month - 1, day));
  if (d.getUTCFullYear() !== checkYear || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  const mmdd = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return year !== null ? `${year}-${mmdd}` : mmdd;
}

/** Presentation data for a stored canonical birthday. `todayIso` is the clock (UTC date math,
 * never Date.now()). age is exact — counted up only once the birthday has passed this year —
 * and only present when the year is known. daysUntil is the distance to the next occurrence
 * (0 = today), wrapping over New Year; a 02-29 birthday counts as 03-01 in non-leap years. */
export function birthdayInfo(stored: string, todayIso: string): { display: string; age?: number; daysUntil: number } {
  const hasYear = stored.length > 5;
  const year = hasYear ? Number(stored.slice(0, 4)) : null;
  const mmdd = hasYear ? stored.slice(5) : stored;
  const month = Number(mmdd.slice(0, 2));
  const day = Number(mmdd.slice(3, 5));
  const display = year !== null ? `${mmdd.slice(3, 5)}.${mmdd.slice(0, 2)}.${year}` : `${mmdd.slice(3, 5)}.${mmdd.slice(0, 2)}`;
  const today = Date.parse(`${todayIso}T00:00:00Z`);
  const curYear = Number(todayIso.slice(0, 4));
  // Date.UTC normalizes 02-29 in a non-leap year to 03-01 automatically.
  const thisYear = Date.UTC(curYear, month - 1, day);
  const next = thisYear >= today ? thisYear : Date.UTC(curYear + 1, month - 1, day);
  const daysUntil = Math.round((next - today) / 86_400_000);
  if (year === null) return { display, daysUntil };
  const age = curYear - year - (thisYear <= today ? 0 : 1);
  return { display, age, daysUntil };
}

export interface AnthroLabels { height: string; weight: string; age: string; sex: string; goalWeight: string; waist: string; chest: string; hips: string; arm: string; thigh: string; male: string; female: string; }

/** "• {label}: {value}" bullet lines from the profile's anthropometry; absent fields are
 * skipped, so an empty profile yields []. Units: cm (height, circumferences), kg (weights). */
export function anthroLines(profile: UserProfile, labels: AnthroLabels): string[] {
  const lines: string[] = [];
  const push = (label: string, value: string | undefined) => {
    if (value !== undefined) lines.push(`• ${label}: ${value}`);
  };
  push(labels.height, profile.heightCm !== undefined ? `${profile.heightCm} cm` : undefined);
  push(labels.weight, profile.weightKg !== undefined ? `${profile.weightKg} kg` : undefined);
  push(labels.age, profile.age !== undefined ? `${profile.age}` : undefined);
  push(labels.sex, profile.sex !== undefined ? (profile.sex === "male" ? labels.male : labels.female) : undefined);
  push(labels.goalWeight, profile.goalWeight !== undefined ? `${profile.goalWeight} kg` : undefined);
  const ms = profile.measurements;
  push(labels.waist, ms?.waist !== undefined ? `${ms.waist} cm` : undefined);
  push(labels.chest, ms?.chest !== undefined ? `${ms.chest} cm` : undefined);
  push(labels.hips, ms?.hips !== undefined ? `${ms.hips} cm` : undefined);
  push(labels.arm, ms?.arm !== undefined ? `${ms.arm} cm` : undefined);
  push(labels.thigh, ms?.thigh !== undefined ? `${ms.thigh} cm` : undefined);
  return lines;
}
