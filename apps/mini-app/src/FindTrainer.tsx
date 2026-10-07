import { useEffect, useState } from "react";
import { api, typedBody } from "./api";
import type { TrainerDirectory } from "./types";
import { t, type Lang } from "./i18n";

type Props = { lang: Lang; onBack: () => void; onAccepted: () => void };

/**
 * "Choose a trainer" on the first screen: approved trainers taking clients, one card each. A tap
 * sends the request; while it is pending the screen shows who it went to (with Cancel) and checks
 * every few seconds, so the questionnaire opens as soon as the trainer accepts.
 */
export function FindTrainer({ lang, onBack, onAccepted }: Props) {
  const [data, setData] = useState<TrainerDirectory | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<number | "cancel" | null>(null);
  const load = () => api<TrainerDirectory>("/api/v2/trainers").then((d) => { setError(false); setData(d); if (d.role === "client") onAccepted(); }).catch(() => setError(true));
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!data?.pending) return;
    const id = setInterval(() => { void load(); }, 6000);
    return () => clearInterval(id);
  }, [data?.pending?.trainerId]);

  const choose = async (trainerId: number) => {
    setBusy(trainerId);
    try {
      await api("/api/v2/trainers", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"requestTrainer">({ trainerId }) });
      await load();
    } catch { setError(true); } finally { setBusy(null); }
  };
  const cancel = async () => {
    setBusy("cancel");
    try { await api("/api/v2/trainers", { method: "DELETE", idempotencyKey: crypto.randomUUID() }); await load(); } catch { setError(true); } finally { setBusy(null); }
  };

  return <div className="ob-wizard view-stack">
    <div className="ob-progress"><button type="button" className="text-button" onClick={onBack}>← {t(lang, "ob_back_btn")}</button></div>
    <div className="ob-question">
      <h1>{t(lang, "ft_title")}</h1>
      <p className="muted">{t(lang, "ft_body")}</p>
    </div>
    {error && <div className="save-note error-note">{t(lang, "generic_error")}</div>}
    {!data && !error && <div className="skeleton" />}
    {data?.pending && <div className="card">
      <h2>{t(lang, "ft_pending_title", { name: data.pending.name })}</h2>
      <p className="muted">{t(lang, "ft_pending_body")}</p>
      <button type="button" className="button button-ghost" disabled={busy === "cancel"} onClick={() => void cancel()}>{t(lang, "ft_cancel_btn")}</button>
    </div>}
    {data && !data.pending && (data.trainers.length === 0
      ? <p className="muted">{t(lang, "ft_empty")}</p>
      : <div className="ob-options">{data.trainers.map((tr) => <div key={tr.id} className="ft-card">
        <div className="ft-head"><strong>{tr.name}</strong>{tr.city && <span className="muted">{tr.city}</span>}</div>
        {tr.specialization && <div>{tr.specialization}</div>}
        <div className="muted ft-meta">
          {tr.experienceYears !== null && <span>{t(lang, "ft_years", { n: tr.experienceYears })}</span>}
          {tr.priceOnline !== null && <span>{t(lang, "ft_price", { n: tr.priceOnline, cur: tr.currency ?? "" })}</span>}
        </div>
        {tr.bio && <p className="muted ft-bio">{tr.bio}</p>}
        <button type="button" className="button button-primary button-wide" disabled={busy !== null} onClick={() => void choose(tr.id)}>{busy === tr.id ? t(lang, "saving_ellipsis") : t(lang, "ft_choose_btn")}</button>
      </div>)}</div>)}
  </div>;
}
