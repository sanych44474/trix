import { useEffect, useState } from "react";
import { api, jsonBody, typedBody } from "./api";
import { t, type Lang } from "./i18n";
import type { ProfilePayload, RequestBody } from "./types";

type SettingsBody = RequestBody<"updateSettings">;

type SettingsPayload = {
  onboarded: boolean;
  reminders: Array<{ key: string; label: string; on: boolean }>;
  vacationUntil: string | null;
  lang: Lang;
  role: "solo" | "trainer" | "client";
  cycle: { on: boolean; lastStart: string | null; len: number } | null;
  compete: { on: boolean; alias: string };
};

type SettingsResult = { ok?: boolean; state?: SettingsPayload };

export function ProfileView({ onBack, lang, onLangChange }: { onBack: () => void; lang: Lang; onLangChange?: (lang: Lang) => void }) {
  const [data, setData] = useState<ProfilePayload | null>(null);
  const [form, setForm] = useState<ProfilePayload["profile"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [settingsError, setSettingsError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionSaved, setActionSaved] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [vacationDate, setVacationDate] = useState("");
  const [cycleStart, setCycleStart] = useState("");
  const [cycleLen, setCycleLen] = useState("28");
  const [alias, setAlias] = useState("");
  const [feedback, setFeedback] = useState("");
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [leftTrainer, setLeftTrainer] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleted, setDeleted] = useState(false);

  const load = () => { setError(null); api<ProfilePayload>("/api/v2/profile").then((next) => { setData(next); setForm(next.profile); }).catch(() => setError("load")); };
  const loadSettings = () => { setSettingsError(false); api<SettingsPayload>("/api/v2/settings").then((next) => { setSettings(next); setAlias(next.compete.alias); setCycleStart(next.cycle?.lastStart ?? ""); setCycleLen(String(next.cycle?.len ?? 28)); }).catch(() => setSettingsError(true)); };
  useEffect(load, []);
  useEffect(loadSettings, []);

  // `action` and `extra` both come from the contract now, so a call site naming a field the
  // handler doesn't read -- or an action it doesn't implement -- fails typecheck.
  const run = async (key: string, action: SettingsBody["action"], extra?: Omit<Partial<SettingsBody>, "action">): Promise<SettingsResult | null> => {
    setBusy(key); setActionSaved(null); setActionError(null);
    try {
      const result = await api<SettingsResult>("/api/v2/settings", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"updateSettings">({ action, ...extra }) });
      if (result.state) setSettings(result.state);
      if (result.ok === false) { setActionError(key); return result; }
      setActionSaved(key);
      return result;
    } catch { setActionError(key); return null; } finally { setBusy(null); }
  };

  const setLanguage = async (next: Lang) => {
    if (next === lang || busy) return;
    const result = await run("lang", "lang", { lang: next });
    if (result?.state) onLangChange?.(result.state.lang);
  };
  const toggleReminder = (key: string) => { void run(`rem:${key}`, "remToggle", { key }); };
  const startVacationDays = (days: number) => { void run("vacation", "vacation", { days }); };
  const startVacationCustom = () => {
    if (!vacationDate) return;
    const days = Math.ceil((new Date(`${vacationDate}T00:00:00Z`).getTime() - Date.now()) / 86_400_000);
    void run("vacation", "vacation", { days: Math.min(90, Math.max(1, days)) });
  };
  const endVacation = () => { void run("vacation", "vacation", { off: true }); };
  const toggleCycle = (on: boolean) => { void run("cycle", "cycle", { on }); };
  const saveCycleDetails = () => { void run("cycleDetails", "cycle", { lastStart: cycleStart || undefined, len: Number(cycleLen) }); };
  const toggleCompete = (on: boolean) => { void run("compete", "compete", { on }); };
  const saveAlias = () => { void run("alias", "compete", { alias: alias.trim() }); };
  const sendFeedback = async () => {
    const text = feedback.trim();
    if (text.length < 2) return;
    const result = await run("feedback", "feedback", { text });
    if (result) setFeedback("");
  };
  const exportData = (kind: "export" | "export_json") => { void run(kind, kind); };
  const leaveTrainer = async () => {
    const result = await run("leaveTrainer", "leaveTrainer");
    if (result) { setLeaveConfirm(false); setLeftTrainer(true); }
  };
  const deleteAccount = async () => {
    const result = await run("delete", "deleteAccount", { confirm: true });
    if (result?.ok) setDeleted(true);
  };

  if (error) return <div className="view-stack"><div className="page-title"><h1>{t(lang, "settings_title")}</h1></div><div className="card card-muted"><div className="error-state"><strong>{t(lang, "profile_load_error")}</strong><button className="button button-ghost" onClick={load}>{t(lang, "retry")}</button></div></div></div>;
  if (!data || !form) return <div className="view-stack"><div className="skeleton" /><div className="skeleton" /></div>;

  if (deleted) return <div className="view-stack"><div className="page-title"><h1>{t(lang, "delete_account_done_title")}</h1></div><div className="card"><p className="muted">{t(lang, "delete_account_done_detail")}</p><button className="button button-primary button-wide" onClick={() => window.Telegram?.WebApp?.close()}>{t(lang, "close")}</button></div></div>;

  const patch = (value: Partial<ProfilePayload["profile"]>) => setForm((current) => current ? { ...current, ...value } : current);
  const toggleDay = (value: number) => patch({ trainingWeekdays: form.trainingWeekdays.includes(value) ? form.trainingWeekdays.filter((day) => day !== value) : [...form.trainingWeekdays, value].sort((a, b) => a - b) });
  // A failed save must NOT blank the form via the shared `error`/`load`-failure state (the user's
  // typed edits would vanish) -- reuses the same per-field actionError/actionSaved convention the
  // settings actions below already use, keyed "profile", rendered as an inline note near the button.
  const save = async () => { setSaving(true); setActionError(null); try { await api("/api/v2/profile", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"updateProfile">({ ...form, goalWeight: form.goalWeight === null ? null : Number(form.goalWeight), waterGoalMl: form.waterGoalMl === null ? null : Number(form.waterGoalMl), stepsGoal: form.stepsGoal === null ? null : Number(form.stepsGoal) }) }); onBack(); } catch { setActionError("profile"); } finally { setSaving(false); } };
  const photoQuery = () => { const tma = window.Telegram?.WebApp?.initData; if (tma) return `&tma=${encodeURIComponent(tma)}`; return window.location.search.replace(/^\?/, "&"); };

  return <div className="view-stack">
    <div className="eyebrow">{t(lang, "profile_settings_eyebrow")}</div>
    <div className="page-title"><h1>{t(lang, "your_baseline_title")}</h1><button className="text-button" onClick={onBack}>{t(lang, "close")}</button></div>
    <section className="card"><div className="section-head"><div><span className="eyebrow">{t(lang, "identity_eyebrow")}</span><h2>{t(lang, "keep_current_title")}</h2></div></div><div className="form-grid"><label className="form-field"><span>{t(lang, "field_name")}</span><input value={form.name} maxLength={60} onChange={(event) => patch({ name: event.target.value })} /></label><label className="form-field"><span>{t(lang, "field_goal_weight_kg")}</span><input type="number" min="30" max="300" step="0.1" value={form.goalWeight ?? ""} placeholder={t(lang, "optional_ph")} onChange={(event) => patch({ goalWeight: event.target.value ? Number(event.target.value) : null })} /></label><label className="form-field"><span>{t(lang, "field_water_goal_ml")}</span><input type="number" min="500" max="8000" step="50" value={form.waterGoalMl ?? ""} placeholder={t(lang, "auto_ph")} onChange={(event) => patch({ waterGoalMl: event.target.value ? Number(event.target.value) : null })} /></label><label className="form-field"><span>{t(lang, "field_steps_goal")}</span><input type="number" min="1000" max="50000" step="500" value={form.stepsGoal ?? ""} placeholder="8000" onChange={(event) => patch({ stepsGoal: event.target.value ? Number(event.target.value) : null })} /></label></div></section>
    <section className="card"><div className="section-head"><div><span className="eyebrow">{t(lang, "training_eyebrow")}</span><h2>{t(lang, "weekly_rhythm_title")}</h2></div></div><div className="form-grid"><label className="form-field"><span>{t(lang, "field_goal")}</span><select value={form.goal} onChange={(event) => patch({ goal: event.target.value })}>{(data.options.goal ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="form-field"><span>{t(lang, "field_experience")}</span><select value={form.level} onChange={(event) => patch({ level: event.target.value as ProfilePayload["profile"]["level"] })}>{(data.options.level ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div><div className="weekday-grid">{data.weekdays.map((day) => <button className={form.trainingWeekdays.includes(day.value) ? "weekday selected" : "weekday"} key={day.value} onClick={() => toggleDay(day.value)}>{day.label.slice(0, 3)}</button>)}</div></section>
    {data.photos.length > 0 && <section className="card"><div className="section-head"><div><span className="eyebrow">{t(lang, "progress_photos_eyebrow")}</span><h2>{t(lang, "your_timeline_title")}</h2></div><span className="tag">{data.photos.length}</span></div><div className="photo-grid">{data.photos.map((photo) => <figure key={photo.id}><img src={`/api/v2/photo?id=${photo.id}${photoQuery()}`} alt={t(lang, "progress_alt", { date: photo.takenAt })} loading="lazy" /><figcaption>{photo.takenAt}</figcaption></figure>)}</div></section>}
    {form.share && <section className="card"><div className="section-head"><div><span className="eyebrow">{t(lang, "consent_eyebrow")}</span><h2>{t(lang, "trainer_visibility_title")}</h2></div></div><label className="check-row"><input type="checkbox" checked={form.share.body} onChange={(event) => patch({ share: { ...form.share!, body: event.target.checked } })} /><span>{t(lang, "share_body_label")}</span></label><label className="check-row"><input type="checkbox" checked={form.share.health} onChange={(event) => patch({ share: { ...form.share!, health: event.target.checked } })} /><span>{t(lang, "share_health_label")}</span></label></section>}
    {error && <div className="save-note error-note">{t(lang, "save_error")}</div>}
    {actionError === "profile" && <div className="save-note error-note">{t(lang, "save_error")}</div>}
    <button className="button button-primary button-wide" onClick={() => void save()} disabled={saving}>{saving ? t(lang, "saving_ellipsis") : t(lang, "save_profile_btn")}</button>

    <div className="eyebrow">{t(lang, "account_eyebrow")}</div>
    <div className="page-title"><h1>{t(lang, "settings_title")}</h1></div>

    {settingsError && <div className="card card-muted"><div className="error-state"><strong>{t(lang, "settings_load_error")}</strong><button className="button button-ghost" onClick={loadSettings}>{t(lang, "retry")}</button></div></div>}

    {settings && <>
      <section className="card"><div className="section-head"><div><span className="eyebrow">{t(lang, "language_eyebrow")}</span><h2>{t(lang, "language_title")}</h2></div></div><div className="button-row"><button className={lang === "uk" ? "button button-primary" : "button button-ghost"} disabled={busy === "lang"} onClick={() => void setLanguage("uk")}>{t(lang, "lang_uk_label")}</button><button className={lang === "en" ? "button button-primary" : "button button-ghost"} disabled={busy === "lang"} onClick={() => void setLanguage("en")}>{t(lang, "lang_en_label")}</button></div>{actionError === "lang" && <div className="save-note error-note">{t(lang, "save_error")}</div>}</section>

      <section className="card"><div className="section-head"><div><span className="eyebrow">{t(lang, "reminders_eyebrow")}</span><h2>{t(lang, "reminders_title")}</h2></div></div>{settings.reminders.map((reminder) => <label className="check-row" key={reminder.key}><input type="checkbox" checked={reminder.on} disabled={busy === `rem:${reminder.key}`} onChange={() => toggleReminder(reminder.key)} /><span>{reminder.label}</span></label>)}{actionError?.startsWith("rem:") && <div className="save-note error-note">{t(lang, "save_error")}</div>}</section>

      <section className="card"><div className="section-head"><div><span className="eyebrow">{t(lang, "vacation_eyebrow")}</span><h2>{t(lang, "vacation_title")}</h2></div></div>
        {settings.vacationUntil ? <>
          <p className="muted">{t(lang, "vacation_active_note", { date: settings.vacationUntil })}</p>
          <div className="button-row"><button className="button button-ghost" disabled={busy === "vacation"} onClick={endVacation}>{busy === "vacation" ? "…" : t(lang, "vacation_end_btn")}</button></div>
        </> : <>
          <div className="button-row"><button className="button button-ghost" disabled={busy === "vacation"} onClick={() => startVacationDays(7)}>{t(lang, "vacation_days_7")}</button><button className="button button-ghost" disabled={busy === "vacation"} onClick={() => startVacationDays(14)}>{t(lang, "vacation_days_14")}</button><button className="button button-ghost" disabled={busy === "vacation"} onClick={() => startVacationDays(28)}>{t(lang, "vacation_days_28")}</button></div>
          <label className="form-field"><span>{t(lang, "vacation_custom_label")}</span><input type="date" value={vacationDate} onChange={(event) => setVacationDate(event.target.value)} /></label>
          <div className="button-row"><button className="button button-primary" disabled={busy === "vacation" || !vacationDate} onClick={startVacationCustom}>{busy === "vacation" ? t(lang, "saving_ellipsis") : t(lang, "vacation_start_btn")}</button></div>
        </>}
        {actionError === "vacation" && <div className="save-note error-note">{t(lang, "save_error")}</div>}
      </section>

      {settings.cycle && <section className="card"><div className="section-head"><div><span className="eyebrow">{t(lang, "cycle_eyebrow")}</span><h2>{t(lang, "cycle_title")}</h2></div></div><label className="check-row"><input type="checkbox" checked={settings.cycle.on} disabled={busy === "cycle"} onChange={(event) => toggleCycle(event.target.checked)} /><span>{t(lang, "cycle_toggle_label")}</span></label><div className="form-grid"><label className="form-field"><span>{t(lang, "field_last_period")}</span><input type="date" value={cycleStart} onChange={(event) => setCycleStart(event.target.value)} /></label><label className="form-field"><span>{t(lang, "field_cycle_length")}</span><input type="number" min="20" max="45" value={cycleLen} onChange={(event) => setCycleLen(event.target.value)} /></label></div><div className="button-row"><button className="button button-ghost" disabled={busy === "cycleDetails"} onClick={saveCycleDetails}>{busy === "cycleDetails" ? t(lang, "saving_ellipsis") : t(lang, "cycle_save_btn")}</button></div>{(actionSaved === "cycleDetails" || actionSaved === "cycle") && <div className="save-note">{t(lang, "saved_label")}</div>}{(actionError === "cycleDetails" || actionError === "cycle") && <div className="save-note error-note">{t(lang, "save_error")}</div>}</section>}

      <section className="card"><div className="section-head"><div><span className="eyebrow">{t(lang, "compete_eyebrow")}</span><h2>{t(lang, "compete_title")}</h2></div></div><label className="check-row"><input type="checkbox" checked={settings.compete.on} disabled={busy === "compete"} onChange={(event) => toggleCompete(event.target.checked)} /><span>{t(lang, "compete_toggle_label")}</span></label><div className="input-row"><input value={alias} maxLength={30} placeholder={t(lang, "alias_ph")} onChange={(event) => setAlias(event.target.value)} /><button className="button button-ghost" disabled={busy === "alias"} onClick={saveAlias}>{busy === "alias" ? t(lang, "saving_ellipsis") : t(lang, "compete_save_btn")}</button></div>{(actionSaved === "alias" || actionSaved === "compete") && <div className="save-note">{t(lang, "saved_label")}</div>}{(actionError === "alias" || actionError === "compete") && <div className="save-note error-note">{t(lang, "save_error")}</div>}</section>

      <section className="card"><div className="section-head"><div><span className="eyebrow">{t(lang, "feedback_eyebrow")}</span><h2>{t(lang, "feedback_title")}</h2></div></div><label className="form-field"><textarea value={feedback} maxLength={1500} placeholder={t(lang, "feedback_ph")} onChange={(event) => setFeedback(event.target.value)} /></label><div className="button-row"><button className="button button-ghost" disabled={busy === "feedback" || feedback.trim().length < 2} onClick={() => void sendFeedback()}>{busy === "feedback" ? t(lang, "saving_ellipsis") : t(lang, "feedback_send_btn")}</button></div>{actionSaved === "feedback" && <div className="save-note">{t(lang, "feedback_sent_note")}</div>}{actionError === "feedback" && <div className="save-note error-note">{t(lang, "save_error")}</div>}</section>

      <section className="card"><div className="section-head"><div><span className="eyebrow">{t(lang, "export_eyebrow")}</span><h2>{t(lang, "export_title")}</h2></div></div><p className="muted">{t(lang, "export_detail")}</p><div className="button-row"><button className="button button-ghost" disabled={busy === "export"} onClick={() => exportData("export")}>{busy === "export" ? t(lang, "saving_ellipsis") : t(lang, "export_md_btn")}</button><button className="button button-ghost" disabled={busy === "export_json"} onClick={() => exportData("export_json")}>{busy === "export_json" ? t(lang, "saving_ellipsis") : t(lang, "export_json_btn")}</button></div>{(actionSaved === "export" || actionSaved === "export_json") && <div className="save-note">{t(lang, "export_sent_note")}</div>}{(actionError === "export" || actionError === "export_json") && <div className="save-note error-note">{t(lang, "export_error")}</div>}</section>

      {settings.role === "client" && !leftTrainer && <section className="card"><div className="section-head"><div><span className="eyebrow">{t(lang, "leave_trainer_eyebrow")}</span><h2>{t(lang, "leave_trainer_title")}</h2></div></div><p className="muted">{t(lang, "leave_trainer_detail")}</p>{!leaveConfirm ? <div className="button-row"><button className="button button-ghost" onClick={() => setLeaveConfirm(true)}>{t(lang, "leave_trainer_btn")}</button></div> : <><p><strong>{t(lang, "leave_trainer_confirm_title")}</strong></p><div className="button-row"><button className="button button-ghost" disabled={busy === "leaveTrainer"} onClick={() => void leaveTrainer()}>{busy === "leaveTrainer" ? "…" : t(lang, "leave_trainer_confirm_btn")}</button><button className="button button-ghost" onClick={() => setLeaveConfirm(false)}>{t(lang, "cancel_btn")}</button></div></>}{actionError === "leaveTrainer" && <div className="save-note error-note">{t(lang, "save_error")}</div>}</section>}
      {leftTrainer && <section className="card"><div className="save-note">{t(lang, "leave_trainer_done_note")}</div></section>}

      <section className="card card-muted"><div className="section-head"><div><span className="eyebrow">{t(lang, "danger_zone_eyebrow")}</span><h2>{t(lang, "delete_account_title")}</h2></div></div><p className="muted">{t(lang, "delete_account_detail")}</p>{!deleteConfirm ? <div className="button-row"><button className="button button-ghost" style={{ color: "var(--bad)" }} onClick={() => setDeleteConfirm(true)}>{t(lang, "delete_account_btn")}</button></div> : <div className="button-row"><button className="button button-ghost" style={{ color: "var(--bad)" }} disabled={busy === "delete"} onClick={() => void deleteAccount()}>{busy === "delete" ? "…" : t(lang, "delete_account_confirm_btn")}</button><button className="button button-ghost" onClick={() => setDeleteConfirm(false)}>{t(lang, "cancel_btn")}</button></div>}{actionError === "delete" && <div className="save-note error-note">{t(lang, "save_error")}</div>}</section>
    </>}
  </div>;
}
