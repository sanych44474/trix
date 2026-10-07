// CSV import from third-party trackers (Strong, Hevy) -- the receiving side. Parsing itself is
// pure (domain/csvImport.ts, unit-tested); this module is the Telegram plumbing: prompt -> file
// upload -> parse -> write only the dates that don't already have a log (never clobber a real one).
import { getWorkoutLog, upsertWorkoutLog } from "../adapters/d1/v2Workouts";
import { updateUser } from "../adapters/d1/v2Users";
import { isoWeekday } from "../domain/atrisk";
import { parseWorkoutCsv, type ImportedDay } from "../domain/csvImport";
import type { Lang, Weekday } from "../types";
import { t } from "../locales/i18n";
import { type MyContext, reply } from "../adapters/telegram/context";
import { downloadFile } from "./telegramFiles";
import { menuBtn } from "./keyboards";

// A CSV this large is either years of history (fine, just cap it) or not actually a workout
// export -- either way, keep one invocation's D1 writes comfortably bounded.
export const MAX_FILE_BYTES = 3 * 1024 * 1024;
export const MAX_DAYS_IMPORTED = 200;

export async function cmdImport(ctx: MyContext) {
  const lang = ctx.user.lang;
  ctx.user.session = { ...ctx.user.session, mode: "awaiting_import" };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });
  await reply(ctx, t(lang, "import_prompt"), menuBtn(lang));
}

export async function handleImportDocument(ctx: MyContext) {
  const lang = ctx.user.lang;
  const doc = ctx.message?.document;
  if (!doc) return;
  if (ctx.user.session.mode !== "awaiting_import") {
    await reply(ctx, t(lang, "import_hint"));
    return;
  }
  ctx.user.session = { ...ctx.user.session, mode: "idle" };
  await updateUser(ctx.db, ctx.user._id, { session: ctx.user.session });

  const name = (doc.file_name ?? "").toLowerCase();
  const looksLikeCsv = name.endsWith(".csv") || doc.mime_type === "text/csv" || doc.mime_type === "text/comma-separated-values";
  if (!looksLikeCsv) {
    await reply(ctx, t(lang, "import_wrong_format"), menuBtn(lang));
    return;
  }
  if ((doc.file_size ?? 0) > MAX_FILE_BYTES) {
    await reply(ctx, t(lang, "import_too_big"), menuBtn(lang));
    return;
  }

  await reply(ctx, t(lang, "import_processing"));
  ctx.waitUntil(runImport(ctx, doc.file_id));
}

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

async function runImport(ctx: MyContext, fileId: string): Promise<void> {
  const lang = ctx.user.lang;
  try {
    const buf = await downloadFile(ctx, fileId);
    const result = await importWorkoutCsv(ctx.db, ctx.user._id, lang, new TextDecoder("utf-8").decode(buf));
    if (!result) {
      await reply(ctx, t(lang, "import_wrong_format"), menuBtn(lang));
      return;
    }
    const key = result.capped ? "import_done_capped" : "import_done";
    await reply(ctx, t(lang, key, { imported: result.imported, skipped: result.skipped, cap: MAX_DAYS_IMPORTED }), menuBtn(lang));
  } catch (err) {
    console.error("csv import failed", ctx.user._id, err);
    await reply(ctx, t(lang, "import_failed"), menuBtn(lang)).catch(() => {});
  }
}
