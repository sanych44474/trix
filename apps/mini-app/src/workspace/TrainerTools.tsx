// Trainer tools: program sharing (publish a template to the library or as a link, publish my own
// plan, assign a template to selected clients) and the weekly client report. The same data and
// rules as the bot's share flow and /trreport.
import { useEffect, useState } from "react";
import { api, typedBody } from "../api";
import { t, type Lang } from "../i18n";
import { Panel, WorkspaceError, type ClientSummary, type TrainerTemplates } from "./shared";

export function ProgramSharingView({ lang, clients, onBack }: { lang: Lang; clients: ClientSummary[]; onBack: () => void }) {
  const [templates, setTemplates] = useState<TrainerTemplates["templates"] | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [myName, setMyName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const load = () => {
    setError(false);
    api<TrainerTemplates>("/api/v2/trainer/templates").then((r) => setTemplates(r.templates)).catch(() => setError(true));
  };
  useEffect(load, []);

  const toggle = (id: number) => setPicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  const publish = async (mode: "library" | "link") => {
    setBusy(`pub:${mode}`); setNote(null); setLink(null); setError(false);
    try {
      const r = await api<{ code: string; name: string; link?: string }>("/api/v2/trainer/share/template", {
        method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"shareTrainerTemplate">({ templateId: Number(templateId), mode }),
      });
      if (r.link) setLink(r.link);
      else setNote(t(lang, "tt_published_note", { name: r.name }));
    } catch { setError(true); } finally { setBusy(null); }
  };

  const publishMine = async () => {
    setBusy("mine"); setNote(null); setLink(null); setError(false);
    try {
      const r = await api<{ code: string; name: string }>("/api/v2/trainer/share/plan", {
        method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"shareTrainerOwnPlan">({ name: myName.trim() }),
      });
      setNote(t(lang, "tt_published_note", { name: r.name }));
      setMyName("");
    } catch { setError(true); } finally { setBusy(null); }
  };

  const assign = async () => {
    setBusy("assign"); setNote(null); setLink(null); setError(false);
    try {
      const r = await api<{ assigned: number; total: number }>("/api/v2/trainer/share/assign", {
        method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"assignTrainerTemplate">({ templateId: Number(templateId), clientIds: picked }),
      });
      setNote(t(lang, "tt_assign_done", { ok: r.assigned, total: r.total }));
      setPicked([]);
    } catch { setError(true); } finally { setBusy(null); }
  };

  return <div className="view-stack">
    <div className="eyebrow">{t(lang, "tt_share_eyebrow")}</div>
    <div className="page-title"><h1>{t(lang, "tt_share_title")}</h1><button className="text-button" onClick={onBack}>{t(lang, "close")}</button></div>
    <small className="muted">{t(lang, "tt_share_hint")}</small>
    {error && <Panel tone="muted"><div className="error-state"><strong>{t(lang, "generic_error")}</strong><button className="button button-ghost" onClick={() => setError(false)}>{t(lang, "close")}</button></div></Panel>}
    {templates === null && !error ? <div className="skeleton" /> : null}

    {templates !== null && <Panel>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "tt_publish_title")}</span><h2>{t(lang, "tt_publish_heading")}</h2></div></div>
      {templates.length === 0 ? <p className="muted">{t(lang, "no_templates_hint")}</p> : <>
        <select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
          <option value="">{t(lang, "pick_template_label")}</option>
          {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
        </select>
        <div className="button-row">
          <button className="button button-primary" disabled={busy !== null || !templateId} onClick={() => void publish("library")}>{busy === "pub:library" ? "…" : t(lang, "tt_publish_library_btn")}</button>
          <button className="button button-ghost" disabled={busy !== null || !templateId} onClick={() => void publish("link")}>{busy === "pub:link" ? "…" : t(lang, "tt_publish_link_btn")}</button>
        </div>
      </>}
      {link && <div className="save-note"><strong>{t(lang, "tt_link_ready")}</strong> <small>{link}</small></div>}
    </Panel>}

    <Panel tone="muted">
      <div className="section-head"><div><span className="eyebrow">{t(lang, "tt_publish_title")}</span><h2>{t(lang, "tt_publish_mine_btn")}</h2></div></div>
      <div className="input-row">
        <input value={myName} maxLength={48} placeholder={t(lang, "tt_my_plan_name_ph")} onChange={(event) => setMyName(event.target.value)} />
        <button className="button button-ghost" disabled={busy !== null || !myName.trim()} onClick={() => void publishMine()}>{busy === "mine" ? "…" : t(lang, "tt_publish_mine_btn")}</button>
      </div>
    </Panel>

    <Panel>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "tt_assign_eyebrow")}</span><h2>{t(lang, "tt_assign_title")}</h2></div></div>
      {clients.length === 0 ? <p className="muted">{t(lang, "tt_no_clients")}</p> : <>
        <div className="client-list">{clients.map((client) => <label className="client-row" key={client.id}>
          <span><input type="checkbox" checked={picked.includes(client.id)} onChange={() => toggle(client.id)} /> {client.name}</span>
        </label>)}</div>
        <div className="button-row">
          <button className="button button-primary" disabled={busy !== null || !templateId || picked.length === 0} onClick={() => void assign()}>{busy === "assign" ? t(lang, "saving_ellipsis") : t(lang, "tt_assign_btn", { n: picked.length })}</button>
        </div>
        {!templateId && <small className="muted">{t(lang, "tt_pick_template_first")}</small>}
      </>}
    </Panel>
    {note && <div className="save-note">{note}</div>}
  </div>;
}

type TrainerReport = {
  clientCount: number;
  active7: number;
  activePct: number;
  rows: Array<{
    id: number;
    name: string | null;
    username: string | null;
    onboarded: boolean;
    interview: { filled: number; total: number };
    plan: { active: boolean; draft: boolean };
    events: { workouts: number; checkins: number; nutrition: number; steps: number };
    lastSeen: string | null;
    botBlocked: boolean;
  }>;
};

export function TrainerReportView({ lang, onBack }: { lang: Lang; onBack: () => void }) {
  const [data, setData] = useState<TrainerReport | null>(null);
  const [error, setError] = useState(false);
  const load = () => {
    setError(false);
    api<TrainerReport>("/api/v2/trainer/report").then(setData).catch(() => setError(true));
  };
  useEffect(load, []);

  if (error) return <WorkspaceError lang={lang} onRetry={load} />;
  if (!data) return <div className="workspace-loading"><div className="skeleton" /><div className="skeleton" /></div>;

  return <div className="view-stack">
    <div className="eyebrow">{t(lang, "tt_report_eyebrow")}</div>
    <div className="page-title"><h1>{t(lang, "tt_report_title")}</h1><button className="text-button" onClick={onBack}>{t(lang, "close")}</button></div>
    <Panel tone="accent">
      <div className="section-head"><div><span className="eyebrow">{t(lang, "tt_report_biz")}</span></div></div>
      <p>{t(lang, "tt_report_active", { a: data.active7, n: data.clientCount, p: data.activePct })}</p>
    </Panel>
    {data.rows.length === 0 ? <p className="muted">{t(lang, "tt_no_clients")}</p> : <div className="client-list">{data.rows.map((row) => <div className="client-row" key={row.id}>
      <div>
        <strong>{row.name ?? `#${row.id}`}</strong>
        <small>{row.username ? `@${row.username}` : "—"} · {row.onboarded ? t(lang, "tt_report_interview_ok") : `${row.interview.filled}/${row.interview.total}`}</small>
        <small className="muted">{t(lang, "tt_report_events", { w: row.events.workouts, c: row.events.checkins, n: row.events.nutrition, s: row.events.steps })} · {row.lastSeen ? row.lastSeen.slice(5, 10) : "—"}</small>
      </div>
      <div className="button-row">
        <span className={row.plan.active ? "status-badge" : "status-badge status-attention"}>{row.plan.active ? t(lang, "tt_plan_active") : t(lang, "tt_plan_none")}</span>
        {row.botBlocked && <span className="status-badge status-attention">{t(lang, "tt_bot_blocked")}</span>}
      </div>
    </div>)}</div>}
    <small className="muted">{t(lang, "tt_report_legend")}</small>
  </div>;
}
