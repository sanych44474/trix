import { useState } from "react";
import { t, type Key, type Lang } from "../i18n";
import { fmtDuration } from "../logic/rest";
import { Card } from "./ui";

// What saveWorkout() returns (SaveResult, src/webapp/workout.ts) plus the locally measured
// session quality.
export interface SaveSummary {
  prExercises: string[];
  newBadges: string[];
  level: number;
  leveledUp: boolean;
  totalWorkouts: number;
  sets: number;
  elapsedSec: number; // 0 = no trustworthy clock, not shown
  densityPct: number | null;
  bestStreak: number;
}

type Stat = { id: string; value: string; label: Key; help: Key };

/** The post-save card. Each number is tappable and explains itself: "18% роботи" with no
 *  explanation read as a bug report rather than a statistic. */
export function SessionSummary({ lang, summary, title }: { lang: Lang; summary: SaveSummary; title: string }) {
  const [helpFor, setHelpFor] = useState<string | null>(null);
  const stats: Stat[] = [
    { id: "sets", value: String(summary.sets), label: "summary_sets", help: "summary_sets_help" },
    ...(summary.elapsedSec > 0 ? [{ id: "elapsed", value: fmtDuration(summary.elapsedSec), label: "summary_elapsed" as Key, help: "summary_elapsed_help" as Key }] : []),
    ...(summary.densityPct !== null ? [{ id: "density", value: `${summary.densityPct}%`, label: "summary_density" as Key, help: "summary_density_help" as Key }] : []),
    ...(summary.bestStreak > 0 ? [{ id: "streak", value: `🎯 ${summary.bestStreak}`, label: "summary_rest_streak" as Key, help: "summary_rest_streak_help" as Key }] : []),
  ];
  const open = stats.find((stat) => stat.id === helpFor);
  return (
    <Card tone="accent">
      <div className="section-head">
        <div><span className="eyebrow">{t(lang, "session_summary_eyebrow")}</span><h2>{title}</h2></div>
        <span className="tag">{t(lang, "level_n", { n: summary.level })}</span>
      </div>
      <div className="session-stats">
        {stats.map((stat) => (
          <button type="button" key={stat.id} className={helpFor === stat.id ? "selected" : ""} aria-expanded={helpFor === stat.id} onClick={() => setHelpFor((current) => current === stat.id ? null : stat.id)}>
            <strong>{stat.value}</strong>
            <small>{t(lang, stat.label)}</small>
          </button>
        ))}
      </div>
      <p className="stat-help">{open ? t(lang, open.help) : t(lang, "summary_help_hint")}</p>
      {summary.leveledUp && <p className="summary-hit">{t(lang, "summary_level_up", { n: summary.level })}</p>}
      {summary.prExercises.length > 0 && <p className="summary-hit">{t(lang, "summary_prs", { names: summary.prExercises.join(", ") })}</p>}
      {summary.newBadges.length > 0 && <p className="summary-hit">{t(lang, "summary_badges", { names: summary.newBadges.join(", ") })}</p>}
      <p className="muted">{t(lang, "summary_total_workouts", { n: summary.totalWorkouts })}</p>
    </Card>
  );
}
