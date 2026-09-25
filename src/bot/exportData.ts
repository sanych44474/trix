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
import type { BodyLogDoc, Lang, PlanDoc, StrengthRecordDoc, UserDoc } from "../types";
import { loadActivityWindow } from "../adapters/d1/v2Admin";
import { listStrength } from "../adapters/d1/v2Workouts";
import { getActivePlan } from "../adapters/d1/v2Plans";
import { listActiveInjuries } from "../adapters/d1/v2Tracking";
import { listAchievements } from "../adapters/d1/v2Gamification";
import { e1rm } from "../domain/records";
import { formatRecordBest, formatSetEntry, localParts } from "../domain/progression";
import { t } from "../locales/i18n";
import { BODY_FIELDS, bodyFieldLabel, renderBodyDynamics, reportNutritionLine } from "./report";
import { generatePlan } from "./plan";
import { areaLabelKey } from "./injury";
import { badgeLabel } from "../features/gamification/boards";
import { weekdayName } from "../render";
import { type MyContext, reply } from "../adapters/telegram/context";
import { menuBtn, num } from "../bot";

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

// The date a strength PR was set: the most recent history entry that hit the stored best
// (by reps metric); falls back to the record's updatedAt for time/distance lifts.
export function prDate(r: StrengthRecordDoc): string {
  if (r.metric === "reps") {
    const hit = r.history.filter((h) => h.weight === r.bestWeight && h.reps === r.bestReps);
    if (hit.length) return hit[hit.length - 1].date;
  }
  return r.updatedAt ? new Date(r.updatedAt).toISOString().slice(0, 10) : "—";
}

// One readable body-log line: weight + only the non-empty measurements, with units.
export function bodyExportLine(lang: Lang, b: BodyLogDoc): string {
  const parts: string[] = [];
  if (b.weight) parts.push(`${b.weight} ${t(lang, "unit_kg")}`);
  const m = b.measurements ?? {};
  for (const f of BODY_FIELDS) {
    const v = m[f.key];
    if (typeof v === "number" && v > 0) parts.push(`${bodyFieldLabel(lang, f)} ${v} cm`);
  }
  return parts.join(" · ");
}

// The active plan's weekly split, one line per day, for the export's Markdown body. `null` (no
// active plan) is handled by the caller — this only formats a plan that exists.
export function planExportLines(lang: Lang, plan: PlanDoc): string[] {
  const out: string[] = [];
  for (const day of [...plan.split].sort((a, b) => a.weekday - b.weekday)) {
    out.push(`### ${weekdayName(lang, day.weekday)} — ${day.muscleGroup}`);
    for (const ex of day.exercises) out.push(`- ${ex.name}: ${ex.sets} · ${ex.startWeight}`);
    out.push("");
  }
  return out;
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

// Build the full markdown export for a user — ctx-free so both the bot (/export) and the Mini
// App settings screen can produce it (the app pushes it as a document via the Bot API).
export async function buildExportMd(db: D1Database, user: UserDoc): Promise<string | null> {
  const lang = user.lang;
  const uid = user._id;
  const [{ workouts, nutrition, body, strength, steps, water, checkins }, plan, injuries, badges] = await Promise.all([
    loadActivityWindow(db, uid, "0000-01-01"),
    getActivePlan(db, uid).catch(() => null),
    listActiveInjuries(db, uid).catch(() => []),
    listAchievements(db, uid).catch(() => []),
  ]);
  // A freshly onboarded user with a plan and nothing logged yet still has exportable data — the
  // plan itself. This used to bail to "nothing to export" the moment before their first log.
  if (!workouts.length && !nutrition.length && !body.length && !strength.length && !steps.length && !water.length && !checkins.length && !plan && !injuries.length && !badges.length) {
    return null;
  }
  const name = user.profile.name ?? `id ${uid}`;
  const today = localParts(user.profile.timezone).date;
  const out: string[] = [`# ${t(lang, "export_title", { name, date: today })}`, ""];

  // ---- Summary ----
  out.push(`## ${t(lang, "export_summary")}`, "");
  const done = workouts.filter((w) => w.completed).length;
  const skipped = workouts.length - done;
  out.push(`- ${t(lang, "report_label_workouts")}: ${done} ✅ · ${skipped} ⏭️`);
  out.push(`- ${t(lang, "report_label_nutrition")}: ${reportNutritionLine(lang, nutrition, user.nutrition?.calories ?? "—")}`);
  out.push(`- ${t(lang, "report_label_body")}: ${renderBodyDynamics(lang, body)}`);
  if (steps.length) out.push(`- ${t(lang, "report_label_steps")}: ${Math.round(steps.reduce((s, l) => s + l.steps, 0) / steps.length)} (avg, ${steps.length}d)`);
  if (water.length) out.push(`- ${t(lang, "menu_water")}: ${Math.round(water.reduce((s, l) => s + l.ml, 0) / water.length)} ml (avg, ${water.length}d)`);
  if (checkins.length) {
    const avg = (sel: (c: (typeof checkins)[number]) => number) => (checkins.reduce((s, c) => s + sel(c), 0) / checkins.length).toFixed(1);
    out.push(`- ${t(lang, "report_label_wellbeing")}: ${t(lang, "report_wellbeing_line", { n: checkins.length, energy: avg((c) => c.energy), sleep: avg((c) => c.sleep), stress: avg((c) => c.stress) })}`);
  }
  out.push("");

  // ---- Active plan ----
  if (plan) {
    out.push(`## ${t(lang, "export_plan")}`, "");
    out.push(...planExportLines(lang, plan));
  }

  // ---- Injuries (active only — resolved ones are history, not a current concern) ----
  if (injuries.length) {
    out.push(`## ${t(lang, "export_injuries")}`, "");
    for (const inj of injuries) out.push(`- ${t(lang, areaLabelKey(inj.area))} (${t(lang, inj.severity === "strong" ? "inj_sev_strong" : "inj_sev_mild")})`);
    out.push("");
  }

  // ---- Badges ----
  if (badges.length) {
    out.push(`## ${t(lang, "export_badges")}`, "");
    out.push(badges.map((c) => badgeLabel(lang, c)).join(", "), "");
  }

  // ---- Personal records (dated) ----
  if (strength.length) {
    out.push(`## ${t(lang, "report_label_strength")} (${t(lang, "export_records")})`, "");
    for (const s of strength) {
      const e = s.metric === "reps" && s.bestWeight > 0 ? ` · e1RM ${Math.round(e1rm(s.bestWeight, s.bestReps))} ${t(lang, "unit_kg")}` : "";
      out.push(`- ${s.exercise} — ${formatRecordBest(s)}${e} · ${prDate(s)}`);
    }
    out.push("");
  }

  // ---- Daily log ----
  out.push(`## ${t(lang, "export_dailylog")}`, "");
  if (workouts.length) {
    out.push(`### ${t(lang, "report_label_workouts")}`, "");
    for (const w of workouts) {
      const detail = w.completed
        ? `${w.exercises.map((ex) => `${ex.name} ${ex.setsDone.map(formatSetEntry).join("/")}`).join("; ")}`
        : t(lang, "export_skipped");
      out.push(`- ${w.date} — ${detail}`);
    }
    out.push("");
  }
  if (nutrition.length) {
    out.push(`### ${t(lang, "report_label_nutrition")}`, "");
    for (const n of nutrition) {
      const tot = n.meals.reduce((a, m) => ({ k: a.k + num(m.kcal), p: a.p + num(m.protein), f: a.f + num(m.fats), c: a.c + num(m.carbs) }), { k: 0, p: 0, f: 0, c: 0 });
      out.push(`- ${n.date} — ${tot.k} ${t(lang, "unit_kcal")} · P${tot.p} F${tot.f} C${tot.c}`);
    }
    out.push("");
  }
  if (body.length) {
    out.push(`### ${t(lang, "report_label_body")}`, "");
    for (const b of body) out.push(`- ${b.date} — ${bodyExportLine(lang, b)}`);
    out.push("");
  }
  if (steps.length) {
    out.push(`### ${t(lang, "report_label_steps")}`, "");
    for (const l of steps) out.push(`- ${l.date} — ${l.steps}`);
    out.push("");
  }
  if (water.length) {
    out.push(`### ${t(lang, "menu_water")}`, "");
    for (const l of water) out.push(`- ${l.date} — ${l.ml} ml`);
    out.push("");
  }
  if (checkins.length) {
    out.push(`### ${t(lang, "report_label_wellbeing")}`, "");
    for (const c of checkins) out.push(`- ${c.date} — energy ${c.energy}/5 · sleep ${c.sleep}/5 · stress ${c.stress}/5`);
    out.push("");
  }

  return "﻿" + out.join("\n");
}

// Same underlying data as buildExportMd, serialized as portable JSON instead of prose — for a
// user who wants to move their history into a spreadsheet or another app rather than just read
// it. Offered alongside the Markdown export, not instead of it.
export async function buildExportJson(db: D1Database, user: UserDoc): Promise<string | null> {
  const [snapshot, plan, injuries, achievements] = await Promise.all([
    loadActivityWindow(db, user._id, "0000-01-01"),
    getActivePlan(db, user._id).catch(() => null),
    listActiveInjuries(db, user._id).catch(() => []),
    listAchievements(db, user._id).catch(() => []),
  ]);
  const { workouts, nutrition, body, strength, steps, water, checkins } = snapshot;
  // Same reasoning as buildExportMd: a plan/injury/badge with no logged activity yet is still
  // exportable data, not "nothing to export."
  if (!workouts.length && !nutrition.length && !body.length && !strength.length && !steps.length && !water.length && !checkins.length && !plan && !injuries.length && !achievements.length) {
    return null;
  }
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      profile: { name: user.profile.name, timezone: user.profile.timezone, goal: user.profile.goal, level: user.profile.level },
      plan,
      injuries,
      achievements,
      ...snapshot,
    },
    null,
    2,
  );
}
