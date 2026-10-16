// Today: one workout block with the single main action (start, continue, open the log, or log on a
// rest day), the week as seven days under it, and everything else -- recovery, water and steps,
// the week's balance and quests -- one tap away instead of stacked as equally loud cards.
// The state rules are pure in logic/todayPlan.ts.
import { useEffect, useMemo, useRef, useState } from "react";
import { api, typedBody } from "./api";
import { t, type Key, type Lang } from "./i18n";
import type { Dashboard, RecoveryFactor, RecoveryLabel } from "./types";
import type { View } from "./logic/navigation";
import { DRAFT_KEY, parseDraft } from "./logic/logger";
import { todayPlan, type DayMark } from "./logic/todayPlan";
import { canUseMainButton, showMainButton } from "./telegram";
import { FineTuneCard } from "./FineTuneCard";
import { WhatsNewCard } from "./WhatsNew";
import { WeekCard, WeekSummaryCard } from "./Week";
import { Icon } from "./icons";
import { Card } from "./train/ui";

// Index 0 = Monday, same order as App.tsx's WEEKDAY_KEYS (kept local: App imports this file).
const WEEKDAY_SHORT: Key[] = ["weekday_mon", "weekday_tue", "weekday_wed", "weekday_thu", "weekday_fri", "weekday_sat", "weekday_sun"];
const MORE_KEY = "trix:v2:today-more-open";

// The dashboard sends stable recovery codes (src/domain/recovery.ts), never prose -- rendered here.
const recoveryLabel = (lang: Lang, label: RecoveryLabel) => t(lang, `recovery_label_${label}` as Key);
const recoveryFactor = (lang: Lang, factor: RecoveryFactor) => t(lang, `recovery_factor_${factor.code}` as Key, { n: factor.count ?? 0 });
const fmt = (n: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(n);

function readDraft() {
  try { return parseDraft(localStorage.getItem(DRAFT_KEY)); } catch { return null; }
}

// "Chest is still recovering -- swap today with Thursday's legs?" (dashboard.recoverySwap, computed
// server-side from the plan and recent logs). One tap trades the two plan days' weekdays.
function RecoverySwapCard({ lang, swap, onDone }: { lang: Lang; swap: NonNullable<Dashboard["recoverySwap"]>; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  const muscles = swap.tired.map((slug) => t(lang, `muscle_${slug.replace("-", "_")}` as Key).toLowerCase()).join(", ");
  const other = t(lang, WEEKDAY_SHORT[swap.other - 1]);
  const apply = async () => {
    setBusy(true); setError(null);
    try {
      await api("/api/v2/plan", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"editPlan">({ action: "dayswap", weekday: swap.weekday, other: swap.other }) });
      onDone();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return <Card>
    <h2 className="card-title">{t(lang, "rswap_title", { muscles })}</h2>
    <p className="muted">{t(lang, "rswap_body", { because: swap.because.join(", "), other, otherGroup: swap.otherGroup, todayGroup: swap.todayGroup })}</p>
    {error !== null && <p className="error-text">{t(lang, "generic_error")}</p>}
    <div className="button-row">
      <button className="button button-secondary" disabled={busy} onClick={() => void apply()}>{busy ? t(lang, "saving_ellipsis") : t(lang, "rswap_btn", { other })}</button>
      <button className="button button-quiet" disabled={busy} onClick={() => setDismissed(true)}>{t(lang, "rswap_keep")}</button>
    </div>
  </Card>;
}

function WeekStrip({ lang, week }: { lang: Lang; week: ReturnType<typeof todayPlan>["week"] }) {
  return <ol className="week-strip">
    {week.map((day) => <li key={day.date} className={`day day-${day.mark}${day.today ? " day-today" : ""}`} aria-label={`${t(lang, WEEKDAY_SHORT[day.weekday - 1])}: ${t(lang, `day_mark_${day.mark}` as Key)}`} aria-current={day.today ? "date" : undefined}>
      <span className="day-name" aria-hidden="true">{t(lang, WEEKDAY_SHORT[day.weekday - 1])}</span>
      <span className="day-dot" aria-hidden="true">{day.mark === "done" ? <Icon name="check" size={14} /> : null}</span>
    </li>)}
  </ol>;
}

export function TodayView({ dashboard, lang, onOpen, onReload, onAskCoach }: { dashboard: Dashboard; lang: Lang; onOpen: (view: View) => void; onReload: () => void; onAskCoach: () => void }) {
  const plan = useMemo(() => todayPlan({
    today: dashboard.today,
    planExercises: dashboard.logForm?.exercises ?? [],
    plannedWeekdays: dashboard.calendar.split.map((d) => d.weekday),
    days: dashboard.calendar.days,
    logs: dashboard.calendar.logs,
    draft: readDraft(),
  }), [dashboard]);
  const group = dashboard.calendar.split.find((d) => d.weekday === plan.week.find((w) => w.today)?.weekday)?.group;
  const [more, setMore] = useState(() => { try { return localStorage.getItem(MORE_KEY) === "1"; } catch { return false; } });
  const toggleMore = () => { const next = !more; setMore(next); try { localStorage.setItem(MORE_KEY, next ? "1" : "0"); } catch { /* optional */ } };

  const action = plan.state === "start" ? t(lang, "start_session")
    : plan.state === "continue" ? t(lang, "today_continue_btn")
    : plan.state === "done" ? t(lang, "today_view_log_btn")
    : t(lang, "log_workout");
  const go = () => onOpen("train");

  // Inside Telegram the main action is the native bottom button: where the thumb already is, and
  // styled by Telegram itself. Start and continue only -- "open the log" and "log on a rest day"
  // are secondary and stay in the page.
  const [native] = useState(canUseMainButton);
  const goRef = useRef(go); goRef.current = go;
  const primary = plan.state === "start" || plan.state === "continue";
  useEffect(() => {
    if (!native || !primary) return;
    return showMainButton({ text: action, active: true, progress: false }, () => goRef.current());
  }, [native, primary, action]);

  const shown = plan.exercises.slice(0, 3);
  const hidden = plan.exercises.length - shown.length;
  const recovery = dashboard.recovery;
  const stats = dashboard.todayStats;
  const dayMarkClass = (mark: DayMark) => `status-${mark}`;

  return <div className="view-stack today">
    <section className={`workout-block workout-${plan.state}`} aria-labelledby="today-workout-title">
      <div className="workout-head">
        <h1 id="today-workout-title">{plan.state === "done" ? t(lang, "today_done_title") : plan.state === "rest" ? t(lang, "today_rest_title") : t(lang, "today_workout_title")}</h1>
        {group && plan.state !== "rest" && <span className="workout-group">{group}</span>}
      </div>
      {plan.state === "rest"
        ? <p className="muted">{t(lang, "today_rest_body")}</p>
        : <>
          {plan.state !== "start" && <p className="workout-meta">
            {plan.state === "continue" ? t(lang, "today_continue_meta", { done: plan.started, total: plan.exercises.length })
              : t(lang, "today_done_meta", { sets: plan.sets })}
          </p>}
          <ul className="workout-list">
            {shown.map((name, i) => <li key={`${i}-${name}`}>{name}</li>)}
            {hidden > 0 && <li className="muted">{t(lang, "today_more_n", { n: hidden })}</li>}
          </ul>
        </>}
      {!(native && primary) && <button type="button" className={primary ? "button button-primary button-block" : "button button-secondary button-block"} onClick={go}>{action}</button>}
    </section>

    {dashboard.recoverySwap && plan.state === "start" && <RecoverySwapCard lang={lang} swap={dashboard.recoverySwap} onDone={onReload} />}

    <section className="week-block" aria-label={t(lang, "today_week_line", { done: plan.weekDone, planned: plan.weekPlanned })}>
      <div className="week-line">
        <span>{t(lang, "today_week_line", { done: plan.weekDone, planned: plan.weekPlanned })}</span>
      </div>
      <WeekStrip lang={lang} week={plan.week} />
    </section>

    {dashboard.viewer.profileGaps && dashboard.viewer.profileGaps.length > 0 && <FineTuneCard lang={lang} gaps={dashboard.viewer.profileGaps} onSaved={onReload} />}
    {dashboard.whatsnew && <WhatsNewCard lang={lang} version={dashboard.whatsnew.version} text={dashboard.whatsnew.text} />}

    <button type="button" className="list-row" onClick={onAskCoach}>
      <Icon name="chat" />
      <strong>{t(lang, dashboard.viewer.role === "client" ? "ask_trainer_nav_btn" : "coach_entry_title")}</strong>
      <Icon name="chevron" size={20} className="row-chevron" />
    </button>

    <button type="button" className="disclosure" aria-expanded={more} aria-controls="today-more" onClick={toggleMore}>
      <span>{more ? t(lang, "today_less_btn") : t(lang, "today_more_btn")}</span>
      <Icon name="chevron" size={20} className="disclosure-chevron" />
    </button>
    {more && <div id="today-more" className="view-stack">
      <Card>
        <div className="row-between">
          <h2 className="card-title">{t(lang, "metric_recovery")}: {recoveryLabel(lang, recovery.label)}</h2>
          <span className={`score ${dayMarkClass(recovery.score >= 70 ? "done" : recovery.score >= 45 ? "planned" : "missed")}`}>{recovery.score}</span>
        </div>
        {recovery.factors.length ? <ul className="plain-list">{recovery.factors.slice(0, 3).map((factor) => <li key={factor.code}>{recoveryFactor(lang, factor)}</li>)}</ul> : <p className="muted">{t(lang, "no_recovery_blockers")}</p>}
      </Card>
      {stats && <Card>
        <div className="row-between"><h2 className="card-title">{t(lang, "today_water_steps")}</h2><button type="button" className="button button-quiet button-small" onClick={() => onOpen("progress")}>{t(lang, "nav_progress")}</button></div>
        <div className="meter-list">
          <Meter label={t(lang, "metric_water")} value={stats.waterMl} goal={stats.waterGoal} text={`${fmt(stats.waterMl)} / ${fmt(stats.waterGoal)} ${t(lang, "unit_ml")}`} />
          <Meter label={t(lang, "metric_steps")} value={stats.steps} goal={stats.stepsGoal} text={`${fmt(stats.steps)} / ${fmt(stats.stepsGoal)}`} />
        </div>
      </Card>}
      {dashboard.week && <WeekCard lang={lang} week={dashboard.week} />}
      <WeekSummaryCard lang={lang} dashboard={dashboard} />
    </div>}
  </div>;
}

function Meter({ label, value, goal, text }: { label: string; value: number; goal: number; text: string }) {
  const pct = Math.min(100, Math.round((value / Math.max(1, goal)) * 100));
  return <div className="meter">
    <div className="row-between"><span>{label}</span><span className="num">{text}</span></div>
    <div className="meter-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style={{ width: `${pct}%` }} /></div>
  </div>;
}
