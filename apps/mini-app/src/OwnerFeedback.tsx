// Owner console: feedback triage. Every /feedback, rating and AI-coach "send to the team" lands
// here with an auto-guessed category (domain/feedbackTriage) the owner can change, and a status:
// new → done (optionally telling the author "your idea is live") or won't do.
import { useEffect, useState } from "react";
import { api, jsonBody } from "./api";
import { t, type Key, type Lang } from "./i18n";

type Category = "bug" | "idea" | "complaint" | "praise" | "rating" | "other";
type Status = "new" | "done" | "wontfix";
type Row = { id: number; userId: number; username?: string; name?: string; text: string; date: string; category: Category; status: Status };
type Payload = { rows: Row[]; counts: Record<Status, number> };

const CATS: Category[] = ["bug", "idea", "complaint", "praise", "rating", "other"];
const CAT_ICON: Record<Category, string> = { bug: "🐞", idea: "💡", complaint: "😕", praise: "💚", rating: "⭐", other: "💬" };

export function OwnerFeedback({ lang }: { lang: Lang }) {
  const [filter, setFilter] = useState<Status | "all">("new");
  const [cat, setCat] = useState<Category | "all">("all");
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState(false);
  const load = (f = filter) => { setError(false); api<Payload>(`/api/v2/owner/feedback?status=${f}`).then(setData).catch(() => setError(true)); };
  useEffect(() => load(filter), [filter]);

  const update = async (row: Row, patch: { status?: Status; category?: Category }) => {
    setBusy(row.id); setError(false);
    try {
      await api(`/api/v2/owner/feedback/${row.id}`, { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({ ...patch, ...(patch.status === "done" ? { notify } : {}) }) });
      load();
    } catch { setError(true); } finally { setBusy(null); }
  };

  const rows = (data?.rows ?? []).filter((r) => cat === "all" || r.category === cat);
  return <div className="owner-feedback">
    <div className="chip-row">
      {(["new", "done", "wontfix", "all"] as const).map((s) => <button type="button" key={s} className={filter === s ? "rest-chip selected" : "rest-chip"} onClick={() => setFilter(s)}>
        {t(lang, `fbt_status_${s}` as Key)}{s !== "all" && data ? ` · ${data.counts[s]}` : ""}
      </button>)}
    </div>
    <div className="chip-row">
      <button type="button" className={cat === "all" ? "rest-chip selected" : "rest-chip"} onClick={() => setCat("all")}>{t(lang, "fbt_cat_all")}</button>
      {CATS.map((c) => <button type="button" key={c} className={cat === c ? "rest-chip selected" : "rest-chip"} onClick={() => setCat(c)}>{CAT_ICON[c]} {t(lang, `fbt_cat_${c}` as Key)}</button>)}
    </div>
    {filter === "new" && <label className="check-row"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> {t(lang, "fbt_notify")}</label>}
    {error && <div className="save-note error-note">{t(lang, "generic_error")}</div>}
    {!data ? <div className="skeleton" /> : rows.length === 0 ? <p className="muted">{t(lang, "fbt_empty")}</p> : rows.map((r) => <div className="fb-row" key={r.id}>
      <div className="fb-head">
        <select value={r.category} disabled={busy === r.id} onChange={(e) => void update(r, { category: e.target.value as Category })} aria-label={t(lang, "fbt_category")}>
          {CATS.map((c) => <option key={c} value={c}>{CAT_ICON[c]} {t(lang, `fbt_cat_${c}` as Key)}</option>)}
        </select>
        <small>{r.name || (r.username ? `@${r.username}` : `id ${r.userId}`)} · {r.date}</small>
      </div>
      <p>{r.text}</p>
      <div className="button-row">
        {r.status !== "done" && <button className="button button-primary" disabled={busy === r.id} onClick={() => void update(r, { status: "done" })}>{busy === r.id ? "…" : t(lang, "fbt_mark_done")}</button>}
        {r.status === "new" && <button className="button button-ghost" disabled={busy === r.id} onClick={() => void update(r, { status: "wontfix" })}>{t(lang, "fbt_mark_wontfix")}</button>}
        {r.status !== "new" && <button className="button button-ghost" disabled={busy === r.id} onClick={() => void update(r, { status: "new" })}>{t(lang, "fbt_reopen")}</button>}
      </div>
    </div>)}
  </div>;
}
