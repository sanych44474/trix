// The trainer's client card in the Mini App: profile, plan, notes and their history, injuries,
// photos, coach thread and templates.
import { useEffect, useState } from "react";
import { api, ApiError, jsonBody, typedBody } from "../api";
import type { ClientCardPayload } from "../types";
import { t, type Key, type Lang } from "../i18n";
import { noteFieldKey } from "../logic/workspace";
import { Panel, WorkspaceError, Metric, photoQuery } from "./shared";

export const noteFieldLabel = (lang: Lang, field: string): string => { const k = noteFieldKey(field); return k ? t(lang, k) : field; };

export function ClientCardView({ clientId, lang, onBack, onTemplateSaved, onOpenPlan }: { clientId: number; lang: Lang; onBack: () => void; onTemplateSaved: () => void; onOpenPlan?: (clientId?: number) => void }) {
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
      await api(`/api/v2/trainer/client/${clientId}/card`, { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"updateClientCard">({ healthNotes, personalNotes, birthday }) });
      setSavedKey("card");
    } catch { setActionError(true); } finally { setBusy(null); }
  };
  const saveNote = async () => {
    setBusy("note"); setSavedKey(null);
    try {
      await api(`/api/v2/trainer/client/${clientId}/note`, { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"updateClientNote">({ note }) });
      setSavedKey("note");
    } catch { setActionError(true); } finally { setBusy(null); }
  };
  const toggleFlag = async () => {
    if (!data) return;
    setBusy("flag");
    try {
      const next = !data.client.flagged;
      await api(`/api/v2/trainer/client/${clientId}/flag`, { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"updateClientFlag">({ flagged: next }) });
      setData({ ...data, client: { ...data.client, flagged: next } });
    } catch { setActionError(true); } finally { setBusy(null); }
  };
  const createTemplate = async () => {
    if (!templateName.trim()) return;
    setBusy("template"); setTemplateError(null); setSavedKey(null);
    try {
      await api("/api/v2/trainer/templates", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"mutateTrainerTemplates">({ action: "create", name: templateName.trim(), fromClientId: clientId }) });
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
      {/* clientCard.ts sends raw area/severity codes (same fixed set miscApi.ts's own injury
          report uses) rather than localized text -- translated here so a trainer viewing a
          client's card doesn't see "shoulder"/"mild" hardcoded in English. */}
      {data.shared.health.injuries.length > 0 ? <div className="injury-list">{data.shared.health.injuries.map((injury) => <div className="record-row" key={`${injury.area}-${injury.since}`}><div><strong>{t(lang, `inj_area_${injury.area}` as Key)}</strong><small>{t(lang, "since_date", { date: injury.since })}</small></div><span>{t(lang, `inj_sev_${injury.severity}` as Key)}</span></div>)}</div> : <p className="muted">{t(lang, "no_recovery_blockers")}</p>}
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
