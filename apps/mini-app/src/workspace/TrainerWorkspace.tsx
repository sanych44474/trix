// The trainer space: client list, at-risk report, schedule, finance and the trainer profile.
import { useEffect, useState } from "react";
import { api, jsonBody, typedBody } from "../api";
import { TrainerInviteCard } from "../TrainerInvite";
import { FirstClientChecklist } from "../FirstClient";
import type { Dashboard, FinancePayload, RequestBody, SchedulePayload, TrainerProfile } from "../types";
import { t, type Key, type Lang } from "../i18n";
import { showWhen, statusKey, toInstant } from "../logic/workspace";
import { TrainerQuestions, TrainerRequests, TrainerTemplates, ClientSummary, TrainerProfilePayload, Panel, WorkspaceError, Metric , type WorkspaceProps } from "./shared";
import { ClientCardView } from "./ClientCardView";
import { AiCoachView } from "./AiCoachView";

export function TrainerProfilePanel({ lang, onBack }: { lang: Lang; onBack: () => void }) {
  const [data, setData] = useState<TrainerProfilePayload | null>(null);
  const [form, setForm] = useState<TrainerProfile | null>(null);
  const [error, setError] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const load = () => { setError(false); api<TrainerProfilePayload>("/api/v2/trainer/profile").then((next) => { setData(next); setForm(next.trainer); }).catch(() => setError(true)); };
  useEffect(load, []);
  if (error) return <WorkspaceError lang={lang} onRetry={load} />;
  if (!data) return <div className="workspace-loading"><div className="skeleton" /><div className="skeleton" /></div>;
  // data loaded but no v2_trainers row: the caller isn't a trainer. Without this the panel sat on
  // the loading skeleton forever, because `form` stays null and only `data` ever arrives.
  if (!form) return <div className="view-stack">
    <div className="eyebrow">{t(lang, "my_profile_eyebrow")}</div>
    <div className="page-title"><h1>{t(lang, "trainer_not_yet_title")}</h1><button className="text-button" onClick={onBack}>{t(lang, "close")}</button></div>
    <Panel tone="muted"><p className="muted">{t(lang, "trainer_not_yet_body")}</p></Panel>
  </div>;
  const patch = (value: Partial<TrainerProfile>) => setForm((current) => current ? { ...current, ...value } : current);
  const save = async () => {
    setSaving(true); setSaved(false);
    try {
      await api("/api/v2/trainer/profile", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"updateTrainerProfile">({ name: form.name, bio: form.bio, specialization: form.specialization, approach: form.approach, experienceYears: form.experienceYears, priceOnline: form.priceOnline, city: form.city, contact: form.contact, accepting: form.accepting }) });
      setSaved(true);
    } catch { setActionError(true); } finally { setSaving(false); }
  };
  return <div className="view-stack">
    <div className="eyebrow">{t(lang, "my_profile_eyebrow")}</div>
    <div className="page-title"><h1>{t(lang, "my_profile_title")}</h1><button className="text-button" onClick={onBack}>{t(lang, "close")}</button></div>
    {actionError && <Panel tone="muted"><div className="error-state"><strong>{t(lang, "generic_error")}</strong><button className="button button-ghost" onClick={() => setActionError(false)}>{t(lang, "close")}</button></div></Panel>}
    <Panel tone="muted">
      <div className="section-head">
        <div><span className="eyebrow">{t(lang, `trainer_status_${form.status}_title` as Key)}</span><h2>{t(lang, "trainer_clients_count", { n: form.clients })}</h2></div>
        <span className={form.status === "approved" ? "status-badge" : "status-badge status-attention"}>{t(lang, `trainer_status_badge_${form.status}` as Key)}</span>
      </div>
      <p className="muted">{t(lang, `trainer_status_${form.status}_body` as Key)}</p>
    </Panel>
    <Panel>
      <div className="form-grid">
        <label className="form-field"><span>{t(lang, "field_name")}</span><input value={form.name} maxLength={60} onChange={(event) => patch({ name: event.target.value })} /></label>
        <label className="form-field"><span>{t(lang, "field_specialization")}</span><input value={form.specialization} maxLength={120} onChange={(event) => patch({ specialization: event.target.value })} /></label>
        <label className="form-field"><span>{t(lang, "field_experience_years")}</span><input type="number" min="0" max="60" value={form.experienceYears ?? ""} onChange={(event) => patch({ experienceYears: event.target.value ? Number(event.target.value) : null })} /></label>
        <label className="form-field"><span>{t(lang, "field_price_online")}</span><input type="number" min="0" max="100000" value={form.priceOnline ?? ""} onChange={(event) => patch({ priceOnline: event.target.value ? Number(event.target.value) : null })} /></label>
        <label className="form-field"><span>{t(lang, "field_city")}</span><input value={form.city} maxLength={60} onChange={(event) => patch({ city: event.target.value })} /></label>
        <label className="form-field"><span>{t(lang, "field_contact")}</span><input value={form.contact} maxLength={120} onChange={(event) => patch({ contact: event.target.value })} /></label>
      </div>
      <label className="form-field"><span>{t(lang, "field_bio")}</span><textarea value={form.bio} maxLength={600} onChange={(event) => patch({ bio: event.target.value })} /></label>
      <label className="form-field"><span>{t(lang, "field_approach")}</span><textarea value={form.approach} maxLength={600} onChange={(event) => patch({ approach: event.target.value })} /></label>
      <label className="check-row"><input type="checkbox" checked={form.accepting} onChange={(event) => patch({ accepting: event.target.checked })} /><span>{t(lang, "accepting_clients_label")}</span></label>
      {saved && <div className="save-note">{t(lang, "profile_updated_note")}</div>}
      <div className="button-row"><button className="button button-primary" disabled={saving} onClick={() => void save()}>{saving ? t(lang, "saving_ellipsis") : t(lang, "save_profile_btn")}</button></div>
    </Panel>
  </div>;
}

/** Dedicated at-risk report: everything TrainerWorkspace's client-pulse list already flags
 * (flagged OR atRisk), un-sliced, with the missed-planned-dates detail dashboardReader.ts already
 * computes (missedConsecutiveWorkouts) but the client list itself only ever surfaced as a boolean. */
export function AtRiskReportView({ dashboard, lang, onBack, onOpenClient }: { dashboard: Dashboard; lang: Lang; onBack: () => void; onOpenClient: (id: number) => void }) {
  const clients = (dashboard.trainer?.clients ?? []).filter((client) => client.atRisk || client.flagged);
  return <div className="view-stack">
    <div className="eyebrow">{t(lang, "atrisk_eyebrow")}</div>
    <div className="page-title"><h1>{t(lang, "atrisk_title", { n: clients.length })}</h1><button className="text-button" onClick={onBack}>{t(lang, "close")}</button></div>
    {clients.length
      ? <div className="client-list">{clients.map((client) => <div className="client-row" key={client.id}>
          <div>
            <strong>{client.name}</strong>
            <small>{t(lang, "client_pcts", { w: client.workoutPct, n: client.nutritionPct })}</small>
            {client.missedDates && <small className="muted">{t(lang, "atrisk_missed_dates", { a: client.missedDates[0], b: client.missedDates[1] })}</small>}
          </div>
          <div className="button-row">
            <span className="status-badge status-attention">{client.flagged ? t(lang, "flagged_label") : t(lang, "at_risk_label")}</span>
            <button className="button button-ghost" onClick={() => onOpenClient(client.id)}>{t(lang, "open_client_btn")}</button>
          </div>
        </div>)}</div>
      : <p className="muted">{t(lang, "atrisk_empty")}</p>}
  </div>;
}

export function ScheduleView({ lang, onBack }: { lang: Lang; onBack: () => void }) {
  const [data, setData] = useState<SchedulePayload | null>(null);
  const [error, setError] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [durationMin, setDurationMin] = useState("60");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");

  const load = () => { setError(false); api<SchedulePayload>("/api/v2/trainer/sessions").then(setData).catch(() => setError(true)); };
  useEffect(load, []);

  const act = async (key: string, body: RequestBody<"mutateTrainerSessions">) => {
    setBusy(key);
    try { await api("/api/v2/trainer/sessions", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"mutateTrainerSessions">(body) }); load(); }
    catch { setActionError(true); } finally { setBusy(null); }
  };
  const book = () => {
    if (!clientId || !startsAt) return;
    void act("create", { action: "create", clientId: Number(clientId), startsAt: toInstant(startsAt), durationMin: Number(durationMin) || 60, price: price ? Number(price) : null, note })
      .then(() => { setStartsAt(""); setPrice(""); setNote(""); });
  };

  if (error) return <WorkspaceError lang={lang} onRetry={load} />;
  if (!data) return <div className="workspace-loading"><div className="skeleton" /><div className="skeleton" /></div>;

  return <div className="view-stack">
    <div className="eyebrow">{t(lang, "schedule_eyebrow")}</div>
    <div className="page-title"><h1>{t(lang, "schedule_title")}</h1><button className="text-button" onClick={onBack}>{t(lang, "close")}</button></div>
    {actionError && <Panel tone="muted"><div className="error-state"><strong>{t(lang, "generic_error")}</strong><button className="button button-ghost" onClick={() => setActionError(false)}>{t(lang, "close")}</button></div></Panel>}

    <Panel>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "schedule_add_title")}</span></div></div>
      <div className="form-grid">
        <label className="form-field"><span>{t(lang, "pick_client_label")}</span><select value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">{t(lang, "pick_client_label")}</option>{data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="form-field"><span>{t(lang, "field_datetime")}</span><input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>
        <label className="form-field"><span>{t(lang, "field_duration_min")}</span><input type="number" min="5" max="600" value={durationMin} onChange={(event) => setDurationMin(event.target.value)} /></label>
        <label className="form-field"><span>{t(lang, "field_price")}</span><input type="number" min="0" value={price} onChange={(event) => setPrice(event.target.value)} /></label>
      </div>
      <label className="form-field"><span>{t(lang, "field_note")}</span><input value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} /></label>
      <div className="button-row"><button className="button button-primary" disabled={busy !== null || !clientId || !startsAt} onClick={book}>{busy === "create" ? t(lang, "saving_ellipsis") : t(lang, "schedule_add_btn")}</button></div>
    </Panel>

    <Panel>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "schedule_eyebrow")}</span><h2>{t(lang, "schedule_title")}</h2></div><span className="tag">{data.sessions.length}</span></div>
      {data.sessions.length ? <div className="record-list">{data.sessions.map((s) => <div className="record-row" key={s.id}>
        <div>
          <strong>{s.clientName}</strong>
          <small>{showWhen(s.startsAt)} · {t(lang, "session_len_line", { n: s.durationMin })}{s.price !== null ? ` · ${s.price}` : ""}{s.note ? ` · ${s.note}` : ""}</small>
          <div className="button-row">
            {(["done", "cancelled", "no_show"] as const).map((next) => <button className="button button-ghost" key={next} disabled={busy !== null || s.status === next} onClick={() => void act(`s:${s.id}`, { action: "status", id: s.id, status: next })}>{t(lang, statusKey(next))}</button>)}
            <button className="text-button danger-button" disabled={busy !== null} onClick={() => void act(`d:${s.id}`, { action: "delete", id: s.id })}>{t(lang, "delete_btn")}</button>
          </div>
        </div>
        <span className={s.status === "planned" ? "status-badge status-attention" : "status-badge"}>{t(lang, statusKey(s.status))}</span>
      </div>)}</div> : <p className="muted">{t(lang, "schedule_empty")}</p>}
    </Panel>
  </div>;
}

export function FinanceView({ lang, onBack }: { lang: Lang; onBack: () => void }) {
  const [data, setData] = useState<FinancePayload | null>(null);
  const [error, setError] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");

  const load = () => { setError(false); api<FinancePayload>("/api/v2/trainer/finance").then(setData).catch(() => setError(true)); };
  useEffect(load, []);

  const act = async (key: string, body: RequestBody<"mutateTrainerFinance">) => {
    setBusy(key);
    try { await api("/api/v2/trainer/finance", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"mutateTrainerFinance">(body) }); load(); }
    catch { setActionError(true); } finally { setBusy(null); }
  };

  if (error) return <WorkspaceError lang={lang} onRetry={load} />;
  if (!data) return <div className="workspace-loading"><div className="skeleton" /><div className="skeleton" /></div>;
  const money = (n: number) => `${n} ${data.currency}`;

  return <div className="view-stack">
    <div className="eyebrow">{t(lang, "finance_eyebrow")}</div>
    <div className="page-title"><h1>{t(lang, "finance_title")}</h1><button className="text-button" onClick={onBack}>{t(lang, "close")}</button></div>
    {actionError && <Panel tone="muted"><div className="error-state"><strong>{t(lang, "generic_error")}</strong><button className="button button-ghost" onClick={() => setActionError(false)}>{t(lang, "close")}</button></div></Panel>}

    <div className="metric-grid">
      <Metric label={t(lang, "finance_billed")} value={money(data.totals.billed)} />
      <Metric label={t(lang, "finance_paid")} value={money(data.totals.paid)} />
      <Metric label={t(lang, "finance_balance")} value={money(data.totals.balance)} />
    </div>

    <Panel>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "payment_add_title")}</span></div></div>
      <div className="form-grid">
        <label className="form-field"><span>{t(lang, "pick_client_label")}</span><select value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">{t(lang, "pick_client_label")}</option>{data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="form-field"><span>{t(lang, "field_amount")}</span><input type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <label className="form-field"><span>{t(lang, "field_paid_on")}</span><input type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} /></label>
        <label className="form-field"><span>{t(lang, "field_note")}</span><input value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} /></label>
      </div>
      <div className="button-row"><button className="button button-primary" disabled={busy !== null || !clientId || !(Number(amount) > 0)} onClick={() => void act("pay", { action: "pay", clientId: Number(clientId), amount: Number(amount), paidOn, note }).then(() => { setAmount(""); setNote(""); })}>{busy === "pay" ? t(lang, "saving_ellipsis") : t(lang, "payment_add_btn")}</button></div>
    </Panel>

    <Panel>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "finance_eyebrow")}</span><h2>{t(lang, "finance_title")}</h2></div><span className="tag">{data.ledgers.length}</span></div>
      {data.ledgers.length ? <div className="record-list">{data.ledgers.map((l) => <div className="record-row" key={l.clientId}>
        <div><strong>{l.clientName}</strong><small>{t(lang, "finance_sessions_line", { done: l.sessionsDone, planned: l.sessionsPlanned })} · {t(lang, "finance_billed")} {money(l.billed)} · {t(lang, "finance_paid")} {money(l.paid)}</small></div>
        <span className={l.balance > 0 ? "status-badge status-attention" : "status-badge"}>{money(l.balance)}</span>
      </div>)}</div> : <p className="muted">{t(lang, "finance_empty")}</p>}
    </Panel>

    {data.payments.length > 0 && <Panel tone="muted">
      <div className="section-head"><div><span className="eyebrow">{t(lang, "payments_log_title")}</span></div><span className="tag">{data.payments.length}</span></div>
      <div className="record-list">{data.payments.map((p) => <div className="record-row" key={p.id}>
        <div><strong>{p.clientName}</strong><small>{p.paidOn}{p.note ? ` · ${p.note}` : ""}</small></div>
        <div className="button-row"><span>{p.amount} {p.currency}</span><button className="text-button danger-button" disabled={busy !== null} onClick={() => void act(`pd:${p.id}`, { action: "delete", id: p.id })}>{t(lang, "delete_btn")}</button></div>
      </div>)}</div>
    </Panel>}
  </div>;
}

export function TrainerWorkspace({ dashboard, lang, onOpenPlan }: WorkspaceProps) {
  const [questions, setQuestions] = useState<TrainerQuestions | null>(null);
  const [requests, setRequests] = useState<TrainerRequests | null>(null);
  const [templates, setTemplates] = useState<TrainerTemplates | null>(null);
  const [broadcast, setBroadcast] = useState("");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [subview, setSubview] = useState<"list" | "client" | "profile" | "atrisk" | "coach" | "schedule" | "finance">("list");
  const [activeClientId, setActiveClientId] = useState<number | null>(null);
  const [assignTemplateId, setAssignTemplateId] = useState("");
  const [assignClientId, setAssignClientId] = useState("");
  const [templateNote, setTemplateNote] = useState<string | null>(null);

  // allSettled, not all: these three panels are independent, and a single failing one used to
  // replace the entire trainer workspace (clients, requests, templates, broadcast) with an error.
  const load = () => Promise.allSettled([
    api<TrainerQuestions>("/api/v2/trainer/questions"),
    api<TrainerRequests>("/api/v2/requests"),
    api<TrainerTemplates>("/api/v2/trainer/templates"),
  ]).then(([q, r, tpl]) => {
    if (q.status === "fulfilled") setQuestions(q.value);
    if (r.status === "fulfilled") setRequests(r.value);
    if (tpl.status === "fulfilled") setTemplates(tpl.value);
    if (q.status === "rejected" && r.status === "rejected" && tpl.status === "rejected") throw q.reason;
    if ([q, r, tpl].some((part) => part.status === "rejected")) setActionError(true);
  });
  useEffect(() => { void load().catch(() => setError(true)); }, []);
  const act = async (key: string, path: string, body: unknown): Promise<boolean> => {
    setBusy(key);
    try { await api(path, { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody(body) }); await load(); return true; }
    catch { setActionError(true); return false; }
    finally { setBusy(null); }
  };

  const assignTemplate = () => {
    if (!assignTemplateId || !assignClientId) return;
    setTemplateNote(null);
    void act("tpl-assign", "/api/v2/trainer/templates", { action: "assign", id: Number(assignTemplateId), clientId: Number(assignClientId) })
      .then((ok) => { if (ok) { setTemplateNote(t(lang, "template_assigned_note")); setAssignTemplateId(""); setAssignClientId(""); } });
  };

  if (error) return <WorkspaceError lang={lang} onRetry={() => { setError(false); void load().catch(() => setError(true)); }} />;

  if (subview === "profile") return <TrainerProfilePanel lang={lang} onBack={() => setSubview("list")} />;
  if (subview === "schedule") return <ScheduleView lang={lang} onBack={() => setSubview("list")} />;
  if (subview === "finance") return <FinanceView lang={lang} onBack={() => setSubview("list")} />;
  if (subview === "coach") return <AiCoachView lang={lang} routed={false} onBack={() => setSubview("list")} />;
  if (subview === "atrisk") return <AtRiskReportView dashboard={dashboard} lang={lang} onBack={() => setSubview("list")} onOpenClient={(id) => { setActiveClientId(id); setSubview("client"); }} />;
  if (subview === "client" && activeClientId !== null) {
    return <ClientCardView clientId={activeClientId} lang={lang} onBack={() => setSubview("list")} onTemplateSaved={() => void load()} onOpenPlan={onOpenPlan} />;
  }

  const clients: ClientSummary[] = dashboard.trainer?.clients ?? [];
  const hasTemplates = (templates?.templates.length ?? 0) > 0;
  const atRiskCount = clients.filter((client) => client.atRisk || client.flagged).length;

  return <div className="view-stack">
    <div className="eyebrow">{t(lang, "trainer_workspace_eyebrow")}</div>
    <div className="page-title"><h1>{t(lang, "coach_right_thing_title")}</h1><span>{t(lang, "n_clients", { n: clients.length })}</span></div>
    {actionError && <Panel tone="muted"><div className="error-state"><strong>{t(lang, "generic_error")}</strong><button className="button button-ghost" onClick={() => setActionError(false)}>{t(lang, "close")}</button></div></Panel>}
    <div className="button-row tabs">
      <button className="button button-ghost" onClick={() => setSubview("profile")}>{t(lang, "workspace_tab_profile")}</button>
      <button className="button button-ghost" onClick={() => setSubview("atrisk")}>{t(lang, "atrisk_report_btn", { n: atRiskCount })}</button>
      <button className="button button-ghost" onClick={() => setSubview("coach")}>{t(lang, "ai_coach_nav_btn")}</button>
      <button className="button button-ghost" onClick={() => setSubview("schedule")}>{t(lang, "workspace_tab_schedule")}</button>
      <button className="button button-ghost" onClick={() => setSubview("finance")}>{t(lang, "workspace_tab_finance")}</button>
    </div>

    <FirstClientChecklist lang={lang} clients={clients} onOpenPlan={(id) => onOpenPlan?.(id)} onInvite={() => document.getElementById("trainer-invite")?.scrollIntoView({ behavior: "smooth", block: "start" })} />
    {/* No clients yet: inviting is the first job, so the card leads; otherwise it follows the pulse. */}
    {clients.length === 0 && <TrainerInviteCard lang={lang} />}
    <Panel tone="accent">
      <div className="section-head"><div><span className="eyebrow">{t(lang, "client_pulse_eyebrow")}</span><h2>{t(lang, "needs_attention_title")}</h2></div></div>
      <div className="client-list">{clients.slice(0, 8).map((client) => <div className="client-row" key={client.id}>
        <div><strong>{client.name}</strong><small>{t(lang, "client_pcts", { w: client.workoutPct, n: client.nutritionPct })}</small></div>
        <div className="button-row">
          <span className={client.atRisk || client.flagged ? "status-badge status-attention" : "status-badge"}>{client.flagged ? t(lang, "flagged_label") : client.atRisk ? t(lang, "at_risk_label") : t(lang, "on_track_label")}</span>
          <button className="button button-ghost" onClick={() => { setActiveClientId(client.id); setSubview("client"); }}>{t(lang, "open_client_btn")}</button>
        </div>
      </div>)}</div>
    </Panel>

    {clients.length > 0 && <TrainerInviteCard lang={lang} />}

    <Panel><div className="section-head"><div><span className="eyebrow">{t(lang, "requests_eyebrow")}</span><h2>{t(lang, "new_requests_title")}</h2></div><span className="tag">{requests?.requests.length ?? 0}</span></div>{requests?.requests.length ? <div className="client-list">{requests.requests.map((request) => <div className="client-row" key={request.id}><div><strong>{request.name}</strong><small>{request.note || t(lang, "no_note")}</small></div><div className="button-row"><button className="button button-primary" disabled={busy !== null} onClick={() => void act(`req-accept:${request.id}`, "/api/v2/requests", { id: request.id, action: "accept" })}>{t(lang, "accept_btn")}</button><button className="button button-ghost" disabled={busy !== null} onClick={() => void act(`req-decline:${request.id}`, "/api/v2/requests", { id: request.id, action: "decline" })}>{t(lang, "decline_btn")}</button></div></div>)}</div> : <p className="muted">{t(lang, "no_pending_requests")}</p>}</Panel>

    <Panel><div className="section-head"><div><span className="eyebrow">{t(lang, "client_questions_eyebrow")}</span><h2>{t(lang, "close_loop_title")}</h2></div><span className="tag">{t(lang, "n_open", { n: questions?.questions.filter((q) => q.status !== "answered").length ?? 0 })}</span></div>{questions?.questions.length ? <div className="question-list">{questions.questions.slice(0, 8).map((question) => <div className="question-card" key={question.id}><strong>{question.client}</strong><p>{question.text}</p>{question.status === "answered" ? <small className="muted">{t(lang, "answered_label")}</small> : <div className="input-row"><input value={answers[question.id] ?? question.draft} placeholder={t(lang, "answer_ph")} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} /><button className="button button-primary" disabled={busy !== null || !answers[question.id]?.trim()} onClick={() => void act(`answer:${question.id}`, `/api/v2/trainer/question/${question.id}/answer`, { text: answers[question.id] })}>{t(lang, "send_btn")}</button></div>}</div>)}</div> : <p className="muted">{t(lang, "questions_appear_hint")}</p>}</Panel>

    <Panel tone="muted">
      <div className="section-head"><div><span className="eyebrow">{t(lang, "templates_eyebrow")}</span><h2>{t(lang, "templates_title")}</h2></div><span className="tag">{templates?.templates.length ?? 0}</span></div>
      {hasTemplates ? <div className="record-list">{templates!.templates.map((tpl) => <div className="record-row" key={tpl.id}><strong>{tpl.name}</strong><button className="button button-ghost" disabled={busy === `tpl-del:${tpl.id}`} onClick={() => void act(`tpl-del:${tpl.id}`, "/api/v2/trainer/templates", { action: "delete", id: tpl.id })}>{busy === `tpl-del:${tpl.id}` ? "…" : t(lang, "delete_template_btn")}</button></div>)}</div> : <p className="muted">{t(lang, "no_templates_hint")}</p>}
      {hasTemplates && clients.length > 0 && <div className="input-row">
        <select value={assignTemplateId} onChange={(event) => setAssignTemplateId(event.target.value)}>
          <option value="">{t(lang, "pick_template_label")}</option>
          {templates!.templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
        </select>
        <select value={assignClientId} onChange={(event) => setAssignClientId(event.target.value)}>
          <option value="">{t(lang, "pick_client_label")}</option>
          {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
        </select>
        <button className="button button-primary" disabled={busy === "tpl-assign" || !assignTemplateId || !assignClientId} onClick={assignTemplate}>{busy === "tpl-assign" ? t(lang, "saving_ellipsis") : t(lang, "assign_template_btn")}</button>
      </div>}
      {templateNote && <div className="save-note">{templateNote}</div>}
    </Panel>

    <Panel><div className="section-head"><div><span className="eyebrow">{t(lang, "broadcast_eyebrow")}</span><h2>{t(lang, "one_clear_message_title")}</h2></div></div><div className="input-row"><input value={broadcast} maxLength={2000} placeholder={t(lang, "broadcast_ph")} onChange={(event) => setBroadcast(event.target.value)} /><button className="button button-ghost" disabled={busy !== null || !broadcast.trim()} onClick={() => void act("broadcast", "/api/v2/trainer/broadcast", { text: broadcast })}>{t(lang, "send_to_clients_btn")}</button></div></Panel>
  </div>;
}
