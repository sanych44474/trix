// Today's "this week" card -- the muscle balance score so far, the run of balanced weeks towards
// the balance_streak_4 badge, and the week's quests (dashboard.week, domain/quests.ts) -- plus the
// overlay that celebrates badges earned since the app was last opened (the Sunday digest's, a
// quest sweep, anything earned in the chat).
import { useEffect, useState } from "react";
import { t, type Key, type Lang } from "./i18n";
import type { Dashboard } from "./types";
import { SEEN_BADGES_KEY, unseenBadges } from "./logic/badgesSeen";
import { lastWeekSummary } from "./logic/weekSummary";
import { track } from "./logic/track";

const SUMMARY_SEEN_KEY = "trix:v2:week-summary-seen";

/** Last week in one card, Monday to Wednesday, until dismissed (logic/weekSummary). */
export function WeekSummaryCard({ lang, dashboard }: { lang: Lang; dashboard: Dashboard }) {
  const s = lastWeekSummary({
    today: dashboard.today,
    days: dashboard.calendar.days,
    plannedWeekdays: [...new Set(dashboard.calendar.split.map((d) => d.weekday).filter((w) => w > 0))],
    weights: dashboard.weight.points,
    foodDays: dashboard.macros.days,
    exercises: dashboard.exercises,
  });
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(SUMMARY_SEEN_KEY) === s.start; } catch { return false; } });
  const dow = (new Date(`${dashboard.today}T12:00:00Z`).getUTCDay() + 6) % 7;
  if (hidden || dow > 2 || (s.workouts === 0 && s.foodDays === 0 && s.weightDelta === undefined)) return null;
  const hide = () => {
    track("app_week_summary_closed"); try { localStorage.setItem(SUMMARY_SEEN_KEY, s.start); } catch { /* optional */ } setHidden(true); };
  const kg = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${new Intl.NumberFormat(lang === "uk" ? "uk-UA" : "en-GB", { maximumFractionDigits: 1 }).format(Math.abs(n))} kg`;
  return <section className="card week-summary">
    <div className="section-head"><div><span className="eyebrow">{t(lang, "ws_eyebrow")}</span><h2>{t(lang, "ws_title")}</h2></div><button className="text-button" onClick={hide}>{t(lang, "close")}</button></div>
    <div className="ws-grid">
      <div><strong>{s.planned ? `${s.workouts}/${s.planned}` : s.workouts}</strong><small>{t(lang, "ws_workouts")}</small></div>
      <div><strong>{s.weightDelta !== undefined ? kg(s.weightDelta) : "—"}</strong><small>{t(lang, "ws_weight")}</small></div>
      <div><strong>{s.foodDays}/7</strong><small>{t(lang, "ws_food")}</small></div>
    </div>
    {s.records.length > 0 && <p className="ws-records">🏆 {t(lang, "ws_records", { list: s.records.slice(0, 3).join(", ") })}</p>}
    <p className="ws-focus"><strong>{t(lang, "ws_focus_label")}</strong> {t(lang, `ws_focus_${s.focus}` as Key, { n: s.planned })}</p>
  </section>;
}

type Week = NonNullable<Dashboard["week"]>;
type Quest = Week["quests"][number];

function questText(lang: Lang, q: Quest): string {
  const n = String(q.target);
  if (q.kind === "muscle_sets") return t(lang, "quest_muscle_sets", { n, muscle: t(lang, `muscle_${(q.muscle ?? "").replace("-", "_")}` as Key) });
  return t(lang, `quest_${q.kind}` as Key, { n });
}

const fmt = (lang: Lang, n: number) => { const s = String(Math.round(n * 2) / 2); return lang === "uk" ? s.replace(".", ",") : s; };

export function WeekCard({ lang, week }: { lang: Lang; week: Week }) {
  const streak = Math.min(week.balanceStreak, week.balanceGoal);
  return <section className="card week-card">
    <div className="section-head"><div><span className="eyebrow">{t(lang, "week_eyebrow")}</span><h2>{t(lang, "week_card_title", { score: week.balance })}</h2></div><span className="tag">{streak}/{week.balanceGoal}</span></div>
    <p className="muted">{t(lang, "week_streak", { n: week.balanceStreak, goal: week.balanceGoal })}</p>
    <div className="progress-track week-streak"><span style={{ width: `${(streak / week.balanceGoal) * 100}%` }} /></div>
    {week.quests.length > 0 && <>
      <h3 className="week-quests-title">{t(lang, "quests_title", { xp: week.questXp })}</h3>
      <ul className="quest-list">
        {week.quests.map((q) => <li key={q.code} className={q.done ? "quest done" : "quest"}>
          <span className="quest-mark" aria-hidden="true">{q.done ? "✓" : ""}</span>
          <div><strong>{questText(lang, q)}</strong><div className="progress-track"><span style={{ width: `${Math.min(100, (q.current / Math.max(1, q.target)) * 100)}%` }} /></div></div>
          <small>{fmt(lang, Math.min(q.current, q.target))}/{q.target}</small>
        </li>)}
      </ul>
    </>}
  </section>;
}

export function BadgeCelebration({ lang, badges }: { lang: Lang; badges: Array<{ code: string; label: string }> }) {
  const [show, setShow] = useState<Array<{ code: string; label: string }>>([]);
  const codes = badges.map((b) => b.code).join(",");
  useEffect(() => {
    let raw: string | null = null;
    try { raw = localStorage.getItem(SEEN_BADGES_KEY); } catch { return; } // no storage: never celebrate twice
    const { show: fresh, seen } = unseenBadges(badges.map((b) => b.code), raw);
    try { localStorage.setItem(SEEN_BADGES_KEY, JSON.stringify(seen)); } catch { /* storage is optional */ }
    if (fresh.length) {
      setShow(badges.filter((b) => fresh.includes(b.code)));
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the codes, not the array identity
  }, [codes]);
  if (!show.length) return null;
  return <div className="badge-pop" role="dialog" aria-modal="true" aria-label={t(lang, show.length > 1 ? "badge_new_many" : "badge_new_one")} onClick={() => setShow([])}>
    <div className="badge-pop-card" onClick={(e) => e.stopPropagation()}>
      <div className="badge-pop-medal" aria-hidden="true">🏅</div>
      <h2>{t(lang, show.length > 1 ? "badge_new_many" : "badge_new_one")}</h2>
      <ul>{show.map((b) => <li key={b.code}>{b.label}</li>)}</ul>
      <button className="button button-primary" onClick={() => setShow([])}>{t(lang, "badge_new_ok")}</button>
    </div>
  </div>;
}
