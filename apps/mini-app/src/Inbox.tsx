// The notification feed: what happened worth seeing again -- a plan assigned or changed by the
// trainer, a trainer's message, a new badge, the weekly progression (server: adapters/d1/v2Inbox.ts).
// A bell in the top bar shows the unread count; opening the feed marks everything read.
import { useEffect, useState } from "react";
import { api } from "./api";
import { t, type Lang } from "./i18n";

export type InboxKind = "plan_assigned" | "plan_changed" | "message" | "badge" | "progression" | "feedback_done" | "squad_pr" | "squad_week";
export interface InboxItem { id: number; kind: InboxKind; params: Record<string, unknown>; createdAt: string; read: boolean }
type Target = "plan" | "progress" | "role" | "today" | "more";

const ICON: Record<InboxKind, string> = { plan_assigned: "📋", plan_changed: "✏️", message: "💬", badge: "🏅", progression: "📈", feedback_done: "✅", squad_pr: "🏆", squad_week: "👥" };
const TARGET: Record<InboxKind, Target> = { plan_assigned: "plan", plan_changed: "plan", message: "role", badge: "progress", progression: "plan", feedback_done: "today", squad_pr: "more", squad_week: "more" };

function when(lang: Lang, iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return d.toLocaleTimeString(lang === "en" ? "en-GB" : "uk-UA", { hour: "2-digit", minute: "2-digit" });
  if (days === 1) return t(lang, "seen_yesterday");
  return d.toLocaleDateString(lang === "en" ? "en-GB" : "uk-UA", { day: "numeric", month: "short" });
}

export function inboxText(lang: Lang, item: InboxItem): string {
  const p = item.params;
  switch (item.kind) {
    case "plan_assigned": return t(lang, "inbox_plan_assigned");
    case "plan_changed": return t(lang, "inbox_plan_changed");
    case "message": return t(lang, "inbox_message", { name: String(p.fromName || "—"), text: String(p.preview ?? "") });
    case "badge": return t(lang, "inbox_badge", { name: String((lang === "en" ? p.en : p.uk) ?? p.code ?? "") });
    case "progression": return t(lang, "inbox_progression", { n: Number(p.n ?? 0) });
    case "feedback_done": return t(lang, "inbox_feedback_done", { text: String(p.preview ?? "") });
    case "squad_pr": return t(lang, "inbox_squad_pr", { name: String(p.name ?? ""), exercise: String(p.exercise ?? ""), best: String(p.best ?? "") });
    case "squad_week": {
      const top = Array.isArray(p.top) ? (p.top as Array<{ medal?: string; name?: string; workouts?: number }>).map((e) => `${e.medal ?? ""} ${e.name ?? ""} ${e.workouts ?? 0}`.trim()).join(" · ") : "";
      return t(lang, p.past ? "inbox_squad_week_past" : "inbox_squad_week", { title: String(p.title || t(lang, "squads_default_title")), top, total: Number(p.total ?? 0) });
    }
  }
}

export function InboxBell({ lang, open, onOpen }: { lang: Lang; open: boolean; onOpen: () => void }) {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (open) { setUnread(0); return; }
    api<{ unread: number }>("/api/v2/inbox").then((r) => setUnread(r.unread)).catch(() => {});
  }, [open]);
  return (
    <button className="icon-button bell" onClick={onOpen} aria-label={t(lang, "inbox_title")}>
      🔔{unread > 0 && <span className="bell-dot" aria-label={String(unread)}>{unread > 9 ? "9+" : unread}</span>}
    </button>
  );
}

export function InboxView({ lang, onBack, onGo }: { lang: Lang; onBack: () => void; onGo: (target: Target) => void }) {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api<{ items: InboxItem[] }>("/api/v2/inbox")
      .then((r) => { setItems(r.items); void api("/api/v2/inbox/read", { method: "POST" }).catch(() => {}); })
      .catch(() => setFailed(true));
  }, []);
  return (
    <div className="view-stack">
      <div className="page-title"><h1>{t(lang, "inbox_title")}</h1><button className="text-button" onClick={onBack}>{t(lang, "close")}</button></div>
      {failed && <div className="card card-muted">{t(lang, "generic_error")}</div>}
      {items && !items.length && <div className="card card-muted"><p className="muted">{t(lang, "inbox_empty")}</p></div>}
      {items && items.length > 0 && (
        <div className="inbox-list">
          {items.map((item, i) => (
            <button key={item.id} className={item.read ? "inbox-item" : "inbox-item unread"} style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }} onClick={() => onGo(TARGET[item.kind])}>
              <span className="inbox-icon" aria-hidden="true">{ICON[item.kind]}</span>
              <span className="inbox-text">{inboxText(lang, item)}</span>
              <small className="inbox-when">{when(lang, item.createdAt)}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
