// CSV import from third-party trackers (Strong, Hevy) -- the receiving side. Parsing itself is
// pure (domain/csvImport.ts, unit-tested); this module is the Telegram plumbing: prompt -> file
// upload -> parse -> write only the dates that don't already have a log (never clobber a real one).
import { updateUser } from "../adapters/d1/v2Users";
import { t } from "../locales/i18n";
import { type MyContext, reply } from "../adapters/telegram/context";
import { downloadFile } from "../adapters/telegram/files";
import { menuBtn } from "../adapters/telegram/keyboards";
import { MAX_DAYS_IMPORTED, MAX_FILE_BYTES, importWorkoutCsv } from "../features/workout/importCsv";

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
