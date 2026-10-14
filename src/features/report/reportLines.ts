// Report building blocks shared by /report, the data export and the trainer's client card:
// the nutrition line and the body-measurement dynamics.
import type { BodyLogDoc, Lang } from "../../types";
import { nutritionLogsSince } from "../../adapters/d1/v2Nutrition";
import { t } from "../../locales/i18n";

export const REPORT_DAYS = 14;
import { num } from "../nutrition/verifyItems";

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

export const BODY_FIELDS: { key: keyof NonNullable<BodyLogDoc["measurements"]>; en: string; uk: string }[] = [
  { key: "waist", en: "waist", uk: "талія" },
  { key: "chest", en: "chest", uk: "груди" },
  { key: "arm", en: "arm", uk: "рука" },
  { key: "hips", en: "hips", uk: "стегна" },
  { key: "thigh", en: "thigh", uk: "нога" },
  { key: "neck", en: "neck", uk: "шия" },
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
