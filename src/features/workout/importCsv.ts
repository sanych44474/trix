// Importing workouts from a CSV export (Strong, Hevy, ...), shared by the bot's document upload
// and the Mini App's import. Moved from bot/importCsv.ts.
import { getWorkoutLog, upsertWorkoutLog } from "../../adapters/d1/v2Workouts";
import { isoWeekday } from "../../domain/atrisk";
import { parseWorkoutCsv, type ImportedDay } from "../../domain/csvImport";
import type { Lang, Weekday } from "../../types";
import { t } from "../../locales/i18n";

// A CSV this large is either years of history (fine, just cap it) or not actually a workout
// export -- either way, keep one invocation's D1 writes comfortably bounded.
export const MAX_FILE_BYTES = 3 * 1024 * 1024;
export const MAX_DAYS_IMPORTED = 200;

export type ImportResult = { imported: number; skipped: number; capped: boolean; format: "strong" | "hevy" };

/** Import a Strong/Hevy CSV export: only dates without a log are written. Null = not a workout CSV. */
export async function importWorkoutCsv(db: D1Database, userId: number, lang: Lang, raw: string): Promise<ImportResult | null> {
  const text = raw.replace(/^\uFEFF/, ""); // strip a UTF-8 BOM if present
  const parsed = parseWorkoutCsv(text);
  if (!parsed || !parsed.days.length) return null;
  let days: ImportedDay[] = [...parsed.days].sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first
  const capped = days.length > MAX_DAYS_IMPORTED;
  days = days.slice(0, MAX_DAYS_IMPORTED);
  const sourceTag = t(lang, parsed.format === "strong" ? "import_tag_strong" : "import_tag_hevy");
  let imported = 0;
  let skipped = 0;
  for (const day of days) {
    const existing = await getWorkoutLog(db, userId, day.date);
    if (existing) { skipped++; continue; }
    const notes = [sourceTag, day.notes].filter(Boolean).join(" — ");
    await upsertWorkoutLog(db, userId, day.date, isoWeekday(day.date) as Weekday, day.exercises, true, notes);
    imported++;
  }
  return { imported, skipped, capped, format: parsed.format };
}
