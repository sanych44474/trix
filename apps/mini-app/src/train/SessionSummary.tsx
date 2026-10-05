import { useState } from "react";
import { Confetti, CountUp } from "./Celebrate";
import { api, typedBody } from "../api";
import { t, type Key, type Lang } from "../i18n";
import { fmtDuration } from "../logic/rest";
import { canShareStory } from "../telegram";
import { shareStoryCard } from "../storyCard";
import { Card } from "./ui";
import { track } from "../logic/track";

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
export function SessionSummary({ lang, summary, title, date, onAskCoach }: { lang: Lang; summary: SaveSummary; title: string; date: string; onAskCoach?: () => void }) {
  const [helpFor, setHelpFor] = useState<string | null>(null);
  const [sharing, setSharing] = useState<"idle" | "busy" | "failed">("idle");
  // "How did it go?" -- one tap, read by next Monday's progression (domain/sessionFeel.ts).
  const [feel, setFeel] = useState<"easy" | "ok" | "hard" | null>(null);
  const [feelState, setFeelState] = useState<"idle" | "busy" | "done" | "failed">("idle");
  const sendFeel = async (value: "easy" | "ok" | "hard") => {
    track(`app_feel_${value}`);
    setFeel(value); setFeelState("busy");
    try {
      await api("/api/v2/workout/feel", { method: "POST", body: typedBody<"setWorkoutFeel">({ date, feel: value }) });
      setFeelState("done");
      window.Telegram?.WebApp.HapticFeedback?.impactOccurred("light");
    } catch { setFeelState("failed"); }
  };
  // A finished session (or a new record) as a Telegram story: free reach, one tap.
  const shareStory = async () => {
    setSharing("busy");
    try {
      await shareStoryCard({
        eyebrow: date,
        title: summary.prExercises.length ? t(lang, "story_pr_title") : t(lang, "story_session_title"),
        ...(summary.prExercises.length ? { highlight: summary.prExercises.join(" · ") } : {}),
        rows: [
          [t(lang, "summary_sets"), String(summary.sets)],
          ...(summary.elapsedSec > 0 ? [[t(lang, "summary_elapsed"), fmtDuration(summary.elapsedSec)] as [string, string]] : []),
          ...(summary.densityPct !== null ? [[t(lang, "summary_density"), `${summary.densityPct}%`] as [string, string]] : []),
          [t(lang, "level_n", { n: summary.level }), "⭐"],
        ],
        footer: t(lang, "story_footer"),
      });
      setSharing("idle");
    } catch { setSharing("failed"); }
  };
  const stats: Stat[] = [
    { id: "sets", value: String(summary.sets), label: "summary_sets", help: "summary_sets_help" },
    ...(summary.elapsedSec > 0 ? [{ id: "elapsed", value: fmtDuration(summary.elapsedSec), label: "summary_elapsed" as Key, help: "summary_elapsed_help" as Key }] : []),
    ...(summary.densityPct !== null ? [{ id: "density", value: `${summary.densityPct}%`, label: "summary_density" as Key, help: "summary_density_help" as Key }] : []),
    ...(summary.bestStreak > 0 ? [{ id: "streak", value: `🎯 ${summary.bestStreak}`, label: "summary_rest_streak" as Key, help: "summary_rest_streak_help" as Key }] : []),
  ];
  const open = stats.find((stat) => stat.id === helpFor);
  return (
    <Card tone="accent">
      {(summary.prExercises.length > 0 || summary.leveledUp || summary.newBadges.length > 0) && <Confetti />}
      <div className="section-head">
        <div><span className="eyebrow">{t(lang, "session_summary_eyebrow")}</span><h2>{title}</h2></div>
        <span className="tag">{t(lang, "level_n", { n: summary.level })}</span>
      </div>
      <div className="session-stats">
        {stats.map((stat) => (
          <button type="button" key={stat.id} className={helpFor === stat.id ? "selected" : ""} aria-expanded={helpFor === stat.id} onClick={() => setHelpFor((current) => current === stat.id ? null : stat.id)}>
            <strong><CountUp value={stat.value} /></strong>
            <small>{t(lang, stat.label)}</small>
          </button>
        ))}
      </div>
      <p className="stat-help">{open ? t(lang, open.help) : t(lang, "summary_help_hint")}</p>
      {summary.leveledUp && <p className="summary-hit">{t(lang, "summary_level_up", { n: summary.level })}</p>}
      {summary.prExercises.length > 0 && <p className="summary-hit">{t(lang, "summary_prs", { names: summary.prExercises.join(", ") })}</p>}
      {summary.newBadges.length > 0 && <p className="summary-hit">{t(lang, "summary_badges", { names: summary.newBadges.join(", ") })}</p>}
      <div className="feel-block">
        <strong>{t(lang, "feel_question")}</strong>
        <div className="feel-row" role="group" aria-label={t(lang, "feel_question")}>
          {(["easy", "ok", "hard"] as const).map((value) => (
            <button type="button" key={value} className={feel === value ? "feel-chip selected" : "feel-chip"} disabled={feelState === "busy" || feelState === "done"} aria-pressed={feel === value} onClick={() => void sendFeel(value)}>
              <span aria-hidden="true">{value === "easy" ? "😌" : value === "ok" ? "💪" : "🥵"}</span>{t(lang, `feel_${value}`)}
            </button>
          ))}
        </div>
        {feelState === "done" && <small className="feel-note">{t(lang, `feel_done_${feel ?? "ok"}`)}</small>}
        {feelState === "failed" && <small className="feel-note">{t(lang, "generic_error")}</small>}
      </div>
      <p className="muted">{t(lang, "summary_total_workouts", { n: summary.totalWorkouts })}</p>
      {onAskCoach && <button type="button" className="button button-ghost button-wide" onClick={onAskCoach}>{t(lang, "summary_ask_coach_btn")}</button>}
      {canShareStory() && (
        <div className="button-row">
          <button type="button" className="button button-light" disabled={sharing === "busy"} onClick={() => void shareStory()}>{sharing === "busy" ? "…" : t(lang, "share_story_btn")}</button>
          {sharing === "failed" && <small>{t(lang, "share_story_failed")}</small>}
        </div>
      )}
    </Card>
  );
}
