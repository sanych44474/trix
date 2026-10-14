// Replan, GDPR delete confirmation prompt, and the full-history markdown export shared by
// /export and the Mini App settings screen. Extracted from bot.ts (god-file split; same barrel
// seam via bot.ts's `export * from "./bot/exportData"`).
//
// Export scope, deliberately NOT full parity with deleteUserData (db/repos/admin.ts): that
// function's ~60 tables include a lot that was never "your data" to hand back in a portability
// export -- internal telemetry (ai_call_logs, idempotency_keys, error_logs, plan_source_logs),
// the DO-cutover dry-run log, squad membership rows, and a trainer-client's counterpart data
// (messages, client notes, questions) that belongs to the OTHER party as much as this one.
// Covered here: activity logs (workouts/nutrition/body/strength/steps/water/checkins, via
// loadActivityWindow), the active training plan, active injuries, and earned badges -- the
// artifacts a user would recognize as "mine" and want to keep or move elsewhere. When a new
// table gets added to deleteUserData, triage it here too ONLY if it fits that same test; if it's
// telemetry or another party's data, it belongs on this exclusion list instead, with a one-line
// reason, so the next reviewer doesn't have to re-derive the decision.
import { InlineKeyboard, InputFile } from "grammy";
import { listStrength } from "../adapters/d1/v2Workouts";
import { formatRecordBest } from "../domain/setFormat";
import { t } from "../locales/i18n";
import { generatePlan } from "./plan";
import { type MyContext, reply } from "../adapters/telegram/context";
import { menuBtn } from "../adapters/telegram/keyboards";
import { buildExportJson, buildExportMd } from "../features/export/exportData";

export async function cmdReplan(ctx: MyContext) {
  const lang = ctx.user.lang;
  if (!ctx.user.onboarded) {
    await reply(ctx, t(lang, "not_onboarded"));
    return;
  }
  await reply(ctx, t(lang, "replanning"));
  const records = await listStrength(ctx.db, ctx.user._id, 8);
  const prs = records.length
    ? records.map((r) => `${r.exercise}: ${formatRecordBest(r)}`).join("\n")
    : undefined;
  await generatePlan(ctx, ctx.user.profile, prs);
}

export async function cmdDeleteMe(ctx: MyContext) {
  const lang = ctx.user.lang;
  const kb = new InlineKeyboard()
    .text(t(lang, "deleteme_btn"), "del:confirm")
    .text(t(lang, "deleteme_cancel"), "del:cancel");
  await reply(ctx, t(lang, "deleteme_confirm"), kb);
}

export async function cmdExport(ctx: MyContext) {
  const lang = ctx.user.lang;
  const md = await buildExportMd(ctx.db, ctx.user);
  if (!md) {
    await reply(ctx, t(lang, "export_none"), menuBtn(lang));
    return;
  }
  const kb = new InlineKeyboard().text(t(lang, "export_json_btn"), "export:json");
  await ctx.replyWithDocument(new InputFile(new TextEncoder().encode(md), "trix-export.md"), {
    caption: t(lang, "export_caption"),
    reply_markup: kb,
  });
}

// "📦 Also get JSON" button on the Markdown export — same underlying data, portable format.
export async function cmdExportJson(ctx: MyContext) {
  const lang = ctx.user.lang;
  const json = await buildExportJson(ctx.db, ctx.user);
  if (!json) {
    await reply(ctx, t(lang, "export_none"), menuBtn(lang));
    return;
  }
  await ctx.replyWithDocument(new InputFile(new TextEncoder().encode(json), "trix-export.json"), {
    caption: t(lang, "export_json_caption"),
  });
}
