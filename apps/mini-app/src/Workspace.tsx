import { useEffect, useState } from "react";
import { api, ApiError, jsonBody } from "./api";
import type { Dashboard } from "./types";
import { t, type Key, type Lang } from "./i18n";

type WorkspaceProps = { dashboard: Dashboard; lang: Lang; onOpenPlan?: (clientId?: number) => void };

type Buddy = {
  buddy: null | {
    name: string;
    level: number;
    xp: number;
    intoLevel: number;
    needed: number;
    streak: number;
    weekWorkouts: number;
    myWeekWorkouts: number;
    week: Array<{ date: string; ex: string[] }>;
    duel: { myWins: number; theirWins: number; myStreak: number };
  };
};

type Challenges = {
  active: Array<{ code: string; emoji: string; title: string; current: number; target: number; pct: number; done: boolean; daysLeft: number }>;
  available: Array<{ code: string; emoji: string; title: string; target: number; windowDays: number }>;
  won: number;
};

type Records = {
  records: Array<{ exercise: string; best: string; metric: string; updated: string | null }>;
  badges: Array<{ label: string; earned: boolean }>;
};

type Boards = {
  optedIn: boolean;
  consistency?: { rank: number; total: number; top: Array<{ pos: number; name: string; value: number; detail: string; me: boolean }> };
};

type TrainerQuestions = { questions: Array<{ id: number; clientId: number; client: string; text: string; draft: string; status: string }> };
type TrainerRequests = { requests: Array<{ id: number; clientId: number; name: string; note: string }> };
type TrainerTemplates = { templates: Array<{ id: number; name: string }> };
type ClientSummary = NonNullable<Dashboard["trainer"]>["clients"][number];
type ClientCardPayload = {
  client: { id: number; name: string; onboarded: boolean; flagged: boolean };
  cycle?: { phase: string; day: number };
  note: string | null;
  card: { healthNotes: string | null; personalNotes: string | null; birthday: string | null } | null;
  shared: {
    body?: { heightCm?: number; weightKg?: number; age?: number; sex?: string; goalWeight?: number; measurements?: Record<string, number> };
    health?: { limitations?: string; injuries: Array<{ area: string; severity: string; since: string; lastScore?: number }> };
  };
  photos?: Array<{ id: number; takenAt: string }>;
  noteHistory: Array<{ field: string; value: string; savedAt: string }>;
  messages: Array<{ fromMe: boolean; text: string; createdAt: string }>;
  dashboard: Dashboard;
};
type TrainerProfile = { status: string; name: string; bio: string; specialization: string; experienceYears: number | null; priceOnline: number | null; city: string; contact: string; accepting: boolean; clients: number };
type TrainerProfilePayload = { role: string; trainer: TrainerProfile | null };
type OwnerReport = { html: string };
type OwnerUsers = { rows: Array<{ id?: number; name?: string; [key: string]: unknown }>; feedback: Array<{ who: string; date: string; text: string }> };
type InjuryPayload = {
  injuries: Array<{ area: string; severity: string; since: string; lastScore: number | null }>;
  areas: Array<{ value: string; label: string }>;
  severities: Array<{ value: string; label: string }>;
};

function Panel({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "accent" | "muted" }) {
  return <section className={`card card-${tone}`}>{children}</section>;
}

function WorkspaceError({ lang, onRetry }: { lang: Lang; onRetry: () => void }) {
  return <Panel tone="muted"><div className="error-state"><strong>{t(lang, "workspace_unavailable")}</strong><button className="button button-ghost" onClick={onRetry}>{t(lang, "retry")}</button></div></Panel>;
}

function ProgressBar({ value }: { value: number }) {
  return <div className="progress-track" aria-label={`${Math.round(value)}%`}><span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

/** Same "the webview needs a query fallback for /api/v2/photo outside real Telegram" helper as
 * ProfileView's own photoQuery -- duplicated rather than shared, matching this app's convention
 * of no cross-file context/helpers for small view-local concerns. */
function photoQuery(): string {
  const tma = window.Telegram?.WebApp?.initData;
  if (tma) return `&tma=${encodeURIComponent(tma)}`;
  return window.location.search.replace(/^\?/, "&");
}

/** Note-history rows store raw field keys (v2_client_note_history) -- map them to the same
 * labels the corresponding editable field already uses elsewhere in this view. */
function noteFieldLabel(lang: Lang, field: string): string {
  if (field === "healthNotes") return t(lang, "field_health_notes");
  if (field === "personalNotes") return t(lang, "field_personal_notes");
  if (field === "note") return t(lang, "coach_note_title");
  return field;
}

function ClientCardView({ clientId, lang, onBack, onTemplateSaved, onOpenPlan }: { clientId: number; lang: Lang; onBack: () => void; onTemplateSaved: () => void; onOpenPlan?: (clientId?: number) => void }) {
  const [data, setData] = useState<ClientCardPayload | null>(null);
  const [error, setError] = useState(false);
  // Separate from `error` on purpose: `error` means "couldn't load this client's card, nothing to
  // show" and replaces the whole view with WorkspaceError. A single action failing (save/flag/
  // request) is recoverable and must not blank an already-rendered card out from under the
  // trainer; it shows as a small dismissible inline note instead.
  const [actionError, setActionError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [healthNotes, setHealthNotes] = useState("");
  const [personalNotes, setPersonalNotes] = useState("");
  const [birthday, setBirthday] = useState("");
  const [note, setNote] = useState("");
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateError, setTemplateError] = useState<string | null>(null);

  const load = () => {
    setError(false);
    api<ClientCardPayload>(`/api/v2/trainer/client/${clientId}/card`).then((payload) => {
      setData(payload);
      setHealthNotes(payload.card?.healthNotes ?? "");
      setPersonalNotes(payload.card?.personalNotes ?? "");
      setBirthday(payload.card?.birthday ?? "");
      setNote(payload.note ?? "");
    }).catch(() => setError(true));
  };
  useEffect(load, [clientId]);

  const saveCard = async () => {
    setBusy("card"); setSavedKey(null);
    try {
      await api(`/api/v2/trainer/client/${clientId}/card`, { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({ healthNotes, personalNotes, birthday }) });
      setSavedKey("card");
    } catch { setActionError(true); } finally { setBusy(null); }
  };
  const saveNote = async () => {
    setBusy("note"); setSavedKey(null);
    try {
      await api(`/api/v2/trainer/client/${clientId}/note`, { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({ note }) });
      setSavedKey("note");
    } catch { setActionError(true); } finally { setBusy(null); }
  };
  const toggleFlag = async () => {
    if (!data) return;
    setBusy("flag");
    try {
      const next = !data.client.flagged;
      await api(`/api/v2/trainer/client/${clientId}/flag`, { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({ flagged: next }) });
      setData({ ...data, client: { ...data.client, flagged: next } });
    } catch { setActionError(true); } finally { setBusy(null); }
  };
  const createTemplate = async () => {
    if (!templateName.trim()) return;
    setBusy("template"); setTemplateError(null); setSavedKey(null);
    try {
      await api("/api/v2/trainer/templates", { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({ action: "create", name: templateName.trim(), fromClientId: clientId }) });
      setTemplateName(""); setSavedKey("template"); onTemplateSaved();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setTemplateError(t(lang, "no_active_plan_hint"));
      else setActionError(true);
    } finally { setBusy(null); }
  };
  const requestPhotos = async () => {
    setBusy("photoreq"); setSavedKey(null);
    try {
      await api(`/api/v2/trainer/client/${clientId}/photo-request`, { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({}) });
      setSavedKey("photoreq");
    } catch { setActionError(true); } finally { setBusy(null); }
  };
  const requestInterview = async () => {
    setBusy("interview"); setSavedKey(null);
    try {
      await api(`/api/v2/trainer/client/${clientId}/interview-nudge`, { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({}) });
      setSavedKey("interview");
    } catch { setActionError(true); } finally { setBusy(null); }
  };

  if (error) return <WorkspaceError lang={lang} onRetry={load} />;
  if (!data) return <div className="workspace-loading"><div className="skeleton" /><div className="skeleton" /></div>;
  const recovery = data.dashboard.recovery;
  const gami = data.dashboard.gamification;

  return <div className="view-stack">
    <div className="eyebrow">{t(lang, "client_card_eyebrow")}</div>
    {actionError && <Panel tone="muted"><div className="error-state"><strong>{t(lang, "generic_error")}</strong><button className="button button-ghost" onClick={() => setActionError(false)}>{t(lang, "close")}</button></div></Panel>}
    <div className="page-title"><h1>{data.client.name}</h1><div className="button-row"><button className="button button-ghost" onClick={() => onOpenPlan?.(clientId)}>{t(lang, "edit_client_plan_btn")}</button><button className="text-button" onClick={onBack}>{t(lang, "close")}</button></div></div>

    <Panel tone="accent">
      <div className="section-head"><div><span className="eyebrow">{t(lang, "readiness_eyebrow")}</span><h2>{recovery.label}</h2></div><span className={data.client.flagged ? "status-badge status-attention" : "status-badge"}>{data.client.flagged ? t(lang, "flagged_label") : t(lang, "on_track_label")}</span></div>
      <div className="metric-grid compact">
        <Metric label={t(lang, "metric_recovery")} value={`${recovery.score}`} />
        {gami && <Metric label={t(lang, "metric_streak")} value={t(lang, "streak_weeks", { n: gami.streak ?? 0 })} detail={t(lang, "level_n", { n: gami.level })} />}
      </div>
      {data.cycle && <p className="muted">{t(lang, "cycle_phase_line", { phase: data.cycle.phase, day: data.cycle.day })}</p>}
      <div className="button-row"><button className="button button-ghost" disabled={busy === "flag"} onClick={() => void toggleFlag()}>{busy === "flag" ? "…" : data.client.flagged ? t(lang, "unflag_client_btn") : t(lang, "flag_client_btn")}</button></div>
    </Panel>

    {!data.client.onboarded && <Panel tone="muted">
      <div className="section-head"><div><span className="eyebrow">{t(lang, "interview_nudge_eyebrow")}</span><h2>{t(lang, "interview_nudge_title")}</h2></div></div>
      <div className="button-row"><button className="button button-ghost" disabled={busy === "interview"} onClick={() => void requestInterview()}>{busy === "interview" ? t(lang, "saving_ellipsis") : t(lang, "request_interview_btn")}</button></div>
      {savedKey === "interview" && <div className="save-note">{t(lang, "request_interview_sent_note")}</div>}
    </Panel>}

    <Panel>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "card_notes_eyebrow")}</span><h2>{t(lang, "card_notes_title")}</h2></div></div>
      <div className="form-grid"><label className="form-field"><span>{t(lang, "field_birthday")}</span><input value={birthday} placeholder={t(lang, "birthday_ph")} onChange={(event) => setBirthday(event.target.value)} /></label></div>
      <label className="form-field"><span>{t(lang, "field_health_notes")}</span><textarea value={healthNotes} maxLength={2000} onChange={(event) => setHealthNotes(event.target.value)} /></label>
      <label className="form-field"><span>{t(lang, "field_personal_notes")}</span><textarea value={personalNotes} maxLength={2000} onChange={(event) => setPersonalNotes(event.target.value)} /></label>
      {savedKey === "card" && <div className="save-note">{t(lang, "saved_label")}</div>}
      <div className="button-row"><button className="button button-primary" disabled={busy === "card"} onClick={() => void saveCard()}>{busy === "card" ? t(lang, "saving_ellipsis") : t(lang, "save_card_btn")}</button></div>
    </Panel>

    <Panel>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "coach_note_eyebrow")}</span><h2>{t(lang, "coach_note_title")}</h2></div></div>
      <label className="form-field"><span>{t(lang, "coach_note_title")}</span><textarea value={note} maxLength={2000} placeholder={t(lang, "coach_note_ph")} onChange={(event) => setNote(event.target.value)} /></label>
      {savedKey === "note" && <div className="save-note">{t(lang, "saved_label")}</div>}
      <div className="button-row"><button className="button button-ghost" disabled={busy === "note"} onClick={() => void saveNote()}>{busy === "note" ? t(lang, "saving_ellipsis") : t(lang, "save_note_btn")}</button></div>
    </Panel>

    <Panel tone="muted">
      <div className="section-head"><div><span className="eyebrow">{t(lang, "note_history_eyebrow")}</span><h2>{t(lang, "note_history_title")}</h2></div></div>
      {data.noteHistory.length > 0
        ? <div className="record-list">{data.noteHistory.map((entry, index) => <div className="record-row" key={`${entry.field}-${entry.savedAt}-${index}`}><div><strong>{noteFieldLabel(lang, entry.field)}</strong><small>{entry.savedAt.slice(0, 16).replace("T", " ")}</small></div><span>{entry.value}</span></div>)}</div>
        : <p className="muted">{t(lang, "note_history_empty")}</p>}
    </Panel>

    <Panel>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "message_thread_eyebrow")}</span><h2>{t(lang, "message_thread_title")}</h2></div></div>
      {data.messages.length > 0
        ? <div className="record-list">{data.messages.map((message, index) => <div className="record-row" key={`${message.createdAt}-${index}`}><div><strong>{message.fromMe ? t(lang, "you_label") : data.client.name}</strong><small>{message.createdAt.slice(0, 16).replace("T", " ")}</small></div><span>{message.text}</span></div>)}</div>
        : <p className="muted">{t(lang, "message_thread_empty")}</p>}
    </Panel>

    {data.shared.body && <Panel><div className="section-head"><div><span className="eyebrow">{t(lang, "shared_body_eyebrow")}</span><h2>{t(lang, "shared_body_title")}</h2></div></div><div className="metric-grid compact">
      {data.shared.body.heightCm !== undefined && <Metric label={t(lang, "card_height_cm")} value={`${data.shared.body.heightCm} cm`} />}
      {data.shared.body.weightKg !== undefined && <Metric label={t(lang, "card_weight_kg")} value={`${data.shared.body.weightKg} kg`} />}
      {data.shared.body.age !== undefined && <Metric label={t(lang, "card_age")} value={`${data.shared.body.age}`} />}
    </div></Panel>}

    {data.shared.health && <Panel>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "health_context_eyebrow")}</span><h2>{t(lang, "health_context_title")}</h2></div></div>
      {data.shared.health.limitations && <p className="muted">{data.shared.health.limitations}</p>}
      {data.shared.health.injuries.length > 0 ? <div className="injury-list">{data.shared.health.injuries.map((injury) => <div className="record-row" key={`${injury.area}-${injury.since}`}><div><strong>{injury.area}</strong><small>{t(lang, "since_date", { date: injury.since })}</small></div><span>{injury.severity}</span></div>)}</div> : <p className="muted">{t(lang, "no_recovery_blockers")}</p>}
    </Panel>}

    <Panel>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "progress_photos_eyebrow")}</span><h2>{t(lang, "client_photos_title")}</h2></div>{data.photos && data.photos.length > 0 && <span className="tag">{data.photos.length}</span>}</div>
      {data.photos && data.photos.length > 0
        ? <div className="photo-grid">{data.photos.map((photo) => <figure key={photo.id}><img src={`/api/v2/photo?id=${photo.id}${photoQuery()}`} alt={t(lang, "progress_alt", { date: photo.takenAt })} loading="lazy" /><figcaption>{photo.takenAt}</figcaption></figure>)}</div>
        : <p className="muted">{t(lang, "no_client_photos_hint")}</p>}
      <div className="button-row"><button className="button button-ghost" disabled={busy === "photoreq"} onClick={() => void requestPhotos()}>{busy === "photoreq" ? t(lang, "saving_ellipsis") : t(lang, "request_photos_btn")}</button></div>
      {savedKey === "photoreq" && <div className="save-note">{t(lang, "request_photos_sent_note")}</div>}
    </Panel>

    <Panel tone="muted">
      <div className="section-head"><div><span className="eyebrow">{t(lang, "templates_eyebrow")}</span><h2>{t(lang, "create_template_title")}</h2></div></div>
      <div className="input-row"><input value={templateName} maxLength={60} placeholder={t(lang, "template_name_ph")} onChange={(event) => setTemplateName(event.target.value)} /><button className="button button-ghost" disabled={busy === "template" || !templateName.trim()} onClick={() => void createTemplate()}>{busy === "template" ? t(lang, "saving_ellipsis") : t(lang, "create_template_btn")}</button></div>
      {savedKey === "template" && <div className="save-note">{t(lang, "template_created_note")}</div>}
      {templateError && <div className="save-note error-note">{templateError}</div>}
    </Panel>
  </div>;
}

function TrainerProfilePanel({ lang, onBack }: { lang: Lang; onBack: () => void }) {
  const [data, setData] = useState<TrainerProfilePayload | null>(null);
  const [form, setForm] = useState<TrainerProfile | null>(null);
  const [error, setError] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const load = () => { setError(false); api<TrainerProfilePayload>("/api/v2/trainer/profile").then((next) => { setData(next); setForm(next.trainer); }).catch(() => setError(true)); };
  useEffect(load, []);
  if (error) return <WorkspaceError lang={lang} onRetry={load} />;
  if (!data || !form) return <div className="workspace-loading"><div className="skeleton" /><div className="skeleton" /></div>;
  const patch = (value: Partial<TrainerProfile>) => setForm((current) => current ? { ...current, ...value } : current);
  const save = async () => {
    setSaving(true); setSaved(false);
    try {
      await api("/api/v2/trainer/profile", { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({ bio: form.bio, specialization: form.specialization, experienceYears: form.experienceYears, priceOnline: form.priceOnline, city: form.city, contact: form.contact, accepting: form.accepting }) });
      setSaved(true);
    } catch { setActionError(true); } finally { setSaving(false); }
  };
  return <div className="view-stack">
    <div className="eyebrow">{t(lang, "my_profile_eyebrow")}</div>
    <div className="page-title"><h1>{t(lang, "my_profile_title")}</h1><button className="text-button" onClick={onBack}>{t(lang, "close")}</button></div>
    {actionError && <Panel tone="muted"><div className="error-state"><strong>{t(lang, "generic_error")}</strong><button className="button button-ghost" onClick={() => setActionError(false)}>{t(lang, "close")}</button></div></Panel>}
    <Panel>
      <div className="form-grid">
        <label className="form-field"><span>{t(lang, "field_specialization")}</span><input value={form.specialization} maxLength={120} onChange={(event) => patch({ specialization: event.target.value })} /></label>
        <label className="form-field"><span>{t(lang, "field_experience_years")}</span><input type="number" min="0" max="60" value={form.experienceYears ?? ""} onChange={(event) => patch({ experienceYears: event.target.value ? Number(event.target.value) : null })} /></label>
        <label className="form-field"><span>{t(lang, "field_price_online")}</span><input type="number" min="0" max="100000" value={form.priceOnline ?? ""} onChange={(event) => patch({ priceOnline: event.target.value ? Number(event.target.value) : null })} /></label>
        <label className="form-field"><span>{t(lang, "field_city")}</span><input value={form.city} maxLength={60} onChange={(event) => patch({ city: event.target.value })} /></label>
        <label className="form-field"><span>{t(lang, "field_contact")}</span><input value={form.contact} maxLength={120} onChange={(event) => patch({ contact: event.target.value })} /></label>
      </div>
      <label className="form-field"><span>{t(lang, "field_bio")}</span><textarea value={form.bio} maxLength={600} onChange={(event) => patch({ bio: event.target.value })} /></label>
      <label className="check-row"><input type="checkbox" checked={form.accepting} onChange={(event) => patch({ accepting: event.target.checked })} /><span>{t(lang, "accepting_clients_label")}</span></label>
      {saved && <div className="save-note">{t(lang, "profile_updated_note")}</div>}
      <div className="button-row"><button className="button button-primary" disabled={saving} onClick={() => void save()}>{saving ? t(lang, "saving_ellipsis") : t(lang, "save_profile_btn")}</button></div>
    </Panel>
  </div>;
}

function SocialWorkspace({ lang, role }: { lang: Lang; role: Dashboard["viewer"]["role"] }) {
  const [data, setData] = useState<{ buddy: Buddy; challenges: Challenges; records: Records; boards: Boards } | null>(null);
  const [injuries, setInjuries] = useState<InjuryPayload | null>(null);
  const [error, setError] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [steps, setSteps] = useState("");
  const [injuryArea, setInjuryArea] = useState("");
  const [injurySeverity, setInjurySeverity] = useState("");
  const [subview, setSubview] = useState<"main" | "coach">("main");

  const load = () => {
    setError(false);
    Promise.all([
      api<Buddy>("/api/v2/buddy"),
      api<Challenges>("/api/v2/challenges"),
      api<Records>("/api/v2/records"),
      api<Boards>("/api/v2/boards"),
      api<InjuryPayload>("/api/v2/injuries"),
    ]).then(([buddy, challenges, records, boards, injuryData]) => {
      setData({ buddy, challenges, records, boards });
      setInjuries(injuryData);
      setInjuryArea(injuryData.areas[0]?.value ?? "");
      setInjurySeverity(injuryData.severities[0]?.value ?? "");
    }).catch(() => setError(true));
  };
  useEffect(load, []);

  const post = async (key: string, path: string, body: unknown) => {
    setBusy(key);
    try { await api(path, { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody(body) }); load(); }
    catch { setActionError(true); }
    finally { setBusy(null); }
  };

  if (subview === "coach") return <AiCoachView lang={lang} onBack={() => setSubview("main")} />;
  if (error) return <WorkspaceError lang={lang} onRetry={load} />;
  if (!data || !injuries) return <div className="workspace-loading"><div className="skeleton" /><div className="skeleton" /></div>;
  const buddy = data.buddy.buddy;
  const board = data.boards.consistency;

  return <div className="view-stack">
    <div className="eyebrow">{t(lang, "social_eyebrow")}</div>
    {actionError && <Panel tone="muted"><div className="error-state"><strong>{t(lang, "generic_error")}</strong><button className="button button-ghost" onClick={() => setActionError(false)}>{t(lang, "close")}</button></div></Panel>}
    <div className="page-title"><h1>{t(lang, "stay_accountable_title")}</h1><span>{t(lang, "challenges_won", { n: data.challenges.won })}</span></div>
    {/* A client with a trainer routes questions to them (see coachApi.ts) -- this single-turn
        self-coach Q&A is solo-only. */}
    {role !== "client" && <div className="button-row"><button className="button button-ghost" onClick={() => setSubview("coach")}>{t(lang, "ai_coach_nav_btn")}</button></div>}

    {buddy ? <Panel tone="accent"><div className="section-head"><div><span className="eyebrow">{t(lang, "buddy_eyebrow")}</span><h2>{buddy.name}</h2></div><span className="tag">{t(lang, "level_n", { n: buddy.level })}</span></div><p>{t(lang, "buddy_stats", { my: buddy.myWeekWorkouts, their: buddy.weekWorkouts, name: buddy.name, streak: buddy.streak })}</p><ProgressBar value={buddy.needed ? buddy.intoLevel / buddy.needed * 100 : 100} /></Panel> : <Panel><div className="section-head"><div><span className="eyebrow">{t(lang, "buddy_eyebrow")}</span><h2>{t(lang, "no_buddy_title")}</h2></div></div><p className="muted">{t(lang, "no_buddy_detail")}</p></Panel>}

    <Panel><div className="section-head"><div><span className="eyebrow">{t(lang, "challenges_eyebrow")}</span><h2>{t(lang, "build_momentum_title")}</h2></div><span className="tag">{t(lang, "n_active", { n: data.challenges.active.length })}</span></div>{data.challenges.active.length ? <div className="challenge-list">{data.challenges.active.map((challenge) => <div className="challenge-row" key={challenge.code}><div><strong>{challenge.emoji} {challenge.title}</strong><small>{t(lang, "challenge_progress_line", { current: challenge.current, target: challenge.target, n: challenge.daysLeft })}</small><ProgressBar value={challenge.pct} /></div><span className={challenge.done ? "status-badge status-done" : "status-badge"}>{challenge.done ? t(lang, "done_label") : t(lang, "pct_label", { n: Math.round(challenge.pct) })}</span></div>)}</div> : <p className="muted">{t(lang, "join_challenge_hint")}</p>}{data.challenges.available.length > 0 && <div className="button-row challenge-actions">{data.challenges.available.slice(0, 2).map((challenge) => <button className="button button-ghost" key={challenge.code} onClick={() => void post(`challenge:${challenge.code}`, "/api/v2/challenges", { code: challenge.code })} disabled={busy === `challenge:${challenge.code}`}>{busy === `challenge:${challenge.code}` ? t(lang, "joining_ellipsis") : t(lang, "join_challenge_btn", { emoji: challenge.emoji, title: challenge.title })}</button>)}</div>}</Panel>

    <Panel><div className="section-head"><div><span className="eyebrow">{t(lang, "records_eyebrow")}</span><h2>{t(lang, "proof_progress_title")}</h2></div><span className="tag">{data.records.records.length}</span></div>{data.records.records.length ? <div className="record-list">{data.records.records.slice(0, 8).map((record) => <div className="record-row" key={record.exercise}><div><strong>{record.exercise}</strong><small>{t(lang, "record_updated_metric", { updated: record.updated ?? t(lang, "recent_label"), metric: record.metric })}</small></div><span>{record.best}</span></div>)}</div> : <p className="muted">{t(lang, "no_records_hint")}</p>}{data.records.badges.some((badge) => badge.earned) && <div className="badge-list">{data.records.badges.filter((badge) => badge.earned).slice(0, 6).map((badge) => <span className="tag" key={badge.label}>{badge.label}</span>)}</div>}</Panel>

    <Panel><div className="section-head"><div><span className="eyebrow">{t(lang, "community_board_eyebrow")}</span><h2>{data.boards.optedIn ? t(lang, "consistency_label") : t(lang, "private_mode_label")}</h2></div></div>{!data.boards.optedIn ? <p className="muted">{t(lang, "board_off_hint")}</p> : board ? <><p className="muted">{t(lang, "your_rank_line", { rank: board.rank > 0 ? `#${board.rank}` : "—", total: board.total })}</p><div className="record-list">{board.top.map((entry) => <div className={entry.me ? "record-row board-me" : "record-row"} key={`${entry.pos}-${entry.name}`}><strong>#{entry.pos} {entry.name}</strong><span>{entry.value} {entry.detail}</span></div>)}</div></> : <p className="muted">{t(lang, "board_warming_hint")}</p>}</Panel>

    <Panel><div className="section-head"><div><span className="eyebrow">{t(lang, "quick_log_eyebrow")}</span><h2>{t(lang, "keep_baseline_current_title")}</h2></div></div><div className="button-row"><button className="button button-primary" onClick={() => void post("water", "/api/v2/log", { kind: "water", ml: 250 })} disabled={busy === "water"}>{busy === "water" ? "…" : t(lang, "water_250_btn")}</button><input className="compact-input" value={steps} inputMode="numeric" placeholder={t(lang, "steps_ph")} onChange={(event) => setSteps(event.target.value)} /><button className="button button-ghost" onClick={() => void post("steps", "/api/v2/log", { kind: "steps", steps: Number(steps) })} disabled={busy === "steps" || !steps}>{busy === "steps" ? "…" : t(lang, "save_steps_btn")}</button></div></Panel>

    <Panel><div className="section-head"><div><span className="eyebrow">{t(lang, "recovery_eyebrow")}</span><h2>{t(lang, "report_injury_title")}</h2></div></div>{injuries.injuries.length > 0 && <div className="injury-list">{injuries.injuries.map((injury) => <div className="record-row" key={`${injury.area}-${injury.since}`}><div><strong>{injury.area}</strong><small>{t(lang, "since_date", { date: injury.since })}</small></div><span>{injury.severity}</span></div>)}</div>}<div className="button-row"><select value={injuryArea} onChange={(event) => setInjuryArea(event.target.value)}>{injuries.areas.map((area) => <option key={area.value} value={area.value}>{area.label}</option>)}</select><select value={injurySeverity} onChange={(event) => setInjurySeverity(event.target.value)}>{injuries.severities.map((severity) => <option key={severity.value} value={severity.value}>{severity.label}</option>)}</select><button className="button button-ghost" onClick={() => void post("injury", "/api/v2/injuries", { area: injuryArea, severity: injurySeverity })} disabled={busy === "injury"}>{busy === "injury" ? t(lang, "saving_ellipsis") : t(lang, "report_btn")}</button></div></Panel>
  </div>;
}

/** Dedicated at-risk report: everything TrainerWorkspace's client-pulse list already flags
 * (flagged OR atRisk), un-sliced, with the missed-planned-dates detail dashboardReader.ts already
 * computes (missedConsecutiveWorkouts) but the client list itself only ever surfaced as a boolean. */
function AtRiskReportView({ dashboard, lang, onBack, onOpenClient }: { dashboard: Dashboard; lang: Lang; onBack: () => void; onOpenClient: (id: number) => void }) {
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

/** Single-turn "ask the AI coach" screen — solo/trainer self-coaching only (see coachApi.ts for
 * why a client with a trainer doesn't get this: their questions route to a human, not here). */
function AiCoachView({ lang, onBack }: { lang: Lang; onBack: () => void }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const ask = async () => {
    if (!question.trim()) return;
    setBusy(true); setError(false); setAnswer(null);
    try {
      const result = await api<{ answer: string }>("/api/v2/coach/ask", { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({ question: question.trim() }) });
      setAnswer(result.answer);
    } catch { setError(true); } finally { setBusy(false); }
  };

  return <div className="view-stack">
    <div className="eyebrow">{t(lang, "ai_coach_eyebrow")}</div>
    <div className="page-title"><h1>{t(lang, "ai_coach_title")}</h1><button className="text-button" onClick={onBack}>{t(lang, "close")}</button></div>
    <Panel>
      <label className="form-field"><span>{t(lang, "ai_coach_question_label")}</span><textarea value={question} maxLength={500} placeholder={t(lang, "ai_coach_ph")} onChange={(event) => setQuestion(event.target.value)} /></label>
      <div className="button-row"><button className="button button-primary" disabled={busy || !question.trim()} onClick={() => void ask()}>{busy ? t(lang, "saving_ellipsis") : t(lang, "ai_coach_ask_btn")}</button></div>
      {error && <div className="save-note error-note">{t(lang, "generic_error")}</div>}
    </Panel>
    {answer !== null && <Panel tone="accent"><div className="section-head"><div><span className="eyebrow">{t(lang, "ai_coach_answer_eyebrow")}</span></div></div><p>{answer}</p></Panel>}
  </div>;
}

function TrainerWorkspace({ dashboard, lang, onOpenPlan }: WorkspaceProps) {
  const [questions, setQuestions] = useState<TrainerQuestions | null>(null);
  const [requests, setRequests] = useState<TrainerRequests | null>(null);
  const [templates, setTemplates] = useState<TrainerTemplates | null>(null);
  const [broadcast, setBroadcast] = useState("");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [subview, setSubview] = useState<"list" | "client" | "profile" | "atrisk" | "coach">("list");
  const [activeClientId, setActiveClientId] = useState<number | null>(null);
  const [assignTemplateId, setAssignTemplateId] = useState("");
  const [assignClientId, setAssignClientId] = useState("");
  const [templateNote, setTemplateNote] = useState<string | null>(null);

  const load = () => Promise.all([
    api<TrainerQuestions>("/api/v2/trainer/questions"),
    api<TrainerRequests>("/api/v2/requests"),
    api<TrainerTemplates>("/api/v2/trainer/templates"),
  ]).then(([q, r, tpl]) => { setQuestions(q); setRequests(r); setTemplates(tpl); });
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
  if (subview === "coach") return <AiCoachView lang={lang} onBack={() => setSubview("list")} />;
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
    </div>

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

type OwnerSection = "overview" | "roster" | "ai" | "trainers" | "onboarding" | "errors" | "events";
const OWNER_REPORT_SECTIONS: Array<{ id: Exclude<OwnerSection, "roster">; tab: Key; eyebrow: Key; title: Key }> = [
  { id: "overview", tab: "owner_tab_overview", eyebrow: "overview_eyebrow", title: "live_report_title" },
  { id: "ai", tab: "owner_tab_ai", eyebrow: "ai_stats_eyebrow", title: "ai_stats_title" },
  { id: "trainers", tab: "owner_tab_trainers", eyebrow: "trainers_report_eyebrow", title: "trainers_report_title" },
  { id: "onboarding", tab: "owner_tab_onboarding", eyebrow: "onboarding_funnel_eyebrow", title: "onboarding_funnel_title" },
  { id: "errors", tab: "owner_tab_errors", eyebrow: "errors_report_eyebrow", title: "errors_report_title" },
  { id: "events", tab: "owner_tab_events", eyebrow: "events_report_eyebrow", title: "events_report_title" },
];
// The backend already renders each section as Telegram-HTML (<b>/<i>/<pre>/<code> + newlines);
// stripped to plain text and dropped into a monospace <pre>, alignment/tables survive untouched
// (same approach the existing overview panel used before this got split into tabs).
const plainReport = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");

function OwnerWorkspace({ lang }: { lang: Lang }) {
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
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  const loadUsers = () => { setError(false); return api<OwnerUsers>("/api/v2/owner/users").then(setUsers).catch(() => setError(true)); };
  const loadSection = (id: OwnerSection, force = false) => {
    if (id === "roster" || (!force && reports[id] !== undefined)) return;
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
  const userAction = async (id: number, action: "block" | "unblock" | "delete") => {
    setRosterBusy(`${action}:${id}`);
    try {
      await api(`/api/v2/owner/user/${id}/${action}`, { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({}) });
      if (action === "delete") setPendingDelete(null);
      await loadUsers();
    } catch { setActionError(true); } finally { setRosterBusy(null); }
  };
  if (error) return <WorkspaceError lang={lang} onRetry={retry} />;
  if (!users) return <div className="workspace-loading"><div className="skeleton" /><div className="skeleton" /></div>;

  const activeReport = section === "roster" ? undefined : OWNER_REPORT_SECTIONS.find((s) => s.id === section);
  const activeHtml = activeReport ? reports[activeReport.id] : undefined;

  return <div className="view-stack">
    <div className="eyebrow">{t(lang, "owner_ops_eyebrow")}</div>
    <div className="page-title"><h1>{t(lang, "system_pulse_title")}</h1><span>{t(lang, "n_users", { n: users.rows.length })}</span></div>
    {actionError && <Panel tone="muted"><div className="error-state"><strong>{t(lang, "generic_error")}</strong><button className="button button-ghost" onClick={() => setActionError(false)}>{t(lang, "close")}</button></div></Panel>}
    <div className="button-row tabs-scroll">
      {OWNER_REPORT_SECTIONS.map((s) => <button key={s.id} className={section === s.id ? "button button-primary" : "button button-ghost"} disabled={sectionBusy && section !== s.id} onClick={() => selectSection(s.id)}>{t(lang, s.tab)}</button>)}
      <button className={section === "roster" ? "button button-primary" : "button button-ghost"} disabled={sectionBusy && section !== "roster"} onClick={() => selectSection("roster")}>{t(lang, "owner_tab_roster")}</button>
    </div>

    {section === "roster" && <Panel>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "roster_eyebrow")}</span><h2>{t(lang, "recent_users_title")}</h2></div></div>
      <div className="client-list">{users.rows.slice(0, 12).map((user, index) => {
        const id = typeof user.id === "number" ? user.id : undefined;
        const blocked = user.status === "banned";
        const name = String(user.name ?? user.id ?? t(lang, "user_fallback_name", { n: index + 1 }));
        return <div className="client-row" key={`${user.id ?? index}-${index}`}>
          <div><strong>{name}</strong><small>{String(user.status ?? "")}</small></div>
          {id !== undefined && (pendingDelete === id
            ? <div className="button-row">
                <button className="button button-ghost" disabled={rosterBusy === `delete:${id}`} onClick={() => void userAction(id, "delete")}>{rosterBusy === `delete:${id}` ? "…" : t(lang, "owner_delete_confirm_btn")}</button>
                <button className="text-button" onClick={() => setPendingDelete(null)}>{t(lang, "cancel_btn")}</button>
              </div>
            : <div className="button-row">
                <button className="button button-ghost" disabled={rosterBusy === `${blocked ? "unblock" : "block"}:${id}`} onClick={() => void userAction(id, blocked ? "unblock" : "block")}>{rosterBusy === `${blocked ? "unblock" : "block"}:${id}` ? "…" : t(lang, blocked ? "owner_unblock_btn" : "owner_block_btn")}</button>
                <button className="text-button" onClick={() => setPendingDelete(id)}>{t(lang, "owner_delete_btn")}</button>
              </div>)}
        </div>;
      })}</div>
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

export function WorkspaceView({ dashboard, lang, onOpenPlan }: WorkspaceProps) {
  if (dashboard.owner) return <OwnerWorkspace lang={lang} />;
  if (dashboard.viewer.role === "trainer") return <TrainerWorkspace dashboard={dashboard} lang={lang} onOpenPlan={onOpenPlan} />;
  return <SocialWorkspace lang={lang} role={dashboard.viewer.role} />;
}
