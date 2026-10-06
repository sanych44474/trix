// "Rebuild my plan": after changing goal, level, schedule or equipment in Settings, the athlete
// gets a fresh plan from their current profile and records. Two taps (the current plan is
// replaced), then it builds in the background; this card polls until it's done and reloads.
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { t, type Lang } from "./i18n";
import { track } from "./logic/track";

type Status = { pending: boolean; failed: boolean };

export function RebuildPlanCard({ lang, onDone }: { lang: Lang; onDone: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [confirming, setConfirming] = useState(false);
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
    setConfirming(false); setError(false);
    try {
      await api("/api/v2/plan/replan", { method: "POST", idempotencyKey: crypto.randomUUID() });
      setStatus({ pending: true, failed: false });
      track("app_plan_rebuild");
    } catch (err) { setError(!(err instanceof ApiError && err.status === 403)); }
  };

  return <section className="card card-muted">
    <div className="section-head"><div><span className="eyebrow">{t(lang, "rebuild_eyebrow")}</span><h2>{t(lang, "rebuild_title")}</h2></div></div>
    {status?.pending ? <p className="muted">⏳ {t(lang, "rebuild_pending")}</p> : <>
      <p className="muted">{t(lang, "rebuild_detail")}</p>
      {status?.failed && <p className="muted">{t(lang, "rebuild_failed")}</p>}
      <div className="button-row">
        {confirming
          ? <><button className="button button-primary" onClick={() => void start()}>{t(lang, "rebuild_confirm_btn")}</button><button className="button button-ghost" onClick={() => setConfirming(false)}>{t(lang, "close")}</button></>
          : <button className="button button-ghost" onClick={() => setConfirming(true)}>{t(lang, "rebuild_btn")}</button>}
      </div>
    </>}
    {error && <div className="save-note error-note">{t(lang, "generic_error")}</div>}
  </section>;
}
