// Weight trend on the Progress screen: a line on a real kg scale with the top/bottom values,
// the first/last dates, a dashed goal line, and the tapped (default: latest) weigh-in spelled out
// — the old chart was bare dots with no scale, so nobody could tell what they meant.
import { useState } from "react";
import { t, type Lang } from "./i18n";
import { weightChartModel, type WeightPoint } from "./logic/weightChart";

const kgFmt = (n: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(n);
const dayFmt = (lang: Lang, iso: string) =>
  new Intl.DateTimeFormat(lang === "uk" ? "uk-UA" : "en-GB", { day: "numeric", month: "short" }).format(new Date(`${iso}T12:00:00`));

export function WeightChart({ lang, points, goal, slopePerWeek }: { lang: Lang; points: WeightPoint[]; goal?: number; slopePerWeek?: number }) {
  const model = weightChartModel(points, goal);
  const [sel, setSel] = useState<number | null>(null);
  if (!model) return null;
  const idx = sel ?? model.pts.length - 1;
  const p = model.pts[idx]!;
  const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${kgFmt(Math.abs(n))}`;
  return <div className="wchart">
    <div className="wchart-summary">
      <span>{t(lang, "wc_change", { delta: signed(model.deltaKg), days: model.spanDays })}</span>
      {typeof slopePerWeek === "number" && <span>{t(lang, "wc_per_week", { n: signed(Math.round(slopePerWeek * 10) / 10) })}</span>}
      {goal ? <span>{t(lang, "goal_kg", { n: kgFmt(goal) })}</span> : null}
    </div>
    <div className="wchart-plot">
      <span className="wchart-y top">{kgFmt(model.max)}</span>
      <span className="wchart-y bottom">{kgFmt(model.min)}</span>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {model.goalY !== undefined && <line className="wchart-goal" x1="0" x2="100" y1={100 - model.goalY} y2={100 - model.goalY} vectorEffect="non-scaling-stroke" />}
        <polyline points={model.pts.map((q) => `${q.x},${100 - q.y}`).join(" ")} vectorEffect="non-scaling-stroke" />
      </svg>
      {model.pts.map((q, i) => <button type="button" key={q.date} className={`wchart-dot${i === idx ? " on" : ""}`} style={{ left: `${q.x}%`, bottom: `${q.y}%` }} aria-label={`${dayFmt(lang, q.date)}: ${kgFmt(q.kg)} kg`} onClick={() => setSel(i)} />)}
    </div>
    <div className="wchart-x"><span>{dayFmt(lang, model.pts[0]!.date)}</span><span>{dayFmt(lang, model.pts[model.pts.length - 1]!.date)}</span></div>
    <div className="wchart-pick"><strong>{kgFmt(p.kg)} kg</strong><span>{dayFmt(lang, p.date)}</span><small>{t(lang, "wc_tap_hint")}</small></div>
  </div>;
}
