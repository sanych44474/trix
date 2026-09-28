// Per-muscle trend on the Progress screen: fractional weekly sets (main mover 1, assisting ½) for
// the last 12 weeks, one muscle at a time, against that muscle's MEV–MAV band. Opens on the muscle
// lagging furthest behind its minimum over the last four weeks -- the one worth looking at.
import { useMemo, useState } from "react";
import { t, type Key, type Lang } from "./i18n";
import { MUSCLE_LANDMARKS, TRACKED_MUSCLES, weeklyMuscleSeries, type LoggedDay } from "./logic/muscleLoad";

const W = 320;
const H = 150;
const PAD = { top: 8, bottom: 20, left: 4, right: 4 };
/** A bar anchored to the baseline with only its top corners rounded (up to 4px). */
function roundedTop(x: number, base: number, w: number, h: number): string {
  const r = Math.min(4, h / 2, w / 2);
  return `M${x},${base} v${-(h - r)} q0,${-r} ${r},${-r} h${w - 2 * r} q${r},0 ${r},${r} v${h - r} z`;
}
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function MuscleTrend({ lang, logs, today }: { lang: Lang; logs: LoggedDay[]; today: string }) {
  const { weekEnds, series } = useMemo(() => weeklyMuscleSeries(logs, today, 12), [logs, today]);
  const lagging = useMemo(() => {
    let best: { slug: string; ratio: number } | null = null;
    for (const slug of TRACKED_MUSCLES) {
      const mev = MUSCLE_LANDMARKS[slug]?.mev ?? 0;
      if (!mev) continue;
      const ratio = avg(series[slug]!.slice(-4)) / mev;
      if (ratio < 1 && (!best || ratio < best.ratio)) best = { slug, ratio };
    }
    return best?.slug ?? "chest";
  }, [series]);
  const [picked, setPicked] = useState<string | null>(null);
  const [bar, setBar] = useState<number | null>(null);
  const slug = picked ?? lagging;
  const values = series[slug] ?? [];
  const { mev, mav } = MUSCLE_LANDMARKS[slug] ?? { mev: 0, mav: 16 };
  const label = (s: string) => t(lang, `muscle_${s.replace("-", "_")}` as Key);
  const num = (n: number) => { const r = Math.round(n * 2) / 2; return lang === "uk" ? String(r).replace(".", ",") : String(r); };
  const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

  const top = Math.max(mav, ...values) * 1.1 || 1;
  const plotH = H - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const slot = (W - PAD.left - PAD.right) / values.length;
  const barW = Math.max(4, slot - 4); // 4px gap between bars (2px each side)

  const recent = avg(values.slice(-4));
  const before = avg(values.slice(-8, -4));
  const change = before > 0 ? Math.round(((recent - before) / before) * 100) : null;
  const selected = bar !== null ? { v: values[bar]!, from: weekEnds[bar]! } : null;

  return (
    <div className="muscle-trend">
      <label className="body-map-select">
        <span>{t(lang, "trend_pick_label")}</span>
        <select value={slug} onChange={(e) => { setPicked(e.target.value); setBar(null); }}>
          {TRACKED_MUSCLES.map((s) => <option key={s} value={s}>{label(s)} · {num(avg(series[s]!.slice(-4)))}</option>)}
        </select>
      </label>
      <svg viewBox={`0 0 ${W} ${H}`} className="trend-chart" role="img" aria-label={t(lang, "trend_aria", { muscle: label(slug) })}>
        {mev > 0 && <rect x={PAD.left} width={W - PAD.left - PAD.right} y={y(mav)} height={y(mev) - y(mav)} className="trend-band" rx={4} />}
        <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} className="trend-axis" />
        {values.map((v, i) => {
          const x = PAD.left + i * slot + (slot - barW) / 2;
          const h = Math.max(v > 0 ? 3 : 0, y(0) - y(v));
          return (
            <g key={weekEnds[i]} onClick={() => setBar(bar === i ? null : i)} className={bar === i ? "trend-bar active" : "trend-bar"}>
              {/* the hit target is the whole column, bigger than the bar */}
              <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} fill="transparent" />
              {h > 0 && <path d={roundedTop(x, y(0), barW, h)} />}
              <title>{t(lang, "trend_bar_title", { from: dm(weekEnds[i]!), n: num(v) })}</title>
            </g>
          );
        })}
        <text x={PAD.left} y={H - 4} className="trend-tick">{dm(weekEnds[0]!)}</text>
        <text x={W - PAD.right} y={H - 4} className="trend-tick" textAnchor="end">{dm(weekEnds[weekEnds.length - 1]!)}</text>
      </svg>
      <p className="muted body-map-detail" aria-live="polite">
        {selected
          ? t(lang, "trend_bar_detail", { to: dm(selected.from), muscle: label(slug), n: num(selected.v) })
          : [
              t(lang, "trend_summary", { n: num(recent) }),
              change !== null ? t(lang, change >= 0 ? "trend_up" : "trend_down", { pct: Math.abs(change) }) : "",
              mev > 0 ? t(lang, "trend_band", { mev, mav }) : "",
            ].filter(Boolean).join(" ")}
      </p>
    </div>
  );
}
