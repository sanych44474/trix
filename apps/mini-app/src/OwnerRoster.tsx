// The owner console's people table: name and status, when they were last seen, how many things
// they've logged (workouts, check-ins, food days, steps), and — on tap — the actions: nudge an
// unfinished onboarding, block/unblock, delete (two taps). Data: GET /api/v2/owner/users.
import { useMemo, useState } from "react";
import { t, type Key, type Lang } from "./i18n";
import type { OwnerUsers } from "./types";
import { bySeenDesc, seenLabel } from "./logic/seen";

type Row = OwnerUsers["rows"][number];
export type RosterAction = "block" | "unblock" | "delete" | "nudge";
type Filter = "all" | "onboarding" | "active" | "idle";
const PAGE = 30;

export function OwnerRoster({ lang, rows, busy, nudged, onAction }: {
  lang: Lang;
  rows: Row[];
  busy: string | null;
  nudged: Set<number>;
  onAction: (id: number, action: RosterAction) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [shown, setShown] = useState(PAGE);
  const now = useMemo(() => new Date(), []);
  const idle = (r: Row) => seenLabel(r.lastSeen, now).key === "seen_date" || (seenLabel(r.lastSeen, now).n ?? 0) > 7 || !r.lastSeen;
  const list = useMemo(() => rows
    .filter((r) => filter === "all" || (filter === "onboarding" ? r.status === "onboarding" : filter === "active" ? !idle(r) && r.status !== "onboarding" : idle(r)))
    .sort(bySeenDesc), [rows, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = { all: rows.length, onboarding: rows.filter((r) => r.status === "onboarding").length, active: rows.filter((r) => !idle(r) && r.status !== "onboarding").length, idle: rows.filter(idle).length };
  const seen = (r: Row) => { const s = seenLabel(r.lastSeen, now); return t(lang, s.key, { n: s.n ?? 0, date: s.date ?? "" }); };

  return <>
    <div className="chip-row roster-filters">
      {(["all", "onboarding", "active", "idle"] as const).map((f) => <button key={f} type="button" className={filter === f ? "chip active" : "chip"} onClick={() => { setFilter(f); setShown(PAGE); }}>{t(lang, `roster_f_${f}` as Key)} · {counts[f]}</button>)}
    </div>
    <table className="roster-table">
      <thead><tr><th>{t(lang, "roster_col_user")}</th><th>{t(lang, "roster_col_seen")}</th><th className="num">{t(lang, "roster_col_acts")}</th></tr></thead>
      <tbody>
        {list.slice(0, shown).map((r) => {
          const blocked = r.status === "banned";
          const isOpen = open === r.id;
          return [
            <tr key={r.id} className={isOpen ? "open" : ""} onClick={() => { setOpen(isOpen ? null : r.id); setConfirmDelete(null); }}>
              <td><strong>{r.name}</strong><small>{t(lang, `roster_st_${r.status}` as Key)}{r.onb ? ` ${r.onb}` : ""}{r.trainer ? ` · ${r.trainer}` : ""}</small></td>
              <td>{seen(r)}</td>
              <td className="num" title={`🏋️ ${r.w} · ✅ ${r.c} · 🍽 ${r.n} · 👟 ${r.s}`}>{r.total}</td>
            </tr>,
            isOpen && <tr key={`${r.id}-a`} className="roster-actions"><td colSpan={3}>
              <small className="muted">{r.nick ? `${r.nick} · ` : ""}🏋️ {r.w} · ✅ {r.c} · 🍽 {r.n} · 👟 {r.s}</small>
              <div className="button-row">
                {r.status === "onboarding" && <button className="button button-primary" disabled={busy === `nudge:${r.id}` || nudged.has(r.id)} onClick={() => onAction(r.id, "nudge")}>{nudged.has(r.id) ? t(lang, "roster_nudged") : busy === `nudge:${r.id}` ? "…" : t(lang, "roster_nudge_btn")}</button>}
                <button className="button button-ghost" disabled={busy === `${blocked ? "unblock" : "block"}:${r.id}`} onClick={() => onAction(r.id, blocked ? "unblock" : "block")}>{t(lang, blocked ? "owner_unblock_btn" : "owner_block_btn")}</button>
                {confirmDelete === r.id
                  ? <button className="button button-ghost danger" disabled={busy === `delete:${r.id}`} onClick={() => onAction(r.id, "delete")}>{t(lang, "owner_delete_confirm_btn")}</button>
                  : <button className="text-button" onClick={() => setConfirmDelete(r.id)}>{t(lang, "owner_delete_btn")}</button>}
              </div>
            </td></tr>,
          ];
        })}
      </tbody>
    </table>
    {list.length === 0 && <p className="muted">{t(lang, "roster_empty")}</p>}
    {shown < list.length && <button className="button button-ghost" onClick={() => setShown(shown + PAGE)}>{t(lang, "library_more", { n: list.length - shown })}</button>}
  </>;
}
