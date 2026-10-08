// The owner console: report tabs, roster, feedback triage and the release broadcast.
import { useEffect, useState } from "react";
import { api, jsonBody, typedBody } from "../api";
import { OwnerFeedback } from "../OwnerFeedback";
import { OwnerRoster, type RosterAction } from "../OwnerRoster";
import type { OwnerUsers } from "../types";
import { t, type Lang } from "../i18n";
import { plainReport, OWNER_REPORT_SECTIONS, OWNER_TABS, type OwnerSection } from "../logic/workspace";
import { OwnerReport, Panel, WorkspaceError } from "./shared";


export function OwnerWorkspace({ lang }: { lang: Lang }) {
  const [users, setUsers] = useState<OwnerUsers | null>(null);
  const [section, setSection] = useState<OwnerSection>("overview");
  const [reports, setReports] = useState<Partial<Record<OwnerSection, string>>>({});
  const [sectionBusy, setSectionBusy] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const [error, setError] = useState(false);
  // Separate from `error` on purpose: `error` means "couldn't load the roster, nothing to show".
  // A single report-tab fetch, block/unblock/delete, or "ask inactive" failing is recoverable and
  // must not blank the whole console out from under the owner mid-action; it shows inline instead.
  const [actionError, setActionError] = useState(false);
  const [rosterBusy, setRosterBusy] = useState<string | null>(null);
  const [nudged, setNudged] = useState<Set<number>>(new Set());

  const loadUsers = () => { setError(false); return api<OwnerUsers>("/api/v2/owner/users").then(setUsers).catch(() => setError(true)); };
  const loadSection = (id: OwnerSection, force = false) => {
    if (id === "roster" || id === "feedback" || (!force && reports[id] !== undefined)) return;
    setSectionBusy(true);
    api<OwnerReport>(`/api/v2/owner/report?section=${id}`)
      .then((result) => setReports((current) => ({ ...current, [id]: result.html })))
      .catch(() => setActionError(true))
      .finally(() => setSectionBusy(false));
  };
  useEffect(() => { void loadUsers(); loadSection("overview"); }, []);
  const selectSection = (id: OwnerSection) => { setSection(id); loadSection(id); };
  const retry = () => { setError(false); void loadUsers(); loadSection(section, true); };

  const askInactive = async () => { try { const result = await api<{ sent: number }>("/api/v2/owner/ask-inactive", { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({}) }); setSent(result.sent); } catch { setActionError(true); } };
  // Block/unblock/delete ANY user. Delete is a two-tap gate matching the bot's own ownerUserKb
  // confirm (ou:*:del shows confirm/cancel, only ou:*:delok deletes) -- pendingDelete tracks which
  // row is mid-confirm; a second explicit tap on "Yes, delete" is what actually calls the route.
  const userAction = async (id: number, action: RosterAction) => {
    setRosterBusy(`${action}:${id}`);
    try {
      await api(`/api/v2/owner/user/${id}/${action}`, { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({}) });
      if (action === "nudge") { setNudged((current) => new Set(current).add(id)); return; }
      await loadUsers();
    } catch { setActionError(true); } finally { setRosterBusy(null); }
  };
  if (error) return <WorkspaceError lang={lang} onRetry={retry} />;
  if (!users) return <div className="workspace-loading"><div className="skeleton" /><div className="skeleton" /></div>;

  const activeReport = section === "roster" || section === "feedback" ? undefined : OWNER_REPORT_SECTIONS.find((s) => s.id === section);
  const activeHtml = activeReport ? reports[activeReport.id] : undefined;

  return <div className="view-stack">
    <div className="eyebrow">{t(lang, "owner_ops_eyebrow")}</div>
    <div className="page-title"><h1>{t(lang, "system_pulse_title")}</h1><span>{t(lang, "n_users", { n: users.rows.length })}</span></div>
    {actionError && <Panel tone="muted"><div className="error-state"><strong>{t(lang, "generic_error")}</strong><button className="button button-ghost" onClick={() => setActionError(false)}>{t(lang, "close")}</button></div></Panel>}
    <ReleaseBroadcastPanel lang={lang} />
    <AnnouncePanel lang={lang} />
    <PromoImagePanel lang={lang} />
    {/* All sections at once as a grid of icon chips -- the old one-line scroller hid the last
        tabs off-screen on a phone. */}
    <nav className="owner-tabs" aria-label={t(lang, "owner_ops_eyebrow")}>
      {OWNER_TABS.map((s) => (
        <button key={s.id} type="button" aria-current={section === s.id ? "page" : undefined}
          className={section === s.id ? "owner-tab active" : "owner-tab"}
          disabled={sectionBusy && section !== s.id} onClick={() => selectSection(s.id)}>
          <span aria-hidden="true">{s.icon}</span>{t(lang, s.tab)}
        </button>
      ))}
    </nav>

    {section === "roster" && <Panel>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "roster_eyebrow")}</span><h2>{t(lang, "recent_users_title")}</h2></div><span className="tag">{users.rows.length}</span></div>
      <OwnerRoster lang={lang} rows={users.rows} busy={rosterBusy} nudged={nudged} onAction={(id, action) => void userAction(id, action)} />
    </Panel>}

    {section === "feedback" && <Panel>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "fbt_eyebrow")}</span><h2>{t(lang, "fbt_title")}</h2></div></div>
      <OwnerFeedback lang={lang} />
    </Panel>}

    {activeReport && <Panel>
      <div className="section-head">
        <div><span className="eyebrow">{t(lang, activeReport.eyebrow)}</span><h2>{t(lang, activeReport.title)}</h2></div>
        {activeReport.id === "overview" && <button className="button button-ghost" onClick={() => void askInactive()}>{t(lang, "ask_inactive_btn")}</button>}
      </div>
      {activeHtml === undefined ? <div className="skeleton" /> : <pre className="owner-report">{plainReport(activeHtml)}</pre>}
      {activeReport.id === "overview" && sent !== null && <div className="save-note">{t(lang, "sent_to_n_users", { n: sent })}</div>}
    </Panel>}
  </div>;
}

// Release notes to every chat from the console (bot/releaseBroadcast.ts): shows how many chats are
// still owed the latest version, asks once, then sends a batch per tap -- resumable, never twice.
export function ReleaseBroadcastPanel({ lang }: { lang: Lang }) {
  const [info, setInfo] = useState<{ version: string; pending: number } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ sent: number; failed: number; remaining: number } | null>(null);
  const [error, setError] = useState(false);
  const load = () => api<{ version: string; pending: number }>("/api/v2/owner/release").then(setInfo).catch(() => setError(true));
  useEffect(() => { void load(); }, []);
  if (!info) return null;
  const send = async () => {
    setBusy(true); setError(false);
    try {
      const r = await api<{ version: string; sent: number; failed: number; remaining: number }>("/api/v2/owner/release/send", { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({}) });
      setResult(r);
      setInfo({ version: r.version, pending: r.remaining });
      setConfirm(false);
    } catch { setError(true); } finally { setBusy(false); }
  };
  return <Panel>
    <div className="section-head"><div><span className="eyebrow">{t(lang, "owner_release_eyebrow")}</span><h2>{t(lang, "owner_release_title")}</h2></div></div>
    <p className="muted">{info.pending > 0 ? t(lang, "owner_release_pending", { v: info.version, n: info.pending }) : t(lang, "owner_release_none", { v: info.version })}</p>
    {result && <p>{t(lang, "owner_release_result", result)}</p>}
    {error && <p className="muted">{t(lang, "generic_error")}</p>}
    {info.pending > 0 && <div className="button-row">
      {confirm
        ? <>
            <button className="button button-primary" disabled={busy} onClick={() => void send()}>{busy ? "…" : t(lang, "owner_release_confirm", { n: Math.min(25, info.pending) })}</button>
            <button className="button button-ghost" disabled={busy} onClick={() => setConfirm(false)}>{t(lang, "close")}</button>
          </>
        : <button className="button button-ghost" onClick={() => setConfirm(true)}>{t(lang, "owner_release_send", { n: Math.min(25, info.pending) })}</button>}
    </div>}
    <p className="muted">{t(lang, "owner_release_hint")}</p>
  </Panel>;
}

// An announcement to every user (the in-app /announce): write it, confirm, then it goes out in
// batches of 25 per tap, continuing from where the last batch stopped.
export function AnnouncePanel({ lang }: { lang: Lang }) {
  const [text, setText] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ sent: number; failed: number; remaining: number; total: number; next: number | null } | null>(null);
  const [error, setError] = useState(false);
  const send = async () => {
    setBusy(true); setError(false);
    try {
      const r = await api<{ sent: number; failed: number; remaining: number; total: number; next: number | null }>("/api/v2/owner/announce", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"ownerAnnounce">({ text: text.trim(), ...(progress?.next ? { after: progress.next } : {}) }) });
      setProgress((prev) => ({ ...r, sent: (prev?.sent ?? 0) + r.sent, failed: (prev?.failed ?? 0) + r.failed }));
      setConfirm(false);
    } catch { setError(true); } finally { setBusy(false); }
  };
  const finished = progress !== null && progress.next === null;
  return <Panel>
    <div className="section-head"><div><span className="eyebrow">{t(lang, "owner_announce_eyebrow")}</span><h2>{t(lang, "owner_announce_title")}</h2></div></div>
    <textarea className="owner-announce" value={text} maxLength={3000} rows={4} disabled={progress !== null && !finished} placeholder={t(lang, "owner_announce_ph")} onChange={(e) => setText(e.target.value)} />
    {progress && <p>{t(lang, "owner_announce_progress", { sent: progress.sent, failed: progress.failed, remaining: progress.remaining })}</p>}
    {error && <p className="muted">{t(lang, "generic_error")}</p>}
    <div className="button-row">
      {finished
        ? <button className="button button-ghost" onClick={() => { setProgress(null); setText(""); }}>{t(lang, "owner_announce_new")}</button>
        : confirm
          ? <>
              <button className="button button-primary" disabled={busy || !text.trim()} onClick={() => void send()}>{busy ? "…" : t(lang, progress ? "owner_announce_continue" : "owner_announce_confirm")}</button>
              <button className="button button-ghost" disabled={busy} onClick={() => setConfirm(false)}>{t(lang, "close")}</button>
            </>
          : <button className="button button-ghost" disabled={!text.trim()} onClick={() => setConfirm(true)}>{t(lang, progress ? "owner_announce_continue" : "owner_announce_send")}</button>}
    </div>
  </Panel>;
}

// A promo / story picture from a prompt (FLUX on Workers AI); it arrives in the owner's chat.
export function PromoImagePanel({ lang }: { lang: Lang }) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"sent" | "budget" | "error" | null>(null);
  const make = async () => {
    setBusy(true); setStatus(null);
    try {
      const r = await api<{ ok: boolean }>("/api/v2/owner/image", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"ownerImage">({ prompt: prompt.trim() }) });
      setStatus(r.ok ? "sent" : "error");
    } catch (err) {
      setStatus((err as { status?: number })?.status === 429 ? "budget" : "error");
    } finally { setBusy(false); }
  };
  return <Panel>
    <div className="section-head"><div><span className="eyebrow">{t(lang, "owner_image_eyebrow")}</span><h2>{t(lang, "owner_image_title")}</h2></div></div>
    <textarea className="owner-announce" value={prompt} maxLength={1000} rows={3} placeholder={t(lang, "owner_image_ph")} onChange={(e) => setPrompt(e.target.value)} />
    {status && <p className="muted">{t(lang, status === "sent" ? "owner_image_sent" : status === "budget" ? "owner_image_budget" : "generic_error")}</p>}
    <div className="button-row">
      <button className="button button-primary" disabled={busy || prompt.trim().length < 3} onClick={() => void make()}>{busy ? "…" : t(lang, "owner_image_make")}</button>
    </div>
    <p className="muted">{t(lang, "owner_image_hint")}</p>
  </Panel>;
}
