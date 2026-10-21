// Bulk inactive-user cleanup for the owner roster. Two taps: the preview count first, then an
// explicit "delete all" confirm. Same selection and purge as the bot's Clean up screen.
import { useEffect, useState } from "react";
import { api, typedBody } from "../api";
import { t, type Lang } from "../i18n";

export function OwnerCleanupCard({ lang, onDone }: { lang: Lang; onDone: () => void }) {
  const [count, setCount] = useState<number | null>(null);
  const [days, setDays] = useState(7);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const preview = () => {
    setError(false); setNote(null); setConfirming(false);
    api<{ count: number; days: number }>("/api/v2/owner/cleanup", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"ownerCleanup">({}) })
      .then((r) => { setCount(r.count); setDays(r.days); })
      .catch(() => setError(true));
  };
  useEffect(preview, []);

  const purge = async () => {
    setBusy(true); setError(false);
    try {
      const r = await api<{ deleted: number }>("/api/v2/owner/cleanup", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"ownerCleanup">({ confirm: true }) });
      setNote(t(lang, "tt_cleanup_done", { n: r.deleted }));
      setCount(0);
      setConfirming(false);
      onDone();
    } catch { setError(true); } finally { setBusy(false); }
  };

  return <div className="view-stack">
    <div className="section-head">
      <div><span className="eyebrow">{t(lang, "tt_cleanup_eyebrow")}</span><h2>{t(lang, "tt_cleanup_title", { days })}</h2></div>
      {count !== null && <span className="tag">{count}</span>}
    </div>
    {error && <div className="error-state"><strong>{t(lang, "generic_error")}</strong></div>}
    {count === null && !error ? <div className="skeleton" /> : null}
    {count === 0 && <p className="muted">{t(lang, "tt_cleanup_none")}</p>}
    {count !== null && count > 0 && !confirming && <div className="button-row">
      <button className="button button-ghost" disabled={busy} onClick={() => setConfirming(true)}>{t(lang, "tt_cleanup_btn", { n: count })}</button>
    </div>}
    {confirming && <div className="button-row">
      <button className="button button-primary" disabled={busy} onClick={() => void purge()}>{busy ? "…" : t(lang, "tt_cleanup_yes", { n: count ?? 0 })}</button>
      <button className="button button-ghost" disabled={busy} onClick={() => setConfirming(false)}>{t(lang, "cancel_btn")}</button>
    </div>}
    {note && <div className="save-note">{note}</div>}
  </div>;
}
