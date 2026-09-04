// Rolling-window user report (/report): workouts, nutrition, steps, body dynamics, strength,
// wellbeing, plus an optional AI narrative. Extracted from bot.ts (god-file split; same barrel
// seam via bot.ts's `export * from "./bot/report"`).
import type { BodyLogDoc, Lang } from "../types";
import { getActivePlan, loadActivityWindow, nutritionLogsSince } from "../db/repos";
import { localParts } from "../domain/progression";
import { escapeHtml, t } from "../locales/i18n";
import { aiText } from "../ai";
import * as P from "../ai/prompts";
import { type MyContext, REPORT_DAYS, menuBtn, num, reply } from "../bot";

export function localCutoff(timezone: string | undefined, days: number): string {
  const { date } = localParts(timezone);
  return new Date(Date.parse(date) - days * 86_400_000).toISOString().slice(0, 10);
}

// Average daily nutrition over the logged days, as a localized report line.
export function reportNutritionLine(
  lang: Lang,
  logs: Awaited<ReturnType<typeof nutritionLogsSince>>,
  goalKcal: number | string,
): string {
  if (!logs.length) return t(lang, "report_no_nutrition");
  const agg = logs.reduce(
    (a, log) => {
      const d = log.meals.reduce(
        (s, m) => ({ kcal: s.kcal + num(m.kcal), p: s.p + num(m.protein), f: s.f + num(m.fats), c: s.c + num(m.carbs) }),
        { kcal: 0, p: 0, f: 0, c: 0 },
      );
      return { kcal: a.kcal + d.kcal, p: a.p + d.p, f: a.f + d.f, c: a.c + d.c };
    },
    { kcal: 0, p: 0, f: 0, c: 0 },
  );
  const n = logs.length;
  return t(lang, "report_nutrition_line", {
    n,
    days: REPORT_DAYS,
    kcal: Math.round(agg.kcal / n),
    p: Math.round(agg.p / n),
    f: Math.round(agg.f / n),
    c: Math.round(agg.c / n),
    goalkcal: goalKcal,
  });
}

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

export const BODY_FIELDS: { key: keyof NonNullable<BodyLogDoc["measurements"]>; en: string; uk: string }[] = [
  { key: "waist", en: "waist", uk: "талія" },
  { key: "chest", en: "chest", uk: "груди" },
  { key: "arm", en: "arm", uk: "рука" },
  { key: "hips", en: "hips", uk: "стегна" },
  { key: "thigh", en: "thigh", uk: "нога" },
];

// Localized label for a body-measurement field.
export function bodyFieldLabel(lang: Lang, f: { en: string; uk: string }): string {
  return lang === "uk" ? f.uk : f.en;
}

export function renderBodyDynamics(lang: Lang, bodyAsc: BodyLogDoc[]): string {
  if (!bodyAsc.length) return t(lang, "report_no_body");
  const first = bodyAsc[0];
  const last = bodyAsc[bodyAsc.length - 1];
  const segs: string[] = [];
  const fmtDelta = (a?: number, b?: number) => {
    if (a === undefined || b === undefined) return undefined;
    const d = +(b - a).toFixed(1);
    const sign = d > 0 ? "+" : "";
    return `${b}${d !== 0 ? ` (${sign}${d})` : ""}`;
  };
  const wLabel = lang === "uk" ? "вага" : "weight";
  const w = fmtDelta(first.weight, last.weight) ?? (last.weight ? `${last.weight}` : undefined);
  if (w) segs.push(`${wLabel} ${w}kg`);
  for (const f of BODY_FIELDS) {
    const v = fmtDelta(first.measurements?.[f.key], last.measurements?.[f.key]);
    if (v) segs.push(`${bodyFieldLabel(lang, f)} ${v}cm`);
  }
  return segs.length ? segs.join(", ") : t(lang, "report_no_body");
}
