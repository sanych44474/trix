// CSV import from third-party trackers (Strong, Hevy) -- the receiving side. Parsing itself is
// pure (domain/csvImport.ts, unit-tested); this module is the Telegram plumbing: prompt -> file
// upload -> parse -> write only the dates that don't already have a log (never clobber a real one).
import { getWorkoutLog, updateUser, upsertWorkoutLog } from "../db/repos";
import { isoWeekday } from "../domain/atrisk";
import { parseWorkoutCsv, type ImportedDay } from "../domain/csvImport";
import type { Weekday } from "../types";
import { t } from "../locales/i18n";
import { type MyContext, downloadFile, menuBtn, reply } from "../bot";

// A CSV this large is either years of history (fine, just cap it) or not actually a workout
// export -- either way, keep one invocation's D1 writes comfortably bounded.
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_DAYS_IMPORTED = 200;

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

async function runImport(ctx: MyContext, fileId: string): Promise<void> {
  const lang = ctx.user.lang;
  try {
    const buf = await downloadFile(ctx, fileId);
    const text = new TextDecoder("utf-8").decode(buf).replace(/^\uFEFF/, ""); // strip a UTF-8 BOM if present
    const parsed = parseWorkoutCsv(text);
    if (!parsed || !parsed.days.length) {
      await reply(ctx, t(lang, "import_wrong_format"), menuBtn(lang));
      return;
    }

    let days: ImportedDay[] = [...parsed.days].sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first
    const capped = days.length > MAX_DAYS_IMPORTED;
    days = days.slice(0, MAX_DAYS_IMPORTED);

    let imported = 0;
    let skipped = 0;
    for (const day of days) {
      const existing = await getWorkoutLog(ctx.db, ctx.user._id, day.date);
      if (existing) { skipped++; continue; }
      const sourceTag = t(lang, parsed.format === "strong" ? "import_tag_strong" : "import_tag_hevy");
      const notes = [sourceTag, day.notes].filter(Boolean).join(" — ");
      await upsertWorkoutLog(ctx.db, ctx.user._id, day.date, isoWeekday(day.date) as Weekday, day.exercises, true, notes);
      imported++;
    }

    const key = capped ? "import_done_capped" : "import_done";
    await reply(ctx, t(lang, key, { imported, skipped, cap: MAX_DAYS_IMPORTED }), menuBtn(lang));
  } catch (err) {
    console.error("csv import failed", ctx.user._id, err);
    await reply(ctx, t(lang, "import_failed"), menuBtn(lang)).catch(() => {});
  }
}
