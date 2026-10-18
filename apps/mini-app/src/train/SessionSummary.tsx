import { useState } from "react";
import { Confetti, CountUp } from "./Celebrate";
import { api, typedBody } from "../api";
import { t, type Key, type Lang } from "../i18n";
import { fmtDuration } from "../logic/rest";
import { canShareStory } from "../telegram";
import { shareStoryCard } from "../storyCard";
import { Icon } from "../icons";
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
  volumeKg?: number; // load x reps over the logged sets
  plannedSets?: number;
}

const fmtNum = (lang: Lang, n: number, digits = 1) => new Intl.NumberFormat(lang === "uk" ? "uk-UA" : "en-GB", { maximumFractionDigits: digits }).format(n);

/** After a save: what was done (time, sets, volume), a new record when there is one, "how did it
 *  go?", and one way out. As a screen (onDone given) it replaces focus mode; otherwise it heads
 *  the workout overview. */
export function SessionSummary({ lang, summary, title, subtitle, date, onAskCoach, onDone }: { lang: Lang; summary: SaveSummary; title: string; subtitle?: string; date: string; onAskCoach?: () => void; onDone?: () => void }) {
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
  const stats: Array<{ id: string; value: string; label: Key }> = [
    ...(summary.elapsedSec > 0 ? [{ id: "time", value: fmtDuration(summary.elapsedSec), label: "summary_duration" as Key }] : []),
    { id: "sets", value: summary.plannedSets ? `${summary.sets}/${summary.plannedSets}` : String(summary.sets), label: "summary_sets_of" },
    ...(summary.volumeKg && summary.volumeKg > 0 ? [{ id: "volume", value: summary.volumeKg >= 1000 ? `${fmtNum(lang, summary.volumeKg / 1000)} ${t(lang, "unit_t")}` : `${fmtNum(lang, summary.volumeKg, 0)} ${t(lang, "ph_kg")}`, label: "summary_volume" as Key }] : []),
  ];
  const [firstPr, ...otherPrs] = summary.prExercises;
  const celebrate = summary.prExercises.length > 0 || summary.leveledUp || summary.newBadges.length > 0;
  return (
    <section className={onDone ? "summary is-screen" : "summary"}>
      {celebrate && <Confetti />}
      <div className="summary-head">
        <span className="summary-badge" aria-hidden="true"><Icon name="check" size={34} /></span>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      <div className="summary-stats">
        {stats.map((stat) => <div key={stat.id}><strong className="num"><CountUp value={stat.value} /></strong><small>{t(lang, stat.label)}</small></div>)}
      </div>
      {firstPr && <div className="pr-card">
        <span className="kicker">{t(lang, "summary_pr_kicker")}</span>
        <strong>{firstPr}</strong>
        {otherPrs.length > 0 && <small>{t(lang, "summary_pr_more", { n: otherPrs.length })}: {otherPrs.join(", ")}</small>}
      </div>}
      {summary.leveledUp && <p className="summary-hit">{t(lang, "summary_level_up", { n: summary.level })}</p>}
      {summary.newBadges.length > 0 && <p className="summary-hit">{t(lang, "summary_badges", { names: summary.newBadges.join(", ") })}</p>}
      <div className="feel-block">
        <strong>{t(lang, "feel_question")}</strong>
        <div className="feel-row" role="group" aria-label={t(lang, "feel_question")}>
          {(["easy", "ok", "hard"] as const).map((value) => (
            <button type="button" key={value} className="chip-button" disabled={feelState === "busy" || feelState === "done"} aria-pressed={feel === value} onClick={() => void sendFeel(value)}>
              <span aria-hidden="true">{value === "easy" ? "😌" : value === "ok" ? "💪" : "🥵"}</span>{t(lang, `feel_${value}`)}
            </button>
          ))}
        </div>
        {feelState === "failed" && <small className="feel-note">{t(lang, "generic_error")}</small>}
      </div>
      <div className="summary-actions">
        {canShareStory() && <button type="button" className="button button-secondary" disabled={sharing === "busy"} onClick={() => void shareStory()}>{sharing === "busy" ? "…" : t(lang, "share_story_btn")}</button>}
        {onAskCoach && <button type="button" className="button button-secondary" onClick={onAskCoach}>{t(lang, "summary_ask_coach_btn")}</button>}
        {onDone && <button type="button" className="button button-primary button-block" onClick={onDone}>{t(lang, "summary_done_btn")}</button>}
      </div>
    </section>
  );
}
