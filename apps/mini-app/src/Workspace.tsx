import { useEffect, useState } from "react";
import { api, ApiError, jsonBody } from "./api";
import type { Dashboard } from "./types";
import { t, type Lang } from "./i18n";

type WorkspaceProps = { dashboard: Dashboard; lang: Lang };

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

function ClientCardView({ clientId, lang, onBack, onTemplateSaved }: { clientId: number; lang: Lang; onBack: () => void; onTemplateSaved: () => void }) {
  const [data, setData] = useState<ClientCardPayload | null>(null);
  const [error, setError] = useState(false);
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
    } catch { setError(true); } finally { setBusy(null); }
  };
  const saveNote = async () => {
    setBusy("note"); setSavedKey(null);
    try {
      await api(`/api/v2/trainer/client/${clientId}/note`, { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({ note }) });
      setSavedKey("note");
    } catch { setError(true); } finally { setBusy(null); }
  };
  const toggleFlag = async () => {
    if (!data) return;
    setBusy("flag");
    try {
      const next = !data.client.flagged;
      await api(`/api/v2/trainer/client/${clientId}/flag`, { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({ flagged: next }) });
      setData({ ...data, client: { ...data.client, flagged: next } });
    } catch { setError(true); } finally { setBusy(null); }
  };
  const createTemplate = async () => {
    if (!templateName.trim()) return;
    setBusy("template"); setTemplateError(null); setSavedKey(null);
    try {
      await api("/api/v2/trainer/templates", { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({ action: "create", name: templateName.trim(), fromClientId: clientId }) });
      setTemplateName(""); setSavedKey("template"); onTemplateSaved();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setTemplateError(t(lang, "no_active_plan_hint"));
      else setError(true);
    } finally { setBusy(null); }
  };

  if (error) return <WorkspaceError lang={lang} onRetry={load} />;
  if (!data) return <div className="workspace-loading"><div className="skeleton" /><div className="skeleton" /></div>;
  const recovery = data.dashboard.recovery;
  const gami = data.dashboard.gamification;

  return <div className="view-stack">
    <div className="eyebrow">{t(lang, "client_card_eyebrow")}</div>
    <div className="page-title"><h1>{data.client.name}</h1><button className="text-button" onClick={onBack}>{t(lang, "close")}</button></div>

    <Panel tone="accent">
      <div className="section-head"><div><span className="eyebrow">{t(lang, "readiness_eyebrow")}</span><h2>{recovery.label}</h2></div><span className={data.client.flagged ? "status-badge status-attention" : "status-badge"}>{data.client.flagged ? t(lang, "flagged_label") : t(lang, "on_track_label")}</span></div>
      <div className="metric-grid compact">
        <Metric label={t(lang, "metric_recovery")} value={`${recovery.score}`} />
        {gami && <Metric label={t(lang, "metric_streak")} value={t(lang, "streak_weeks", { n: gami.streak ?? 0 })} detail={t(lang, "level_n", { n: gami.level })} />}
      </div>
      {data.cycle && <p className="muted">{t(lang, "cycle_phase_line", { phase: data.cycle.phase, day: data.cycle.day })}</p>}
      <div className="button-row"><button className="button button-ghost" disabled={busy === "flag"} onClick={() => void toggleFlag()}>{busy === "flag" ? "…" : data.client.flagged ? t(lang, "unflag_client_btn") : t(lang, "flag_client_btn")}</button></div>
    </Panel>

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

    {data.photos && data.photos.length > 0 && <Panel><div className="section-head"><div><span className="eyebrow">{t(lang, "progress_photos_eyebrow")}</span><h2>{t(lang, "client_photos_title")}</h2></div><span className="tag">{data.photos.length}</span></div><div className="photo-grid">{data.photos.map((photo) => <figure key={photo.id}><img src={`/api/v2/photo?id=${photo.id}${photoQuery()}`} alt={t(lang, "progress_alt", { date: photo.takenAt })} loading="lazy" /><figcaption>{photo.takenAt}</figcaption></figure>)}</div></Panel>}

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
    } catch { setError(true); } finally { setSaving(false); }
  };
  return <div className="view-stack">
    <div className="eyebrow">{t(lang, "my_profile_eyebrow")}</div>
    <div className="page-title"><h1>{t(lang, "my_profile_title")}</h1><button className="text-button" onClick={onBack}>{t(lang, "close")}</button></div>
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

function SocialWorkspace({ lang }: { lang: Lang }) {
  const [data, setData] = useState<{ buddy: Buddy; challenges: Challenges; records: Records; boards: Boards } | null>(null);
  const [injuries, setInjuries] = useState<InjuryPayload | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [steps, setSteps] = useState("");
  const [injuryArea, setInjuryArea] = useState("");
  const [injurySeverity, setInjurySeverity] = useState("");

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
    catch { setError(true); }
    finally { setBusy(null); }
  };

  if (error) return <WorkspaceError lang={lang} onRetry={load} />;
  if (!data || !injuries) return <div className="workspace-loading"><div className="skeleton" /><div className="skeleton" /></div>;
  const buddy = data.buddy.buddy;
  const board = data.boards.consistency;

  return <div className="view-stack">
    <div className="eyebrow">{t(lang, "social_eyebrow")}</div>
    <div className="page-title"><h1>{t(lang, "stay_accountable_title")}</h1><span>{t(lang, "challenges_won", { n: data.challenges.won })}</span></div>

    {buddy ? <Panel tone="accent"><div className="section-head"><div><span className="eyebrow">{t(lang, "buddy_eyebrow")}</span><h2>{buddy.name}</h2></div><span className="tag">{t(lang, "level_n", { n: buddy.level })}</span></div><p>{t(lang, "buddy_stats", { my: buddy.myWeekWorkouts, their: buddy.weekWorkouts, name: buddy.name, streak: buddy.streak })}</p><ProgressBar value={buddy.needed ? buddy.intoLevel / buddy.needed * 100 : 100} /></Panel> : <Panel><div className="section-head"><div><span className="eyebrow">{t(lang, "buddy_eyebrow")}</span><h2>{t(lang, "no_buddy_title")}</h2></div></div><p className="muted">{t(lang, "no_buddy_detail")}</p></Panel>}

    <Panel><div className="section-head"><div><span className="eyebrow">{t(lang, "challenges_eyebrow")}</span><h2>{t(lang, "build_momentum_title")}</h2></div><span className="tag">{t(lang, "n_active", { n: data.challenges.active.length })}</span></div>{data.challenges.active.length ? <div className="challenge-list">{data.challenges.active.map((challenge) => <div className="challenge-row" key={challenge.code}><div><strong>{challenge.emoji} {challenge.title}</strong><small>{t(lang, "challenge_progress_line", { current: challenge.current, target: challenge.target, n: challenge.daysLeft })}</small><ProgressBar value={challenge.pct} /></div><span className={challenge.done ? "status-badge status-done" : "status-badge"}>{challenge.done ? t(lang, "done_label") : t(lang, "pct_label", { n: Math.round(challenge.pct) })}</span></div>)}</div> : <p className="muted">{t(lang, "join_challenge_hint")}</p>}{data.challenges.available.length > 0 && <div className="button-row challenge-actions">{data.challenges.available.slice(0, 2).map((challenge) => <button className="button button-ghost" key={challenge.code} onClick={() => void post(`challenge:${challenge.code}`, "/api/v2/challenges", { code: challenge.code })} disabled={busy === `challenge:${challenge.code}`}>{busy === `challenge:${challenge.code}` ? t(lang, "joining_ellipsis") : t(lang, "join_challenge_btn", { emoji: challenge.emoji, title: challenge.title })}</button>)}</div>}</Panel>

    <Panel><div className="section-head"><div><span className="eyebrow">{t(lang, "records_eyebrow")}</span><h2>{t(lang, "proof_progress_title")}</h2></div><span className="tag">{data.records.records.length}</span></div>{data.records.records.length ? <div className="record-list">{data.records.records.slice(0, 8).map((record) => <div className="record-row" key={record.exercise}><div><strong>{record.exercise}</strong><small>{t(lang, "record_updated_metric", { updated: record.updated ?? t(lang, "recent_label"), metric: record.metric })}</small></div><span>{record.best}</span></div>)}</div> : <p className="muted">{t(lang, "no_records_hint")}</p>}{data.records.badges.some((badge) => badge.earned) && <div className="badge-list">{data.records.badges.filter((badge) => badge.earned).slice(0, 6).map((badge) => <span className="tag" key={badge.label}>{badge.label}</span>)}</div>}</Panel>

    <Panel><div className="section-head"><div><span className="eyebrow">{t(lang, "community_board_eyebrow")}</span><h2>{data.boards.optedIn ? t(lang, "consistency_label") : t(lang, "private_mode_label")}</h2></div></div>{!data.boards.optedIn ? <p className="muted">{t(lang, "board_off_hint")}</p> : board ? <><p className="muted">{t(lang, "your_rank_line", { rank: board.rank > 0 ? `#${board.rank}` : "—", total: board.total })}</p><div className="record-list">{board.top.map((entry) => <div className={entry.me ? "record-row board-me" : "record-row"} key={`${entry.pos}-${entry.name}`}><strong>#{entry.pos} {entry.name}</strong><span>{entry.value} {entry.detail}</span></div>)}</div></> : <p className="muted">{t(lang, "board_warming_hint")}</p>}</Panel>

    <Panel><div className="section-head"><div><span className="eyebrow">{t(lang, "quick_log_eyebrow")}</span><h2>{t(lang, "keep_baseline_current_title")}</h2></div></div><div className="button-row"><button className="button button-primary" onClick={() => void post("water", "/api/v2/log", { kind: "water", ml: 250 })} disabled={busy === "water"}>{busy === "water" ? "…" : t(lang, "water_250_btn")}</button><input className="compact-input" value={steps} inputMode="numeric" placeholder={t(lang, "steps_ph")} onChange={(event) => setSteps(event.target.value)} /><button className="button button-ghost" onClick={() => void post("steps", "/api/v2/log", { kind: "steps", steps: Number(steps) })} disabled={busy === "steps" || !steps}>{busy === "steps" ? "…" : t(lang, "save_steps_btn")}</button></div></Panel>

    <Panel><div className="section-head"><div><span className="eyebrow">{t(lang, "recovery_eyebrow")}</span><h2>{t(lang, "report_injury_title")}</h2></div></div>{injuries.injuries.length > 0 && <div className="injury-list">{injuries.injuries.map((injury) => <div className="record-row" key={`${injury.area}-${injury.since}`}><div><strong>{injury.area}</strong><small>{t(lang, "since_date", { date: injury.since })}</small></div><span>{injury.severity}</span></div>)}</div>}<div className="button-row"><select value={injuryArea} onChange={(event) => setInjuryArea(event.target.value)}>{injuries.areas.map((area) => <option key={area.value} value={area.value}>{area.label}</option>)}</select><select value={injurySeverity} onChange={(event) => setInjurySeverity(event.target.value)}>{injuries.severities.map((severity) => <option key={severity.value} value={severity.value}>{severity.label}</option>)}</select><button className="button button-ghost" onClick={() => void post("injury", "/api/v2/injuries", { area: injuryArea, severity: injurySeverity })} disabled={busy === "injury"}>{busy === "injury" ? t(lang, "saving_ellipsis") : t(lang, "report_btn")}</button></div></Panel>
  </div>;
}

function TrainerWorkspace({ dashboard, lang }: WorkspaceProps) {
  const [questions, setQuestions] = useState<TrainerQuestions | null>(null);
  const [requests, setRequests] = useState<TrainerRequests | null>(null);
  const [templates, setTemplates] = useState<TrainerTemplates | null>(null);
  const [broadcast, setBroadcast] = useState("");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [subview, setSubview] = useState<"list" | "client" | "profile">("list");
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
    catch { setError(true); return false; }
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
  if (subview === "client" && activeClientId !== null) {
    return <ClientCardView clientId={activeClientId} lang={lang} onBack={() => setSubview("list")} onTemplateSaved={() => void load()} />;
  }

  const clients: ClientSummary[] = dashboard.trainer?.clients ?? [];
  const hasTemplates = (templates?.templates.length ?? 0) > 0;

  return <div className="view-stack">
    <div className="eyebrow">{t(lang, "trainer_workspace_eyebrow")}</div>
    <div className="page-title"><h1>{t(lang, "coach_right_thing_title")}</h1><span>{t(lang, "n_clients", { n: clients.length })}</span></div>
    <div className="button-row"><button className="button button-ghost" onClick={() => setSubview("profile")}>{t(lang, "workspace_tab_profile")}</button></div>

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

function OwnerWorkspace({ lang }: { lang: Lang }) {
  const [report, setReport] = useState<OwnerReport | null>(null);
  const [users, setUsers] = useState<OwnerUsers | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const load = () => { setError(false); Promise.all([api<OwnerReport>("/api/v2/owner/report?section=overview"), api<OwnerUsers>("/api/v2/owner/users")]).then(([nextReport, nextUsers]) => { setReport(nextReport); setUsers(nextUsers); }).catch(() => setError(true)); };
  useEffect(load, []);
  const askInactive = async () => { try { const result = await api<{ sent: number }>("/api/v2/owner/ask-inactive", { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({}) }); setSent(result.sent); } catch { setError(true); } };
  if (error) return <WorkspaceError lang={lang} onRetry={load} />;
  if (!report || !users) return <div className="workspace-loading"><div className="skeleton" /><div className="skeleton" /></div>;
  return <div className="view-stack"><div className="eyebrow">{t(lang, "owner_ops_eyebrow")}</div><div className="page-title"><h1>{t(lang, "system_pulse_title")}</h1><span>{t(lang, "n_users", { n: users.rows.length })}</span></div><Panel><div className="section-head"><div><span className="eyebrow">{t(lang, "overview_eyebrow")}</span><h2>{t(lang, "live_report_title")}</h2></div><button className="button button-ghost" onClick={() => void askInactive()}>{t(lang, "ask_inactive_btn")}</button></div><pre className="owner-report">{report.html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")}</pre>{sent !== null && <div className="save-note">{t(lang, "sent_to_n_users", { n: sent })}</div>}</Panel><Panel><div className="section-head"><div><span className="eyebrow">{t(lang, "roster_eyebrow")}</span><h2>{t(lang, "recent_users_title")}</h2></div></div><div className="client-list">{users.rows.slice(0, 12).map((user, index) => <div className="client-row" key={`${user.id ?? index}-${index}`}><strong>{String(user.name ?? user.id ?? t(lang, "user_fallback_name", { n: index + 1 }))}</strong><span className="status-badge">#{index + 1}</span></div>)}</div></Panel></div>;
}

export function WorkspaceView({ dashboard, lang }: WorkspaceProps) {
  if (dashboard.owner) return <OwnerWorkspace lang={lang} />;
  if (dashboard.viewer.role === "trainer") return <TrainerWorkspace dashboard={dashboard} lang={lang} />;
  return <SocialWorkspace lang={lang} />;
}
