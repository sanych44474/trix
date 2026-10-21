// The 90-day wellbeing averages and trend (the bot's /well numbers), shown beside the daily check-in
// on the Progress screen. Data: GET /api/v2/wellbeing.
import { useEffect, useState } from "react";
import { api } from "./api";
import { t, type Key, type Lang } from "./i18n";

type Metric = "energy" | "sleep" | "stress";
type Wellbeing = { count: number; averages: Record<Metric, number> | null; trend: Record<Metric, number> | null };

const METRICS: Metric[] = ["energy", "sleep", "stress"];

export function WellbeingCard({ lang }: { lang: Lang }) {
  const [data, setData] = useState<Wellbeing | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api<Wellbeing>("/api/v2/wellbeing").then(setData).catch(() => setFailed(true));
  }, []);

  if (failed) return null;
  if (!data) return <div className="skeleton" />;
  const num = (n: number) => new Intl.NumberFormat(lang === "uk" ? "uk-UA" : "en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);

  return <section className="card">
    <div className="section-head"><div><span className="eyebrow">{t(lang, "wellbeing_eyebrow")}</span><h2>{t(lang, "wellbeing_title")}</h2></div></div>
    {!data.averages || !data.trend ? <p className="muted">{t(lang, "wellbeing_none")}</p> : <>
      <p className="muted">{t(lang, "wellbeing_count", { n: data.count })}</p>
      <div className="meter-list">
        {METRICS.map((metric) => {
          const change = data.trend?.[metric] ?? 0;
          // Stress is the one metric where a fall is the good direction.
          const good = metric === "stress" ? change < 0 : change > 0;
          const arrow = Math.abs(change) < 0.05 ? "—" : change > 0 ? "▲" : "▼";
          return <div className="row-between" key={metric}>
            <span>{t(lang, `${metric}_label` as Key)}</span>
            <span className="num">{num(data.averages?.[metric] ?? 0)}/5</span>
            <span className={`pill ${arrow === "—" ? "" : good ? "pill-good" : "pill-bad"}`}>{arrow} {num(Math.abs(change))}</span>
          </div>;
        })}
      </div>
      <p className="muted">{t(lang, "wellbeing_trend_note")}</p>
    </>}
  </section>;
}
