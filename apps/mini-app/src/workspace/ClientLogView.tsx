// The trainer logs a client's workout (weight × reps per set) or speaks a command that becomes a
// proposal: sets to put in this form, or edits to the client's plan. Nothing is applied until the
// trainer taps a button (ADR-0018).
//
// Online only, on purpose: this is not the athlete's logger. It never touches the client's draft or
// this device's offline queue (logic/offlineSaves.ts is the signed-in person's own saves), and a save
// is checked against the day as it was when the form opened, so a client's own log is never wiped.
import { useEffect, useState } from "react";
import { api, ApiError, typedBody } from "../api";
import type { TrainerLogDay, TrainerLogSaved, TrainerVoiceProposal } from "../types";
import { t, type Lang } from "../i18n";
import { chooseStart, plannedSetsFor, type LoggerExercise } from "../logic/logger";
import { actionToPlanEditBody, addExercise, addRow, formRows, mergeProposalEntries, setCell, trainerSaveEntries } from "../logic/trainerLog";
import { injuryRefusalArea } from "../logic/planEditError";
import { VoiceButton } from "../media/VoiceButton";
import { Panel, WorkspaceError } from "./shared";

const DAYS_BACK = 14;
const shiftDay = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const dayLabel = (lang: Lang, iso: string) =>
  new Intl.DateTimeFormat(lang === "uk" ? "uk-UA" : "en-GB", { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${iso}T12:00:00`));

export function ClientLogView({ clientId, lang, voiceFirst, onBack }: { clientId: number; lang: Lang; voiceFirst?: boolean; onBack: () => void }) {
  const [day, setDay] = useState<TrainerLogDay | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [exercises, setExercises] = useState<LoggerExercise[]>([]);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [voiceText, setVoiceText] = useState("");
  const [proposal, setProposal] = useState<TrainerVoiceProposal | null>(null);
  const [newName, setNewName] = useState("");

  const load = (d: string | null) => {
    setError(false);
    api<TrainerLogDay>(`/api/v2/trainer/log?clientId=${clientId}${d ? `&date=${d}` : ""}`).then((payload) => {
      setDay(payload);
      setDate(payload.date);
      // No local draft: the form starts from the saved log, else from the plan.
      setExercises(chooseStart(payload, null).exercises);
    }).catch(() => setError(true));
  };
  useEffect(() => load(null), [clientId]);

  if (error) return <WorkspaceError lang={lang} onRetry={() => load(date)} />;
  if (!day || !date) return <div className="workspace-loading"><div className="skeleton" /></div>;

  const today = day.client.today;
  const dates = Array.from({ length: DAYS_BACK + 1 }, (_, i) => shiftDay(today, -i));
  const update = (i: number, next: LoggerExercise) => setExercises((prev) => prev.map((e, j) => (j === i ? next : e)));

  const save = async () => {
    const entries = trainerSaveEntries(exercises);
    if (!entries.length) { setNotice(t(lang, "tlog_nothing")); return; }
    setBusy("save"); setNotice(null);
    try {
      const r = await api<TrainerLogSaved>("/api/v2/trainer/log", {
        method: "POST", idempotencyKey: true,
        body: typedBody<"saveTrainerLog">({ clientId, date, entries, baseSavedAt: day.savedAt ?? null }),
      });
      setDay({ ...day, savedAt: r.savedAt ?? undefined, savedByTrainer: true });
      setNotice(r.prExercises.length ? `${t(lang, "tlog_saved")} 🏆 ${r.prExercises.join(", ")}` : t(lang, "tlog_saved"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) { setNotice(t(lang, "tlog_stale")); load(date); } else setNotice(t(lang, "generic_error"));
    } finally { setBusy(null); }
  };

  const suggest = async () => {
    const text = voiceText.trim();
    if (!text) return;
    setBusy("suggest"); setNotice(null); setProposal(null);
    try {
      setProposal(await api<TrainerVoiceProposal>("/api/v2/trainer/voice", { method: "POST", idempotencyKey: true, body: typedBody<"trainerVoiceProposal">({ clientId, text, date }) }));
    } catch (err) {
      setNotice(err instanceof ApiError && err.status === 429 ? t(lang, "tlog_slow_down") : t(lang, "generic_error"));
    } finally { setBusy(null); }
  };

  const applyPlan = async () => {
    if (!proposal?.actions?.length) return;
    setBusy("plan"); setNotice(null);
    let applied = 0;
    try {
      // The server already ordered them so one edit never shifts the next one's index.
      for (const a of proposal.actions) {
        const edit = actionToPlanEditBody(a, clientId);
        if (!edit) continue;
        await api("/api/v2/plan", {
          method: "POST", idempotencyKey: true,
          ...(proposal.version ? { headers: { "If-Match": `"${proposal.version}"` } } : {}),
          body: typedBody<"editPlan">(edit),
        });
        applied++;
      }
      setNotice(t(lang, "tlog_plan_applied", { n: applied }));
      setProposal(null);
    } catch (err) {
      const area = injuryRefusalArea(err);
      const why = area ? t(lang, "tlog_plan_injury") : t(lang, "tlog_plan_failed");
      setNotice(applied ? `${t(lang, "tlog_plan_applied", { n: applied })} ${why}` : why);
    } finally { setBusy(null); }
  };

  return <div className="workspace-page client-log">
    <div className="page-title"><div><h1>{t(lang, "tlog_title")}</h1><span>{day.client.name}</span></div><button className="text-button" onClick={onBack}>{t(lang, "close")}</button></div>

    <Panel>
      <label className="form-field">
        <span>{t(lang, "tlog_date_label")}</span>
        <select value={date} onChange={(e) => load((e.target as HTMLSelectElement).value)}>
          {dates.map((d) => <option key={d} value={d}>{d === today ? t(lang, "tlog_today") : dayLabel(lang, d)}</option>)}
        </select>
      </label>
      {day.savedByTrainer ? <p className="muted">{t(lang, "tlog_logged_by_you")}</p> : day.savedAt ? <p className="muted">{t(lang, "tlog_client_logged")}</p> : null}
    </Panel>

    <Panel tone={voiceFirst ? "accent" : "default"}>
      <div className="section-head"><h2>{t(lang, "tlog_voice_title")}</h2><VoiceButton lang={lang} onText={(text) => setVoiceText((prev) => (prev ? `${prev}\n${text}` : text))} disabled={busy !== null} /></div>
      <p className="muted">{t(lang, "tlog_voice_hint")}</p>
      <label className="form-field"><textarea rows={3} value={voiceText} maxLength={1000} placeholder={t(lang, "tlog_voice_placeholder")} onInput={(e) => setVoiceText((e.target as HTMLTextAreaElement).value)} /></label>
      <div className="button-row"><button className="button button-ghost" disabled={!voiceText.trim() || busy !== null} onClick={() => void suggest()}>{busy === "suggest" ? "…" : t(lang, "tlog_suggest")}</button></div>
      {proposal && <div className="tlog-proposal">
        {proposal.reply && <p>{proposal.reply}</p>}
        {proposal.kind === "workout" && proposal.entries?.length ? <>
          <strong>{t(lang, "tlog_proposal_workout")}</strong>
          <ul>{proposal.entries.map((e, i) => <li key={i}>{e.name}: {e.sets.map((s) => (s.seconds ? `${s.seconds}s` : s.meters ? `${s.meters} m` : `${s.weight || "BW"}×${s.reps}`)).join(", ")}</li>)}</ul>
          <div className="button-row"><button className="button button-primary" onClick={() => { setExercises((prev) => mergeProposalEntries(prev, proposal.entries ?? [])); setProposal(null); setVoiceText(""); }}>{t(lang, "tlog_add_to_form")}</button></div>
        </> : null}
        {proposal.kind === "plan" && proposal.actions?.length ? <>
          <strong>{t(lang, "tlog_proposal_plan")}</strong>
          <ul>{proposal.actions.map((a, i) => <li key={i}>{a.label}</li>)}</ul>
          <div className="button-row"><button className="button button-primary" disabled={busy !== null} onClick={() => void applyPlan()}>{busy === "plan" ? "…" : t(lang, "tlog_apply_plan")}</button></div>
        </> : null}
      </div>}
    </Panel>

    {exercises.map((ex, i) => {
      const rows = formRows(ex);
      const planned = plannedSetsFor(ex);
      const axis = ex.metric === "time" ? "seconds" : ex.metric === "distance" ? "meters" : "reps";
      return <Panel key={`${ex.index}:${ex.name}`}>
        <div className="section-head"><h2>{ex.name}</h2></div>
        {rows.map((s, r) => <div className="input-row" key={r}>
          {ex.metric === "reps" && <label>{t(lang, "tlog_weight")}<input type="number" inputMode="decimal" min={0} value={s.weight || ""} placeholder={planned[r]?.weight ? String(planned[r]?.weight) : ""} onInput={(e) => update(i, setCell(ex, r, "weight", Number((e.target as HTMLInputElement).value)))} /></label>}
          <label>{t(lang, axis === "seconds" ? "tlog_seconds" : axis === "meters" ? "tlog_meters" : "tlog_reps")}<input type="number" inputMode="numeric" min={0} value={(s[axis] as number | undefined) || ""} placeholder={planned[r]?.[axis] ? String(planned[r]?.[axis]) : ""} onInput={(e) => update(i, setCell(ex, r, axis, Number((e.target as HTMLInputElement).value)))} /></label>
        </div>)}
        <div className="button-row"><button className="button button-quiet" onClick={() => update(i, addRow(ex))}>{t(lang, "tlog_add_set")}</button></div>
      </Panel>;
    })}

    <Panel>
      <div className="input-row"><input value={newName} maxLength={80} placeholder={t(lang, "tlog_add_exercise")} onInput={(e) => setNewName((e.target as HTMLInputElement).value)} /><button className="button button-ghost" disabled={!newName.trim()} onClick={() => { setExercises((prev) => addExercise(prev, newName)); setNewName(""); }}>+</button></div>
    </Panel>

    {notice && <p className="save-note" role="status">{notice}</p>}
    <div className="button-row"><button className="button button-primary" disabled={busy !== null} onClick={() => void save()}>{busy === "save" ? t(lang, "saving_ellipsis") : t(lang, "tlog_save")}</button></div>
  </div>;
}
