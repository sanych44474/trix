// Rolling-window user report (/report): workouts, nutrition, steps, body dynamics, strength,
// wellbeing, plus an optional AI narrative. Extracted from bot.ts (god-file split; same barrel
// seam via bot.ts's `export * from "./bot/report"`).
import { loadActivityWindow } from "../adapters/d1/v2Analytics";
import { getActivePlan } from "../adapters/d1/v2Plans";
import { localCutoff } from "../domain/localTime";
import { escapeHtml, t } from "../locales/i18n";
import { aiText } from "../ai";
import * as P from "../ai/prompts";
import { type MyContext, reply } from "../adapters/telegram/context";
import { REPORT_DAYS } from "../features/report/reportLines";
import { menuBtn } from "../adapters/telegram/keyboards";
import { renderBodyDynamics, reportNutritionLine } from "../features/report/reportLines";

export async function cmdReport(ctx: MyContext) {
  const lang = ctx.user.lang;
  const uid = ctx.user._id;
  const cutoff = localCutoff(ctx.user.profile.timezone, REPORT_DAYS);

  const { workouts: workoutLogs, nutrition: nutritionLogs, strength, body: bodyAsc, steps: stepLogs, checkins } =
    await loadActivityWindow(ctx.db, uid, cutoff, { strengthLimit: 4 });

  if (!workoutLogs.length && !nutritionLogs.length && !bodyAsc.length) {
    await reply(ctx, t(lang, "report_no_data"), menuBtn(lang));
    return;
  }

  const done = workoutLogs.filter((w) => w.completed).length;
  const skipped = workoutLogs.filter((w) => !w.completed).length;

  // average nutrition per logged day
  const nutritionLine = reportNutritionLine(lang, nutritionLogs, ctx.user.nutrition?.calories ?? "—");

  // body dynamics: earliest vs latest
  const bodyLine = renderBodyDynamics(lang, bodyAsc);

  // steps: average over logged days vs the plan target
  let stepsLine = t(lang, "report_no_steps");
  if (stepLogs.length) {
    const avg = Math.round(stepLogs.reduce((s, l) => s + l.steps, 0) / stepLogs.length);
    const plan = await getActivePlan(ctx.db, uid);
    stepsLine = t(lang, "report_steps_line", {
      avg,
      n: stepLogs.length,
      target: plan?.stepsTarget ?? "—",
    });
  }

  const parts = [
    t(lang, "report_header", { days: REPORT_DAYS }),
    "",
    `<b>${t(lang, "report_label_workouts")}:</b> ${t(lang, "report_workouts_line", { done, skipped, days: REPORT_DAYS })}`,
    `<b>${t(lang, "report_label_nutrition")}:</b> ${nutritionLine}`,
    `<b>${t(lang, "report_label_steps")}:</b> ${stepsLine}`,
    `<b>${t(lang, "report_label_body")}:</b> ${bodyLine}`,
  ];
  if (strength.length) {
    const lifts = strength
      .map((r) => `${escapeHtml(r.exercise)} ${r.bestWeight || "BW"}×${r.bestReps}`)
      .join(" · ");
    parts.push(`<b>${t(lang, "report_label_strength")}:</b> ${lifts}`);
  }
  if (checkins.length) {
    const avg = (sel: (c: (typeof checkins)[number]) => number) =>
      (checkins.reduce((s, c) => s + sel(c), 0) / checkins.length).toFixed(1);
    parts.push(
      `<b>${t(lang, "report_label_wellbeing")}:</b> ` +
        t(lang, "report_wellbeing_line", {
          n: checkins.length,
          energy: avg((c) => c.energy),
          sleep: avg((c) => c.sleep),
          stress: avg((c) => c.stress),
        }),
    );
  }

  // optional AI narrative
  try {
    const summary = {
      workouts: { done, skipped, days: REPORT_DAYS },
      nutritionAvg: nutritionLine,
      steps: stepsLine,
      strength: strength.map((r) => `${r.exercise} ${r.bestWeight}x${r.bestReps}`),
      body: bodyLine,
    };
    const narrative = await aiText(ctx.env, {
      system: P.reportSystem(lang),
      user: JSON.stringify(summary),
      temperature: 0.6,
      kind: "report",
      db: ctx.db,
      userId: uid,
    });
    parts.push("", `💬 <i>${escapeHtml(narrative)}</i>`);
  } catch {
    /* narrative optional */
  }

  await reply(ctx, parts.join("\n"), menuBtn(lang));
}
