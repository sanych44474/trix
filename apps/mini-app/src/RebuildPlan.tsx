// "Rebuild my plan": after changing goal, level, schedule or equipment in Settings, the athlete
// gets a fresh plan from their current profile and records. Two taps (the current plan is
// replaced), then it builds in the background; this card polls until it's done and reloads.
// The same request and polling build a first plan for an account that has none (NoPlanCard).
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { t, type Lang } from "./i18n";
import type { NoPlanAction } from "./logic/noPlan";
import { track } from "./logic/track";

type Status = { pending: boolean; failed: boolean };

function useRebuildPlan(onDone: () => void) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;

  const poll = () => api<Status>("/api/v2/plan/replan").then(setStatus).catch(() => {});
  useEffect(() => { void poll(); }, []);
  useEffect(() => {
    if (!status?.pending) return;
    const timer = window.setInterval(() => {
      api<Status>("/api/v2/plan/replan").then((next) => {
        setStatus(next);
        if (!next.pending) done.current();
      }).catch(() => {});
    }, 4000);
    return () => window.clearInterval(timer);
  }, [status?.pending]);

  const start = async () => {
    setError(false);
    try {
      await api("/api/v2/plan/replan", { method: "POST", idempotencyKey: true });
      setStatus({ pending: true, failed: false });
      track("app_plan_rebuild");
    } catch (err) { setError(!(err instanceof ApiError && err.status === 403)); }
  };

  return { status, error, start };
}

export function RebuildPlanCard({ lang, onDone }: { lang: Lang; onDone: () => void }) {
  const { status, error, start } = useRebuildPlan(onDone);
  const [confirming, setConfirming] = useState(false);

  return <section className="card card-muted">
    <div className="section-head"><div><span className="eyebrow">{t(lang, "rebuild_eyebrow")}</span><h2>{t(lang, "rebuild_title")}</h2></div></div>
    {status?.pending ? <p className="muted">⏳ {t(lang, "rebuild_pending")}</p> : <>
      <p className="muted">{t(lang, "rebuild_detail")}</p>
      {status?.failed && <p className="muted">{t(lang, "rebuild_failed")}</p>}
      <div className="button-row">
        {confirming
          ? <><button className="button button-primary" onClick={() => { setConfirming(false); void start(); }}>{t(lang, "rebuild_confirm_btn")}</button><button className="button button-ghost" onClick={() => setConfirming(false)}>{t(lang, "close")}</button></>
          : <button className="button button-ghost" onClick={() => setConfirming(true)}>{t(lang, "rebuild_btn")}</button>}
      </div>
    </>}
    {error && <div className="save-note error-note">{t(lang, "generic_error")}</div>}
  </section>;
}

/**
 * The account has no active plan (logic/noPlan.ts decides which case): one button that builds the
 * plan or opens the questionnaire, or a line saying the trainer is preparing it.
 */
export function NoPlanCard({ lang, action, onQuestionnaire, onDone }: { lang: Lang; action: NoPlanAction; onQuestionnaire?: () => void; onDone: () => void }) {
  const { status, error, start } = useRebuildPlan(onDone);
  const building = action === "building" || (action === "build" && status?.pending);

  return <section className="card card-default" aria-labelledby="no-plan-title">
    <h2 id="no-plan-title" className="card-title">{t(lang, "no_plan_title")}</h2>
    {building ? <p className="muted">⏳ {t(lang, "rebuild_pending")}</p>
      : action === "trainer" ? <p className="muted">{t(lang, "no_plan_trainer_detail")}</p>
      : action === "questionnaire" ? <>
        <p className="muted">{t(lang, "no_plan_questionnaire_detail")}</p>
        {onQuestionnaire && <div className="button-row"><button type="button" className="button button-primary" onClick={onQuestionnaire}>{t(lang, "no_plan_questionnaire_btn")}</button></div>}
      </>
      : <>
        <p className="muted">{t(lang, "no_plan_build_detail")}</p>
        {status?.failed && <p className="muted">{t(lang, "rebuild_failed")}</p>}
        <div className="button-row"><button type="button" className="button button-primary" onClick={() => void start()}>{t(lang, "no_plan_build_btn")}</button></div>
      </>}
    {error && <div className="save-note error-note">{t(lang, "generic_error")}</div>}
  </section>;
}
