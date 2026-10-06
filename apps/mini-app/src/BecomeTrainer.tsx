// Becoming a trainer (or editing an existing trainer profile) from the Mini App: the More screen
// and the first screen of onboarding both use it. The same POST creates a new application when
// the caller has no trainer row yet (pending owner approval), or edits the profile otherwise.
import { useEffect, useState } from "react";
import { api, typedBody } from "./api";
import type { Dashboard, TrainerProfile } from "./types";
import { t, type Key, type Lang } from "./i18n";
import { Card } from "./App";

export function BecomeTrainerCard({ lang, role }: { lang: Lang; role: Dashboard["viewer"]["role"] }) {
  // become a trainer -- reuses the exact same /api/v2/trainer/profile POST the bot's own
  // trainer-profile wizard and TrainerProfilePanel (Workspace.tsx) use: when the caller has no
  // v2_trainers row yet, extrasApi.ts's handler treats the same body as a NEW application
  // (applyTrainer, pending owner approval) instead of an edit. TrainerProfilePanel itself isn't
  // reachable here -- it only renders inside TrainerWorkspace, which is gated to role==="trainer"
  // already, so a solo user applying for the first time could never reach it. The same GET also
  // tells an applicant where they stand: without it, a pending application looked identical to
  // never having applied (the form just reappeared blank on every open).
  const [trainerApp, setTrainerApp] = useState<TrainerProfile | null | undefined>(undefined);
  const [becomeName, setBecomeName] = useState("");
  const [becomeSpecialization, setBecomeSpecialization] = useState("");
  const [becomeCity, setBecomeCity] = useState("");
  const [becomeContact, setBecomeContact] = useState("");
  const [becomeBio, setBecomeBio] = useState("");
  const [becomeBusy, setBecomeBusy] = useState(false);
  const [becomeSent, setBecomeSent] = useState(false);
  const [becomeError, setBecomeError] = useState<unknown>(null);
  const loadTrainerApp = () => {
    api<{ trainer: TrainerProfile | null }>("/api/v2/trainer/profile").then((data) => {
      setTrainerApp(data.trainer);
      if (!data.trainer) return;
      setBecomeName(data.trainer.name); setBecomeSpecialization(data.trainer.specialization);
      setBecomeCity(data.trainer.city); setBecomeContact(data.trainer.contact); setBecomeBio(data.trainer.bio);
    }).catch(() => setTrainerApp(null));
  };
  useEffect(loadTrainerApp, []);
  const applyAsTrainer = async () => {
    if (!becomeName.trim()) return;
    setBecomeBusy(true); setBecomeError(null); setBecomeSent(false);
    try {
      await api("/api/v2/trainer/profile", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"updateTrainerProfile">({ name: becomeName.trim(), specialization: becomeSpecialization.trim(), city: becomeCity.trim(), contact: becomeContact.trim(), bio: becomeBio.trim() }) });
      setBecomeSent(true);
      loadTrainerApp();
    } catch (err) { setBecomeError(err); } finally { setBecomeBusy(false); }
  };

  if (trainerApp === undefined || (trainerApp === null && role !== "solo")) return null;
  return <Card>
    <div className="section-head"><div><span className="eyebrow">{t(lang, "become_trainer_eyebrow")}</span><h2>{trainerApp ? t(lang, "trainer_profile_edit_title") : t(lang, "become_trainer_title")}</h2></div>{trainerApp && <span className="tag">{t(lang, "trainer_clients_count", { n: trainerApp.clients })}</span>}</div>
    {becomeSent && !trainerApp ? <p className="muted">{t(lang, "become_trainer_pending_note")}</p> : <>
      {trainerApp ? <p className="muted"><strong>{t(lang, `trainer_status_${trainerApp.status}_title` as Key)}</strong> — {t(lang, `trainer_status_${trainerApp.status}_body` as Key)}</p> : <p className="muted">{t(lang, "become_trainer_detail")}</p>}
      <div className="form-grid">
        <label className="form-field"><span>{t(lang, "field_name")}</span><input value={becomeName} maxLength={60} onChange={(event) => setBecomeName(event.target.value)} /></label>
        <label className="form-field"><span>{t(lang, "field_specialization")}</span><input value={becomeSpecialization} maxLength={120} onChange={(event) => setBecomeSpecialization(event.target.value)} /></label>
        <label className="form-field"><span>{t(lang, "field_city")}</span><input value={becomeCity} maxLength={60} onChange={(event) => setBecomeCity(event.target.value)} /></label>
        <label className="form-field"><span>{t(lang, "field_contact")}</span><input value={becomeContact} maxLength={120} onChange={(event) => setBecomeContact(event.target.value)} /></label>
      </div>
      <label className="form-field"><span>{t(lang, "field_bio")}</span><textarea value={becomeBio} maxLength={600} onChange={(event) => setBecomeBio(event.target.value)} /></label>
      <div className="button-row" style={{ marginTop: 10 }}>
        <button className="button button-primary" disabled={becomeBusy || !becomeName.trim()} onClick={() => void applyAsTrainer()}>{becomeBusy ? t(lang, "saving_ellipsis") : t(lang, trainerApp ? "save_profile_btn" : "become_trainer_btn")}</button>
      </div>
      {becomeSent && trainerApp && <div className="save-note">{t(lang, "profile_updated_note")}</div>}
      {becomeError !== null && <div className="save-note error-note">{t(lang, "generic_error")}</div>}
    </>}
  </Card>;
}
