import { useEffect, useRef, useState } from "react";
import { ApiError, api, typedBody } from "./api";
import { t, type Key, type Lang } from "./i18n";
import { BecomeTrainerCard } from "./BecomeTrainer";
import { FindTrainer } from "./FindTrainer";
import { DRAFT_KEY, choose, chosen, firstOpenStep, isAnswered, parseDraft, stepsFor, toRequest, type Answers, type Step } from "./logic/onboardingWizard";

type Props = { lang: Lang; isClient: boolean; onComplete: () => void; onLangChange: (lang: Lang) => void; onReload?: () => void };

const weekdayKeys: Key[] = ["weekday_mon", "weekday_tue", "weekday_wed", "weekday_thu", "weekday_fri", "weekday_sat", "weekday_sun"];
const liftKeys = ["bench", "squat", "deadlift"] as const;

const readDraft = (): Answers => { try { return parseDraft(localStorage.getItem(DRAFT_KEY)); } catch { return {}; } };
const saveDraft = (a: Answers) => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(a)); } catch { /* the draft is a convenience */ } };
const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* the draft is a convenience */ } };
const deviceTimeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { return undefined; } };

/**
 * The onboarding questionnaire: a welcome screen, then one question per screen. Choice answers
 * advance on tap; typed answers have a Next button. Answers are kept on the phone as a draft, so
 * closing the app resumes at the first open question.
 */
export function OnboardingView({ lang, isClient, onComplete, onLangChange, onReload }: Props) {
  const [answers, setAnswers] = useState<Answers>(readDraft);
  // -1 is the welcome screen; a returning user with a draft resumes at the first open question.
  const [index, setIndex] = useState(() => (Object.keys(readDraft()).length ? firstOpenStep(readDraft(), isClient) : -1));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [langBusy, setLangBusy] = useState(false);
  // "I'm a coach" on the first screen: the trainer application instead of the questionnaire.
  const [coach, setCoach] = useState(false);
  // "Choose a trainer": the directory and the pending request.
  const [findTrainer, setFindTrainer] = useState(false);
  const advanceTimer = useRef<number | undefined>(undefined);
  const steps = stepsFor(answers, isClient);
  const step = index >= 0 ? steps[Math.min(index, steps.length - 1)] : undefined;
  const isLast = index === steps.length - 1;

  useEffect(() => { saveDraft(answers); }, [answers]);
  useEffect(() => () => window.clearTimeout(advanceTimer.current), []);
  useEffect(() => { window.scrollTo?.(0, 0); }, [index]);

  // Telegram's own Back button steps back through the questions.
  useEffect(() => {
    const back = window.Telegram?.WebApp.BackButton;
    if (!back) return;
    if (index < 0) { back.hide(); return; }
    const handler = () => setIndex((i) => i - 1);
    back.show();
    back.onClick(handler);
    return () => back.offClick(handler);
  }, [index]);

  const update = (next: Answers) => { setError(null); setAnswers(next); };
  const goNext = () => { if (step && isAnswered(step, answers)) { if (isLast) void submit(answers); else setIndex(index + 1); } };

  const submit = async (final: Answers) => {
    const body = toRequest(final, isClient, deviceTimeZone());
    if (!body) { setIndex(firstOpenStep(final, isClient)); return; }
    setSaving(true); setError(null);
    try {
      await api("/api/v2/onboarding", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"completeOnboarding">(body) });
      clearDraft();
      onComplete();
    } catch (err) {
      setError(err instanceof ApiError && err.code === "validation_error" ? t(lang, "validation_error_hint") : t(lang, "onboarding_save_error"));
    } finally { setSaving(false); }
  };

  const pick = (s: Step, value: string) => {
    const next = choose(s, answers, value);
    update(next);
    window.clearTimeout(advanceTimer.current);
    // A short beat so the tap visibly lands before the next question slides in.
    advanceTimer.current = window.setTimeout(() => {
      const nextSteps = stepsFor(next, isClient);
      if (index >= nextSteps.length - 1) void submit(next);
      else setIndex(index + 1);
    }, 180);
  };

  const switchLang = async (next: Lang) => {
    if (next === lang || langBusy) return;
    setLangBusy(true);
    try {
      await api("/api/v2/settings", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"updateSettings">({ action: "lang", lang: next }) });
      onLangChange(next);
    } catch { /* keep the current language */ } finally { setLangBusy(false); }
  };

  if (!step && findTrainer && !isClient) {
    return <FindTrainer lang={lang} onBack={() => setFindTrainer(false)} onAccepted={() => { setFindTrainer(false); onReload?.(); }} />;
  }

  if (!step && coach) {
    return <div className="ob-wizard view-stack">
      <div className="ob-progress"><button type="button" className="text-button" onClick={() => setCoach(false)}>← {t(lang, "ob_back_btn")}</button></div>
      <BecomeTrainerCard lang={lang} role="solo" />
    </div>;
  }

  if (!step) {
    return <div className="ob-wizard view-stack">
      <div className="ob-welcome">
        <span className="eyebrow">{t(lang, "ob_time")}</span>
        <h1>{t(lang, "ob_welcome_title")}</h1>
        <p className="muted">{t(lang, "ob_welcome_body")}</p>
      </div>
      <div className="ob-lang" role="group" aria-label={t(lang, "ob_lang_label")}>
        {(["uk", "en"] as const).map((l) => <button key={l} type="button" className={lang === l ? "ob-chip selected" : "ob-chip"} disabled={langBusy} onClick={() => void switchLang(l)}>{t(lang, l === "uk" ? "lang_uk_label" : "lang_en_label")}</button>)}
      </div>
      <div className="ob-options">
        <button type="button" className="ob-option selected" onClick={() => setIndex(firstOpenStep(answers, isClient))}>{t(lang, isClient ? "ob_start_btn" : "ob_role_athlete_btn")}</button>
        {!isClient && <button type="button" className="ob-option" onClick={() => setFindTrainer(true)}>{t(lang, "ob_role_trainer_btn")}</button>}
        {!isClient && <button type="button" className="ob-option" onClick={() => setCoach(true)}>{t(lang, "ob_role_coach_btn")}</button>}
      </div>
    </div>;
  }

  const shown = Math.min(index, steps.length - 1);
  const progress = Math.round(((shown + 1) / steps.length) * 100);
  const numberValue = (s: Step) => (s.id === "age" ? answers.age : s.id === "height" ? answers.heightCm : answers.weightKg);
  const setNumber = (s: Step, raw: string) => {
    const v = raw === "" ? undefined : Number(raw.replace(",", "."));
    update(s.id === "age" ? { ...answers, age: v } : s.id === "height" ? { ...answers, heightCm: v } : { ...answers, weightKg: v });
  };
  const toggleDay = (day: number) => {
    const cur = answers.trainingWeekdays ?? [];
    update({ ...answers, trainingWeekdays: cur.includes(day) ? cur.filter((d) => d !== day) : [...cur, day].sort((a, b) => a - b) });
  };

  return <div className="ob-wizard view-stack">
    <div className="ob-progress">
      <button type="button" className="text-button" onClick={() => setIndex(index - 1)}>← {t(lang, "ob_back_btn")}</button>
      <span className="muted">{t(lang, "ob_step_of", { n: shown + 1, total: steps.length })}</span>
    </div>
    <div className="ob-bar" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>

    <div className="ob-question" key={step.id}>
      <h1>{t(lang, step.q)}</h1>
      {step.hint && <p className="muted">{t(lang, step.hint)}</p>}

      {step.kind === "choice" && <div className="ob-options">
        {step.options!.map((o) => <button key={o.value} type="button" className={chosen(step, answers) === o.value ? "ob-option selected" : "ob-option"} disabled={saving} onClick={() => pick(step, o.value)}>{t(lang, o.label)}</button>)}
      </div>}

      {step.kind === "number" && <label className="ob-number">
        <input type="number" inputMode="decimal" autoFocus min={step.number!.min} max={step.number!.max} step={step.number!.step ?? 1} placeholder={step.number!.placeholder} value={numberValue(step) ?? ""} onChange={(e) => setNumber(step, e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") goNext(); }} />
        <span>{t(lang, step.number!.unit)}</span>
      </label>}

      {step.kind === "lifts" && <div className="ob-lifts">
        {liftKeys.map((lift) => <label key={lift} className="form-field"><span>{t(lang, `ob_lift_${lift}`)}</span><input type="number" inputMode="decimal" min="0" max="400" placeholder={t(lang, "unit_kg_ph")} value={answers.lifts?.[lift] ?? ""} onChange={(e) => update({ ...answers, lifts: { ...answers.lifts, [lift]: e.target.value === "" ? undefined : Number(e.target.value) } })} /></label>)}
      </div>}

      {step.kind === "days" && <div className="ob-days">
        {weekdayKeys.map((key, i) => <button key={key} type="button" className={(answers.trainingWeekdays ?? []).includes(i + 1) ? "ob-chip selected" : "ob-chip"} onClick={() => toggleDay(i + 1)}>{t(lang, key)}</button>)}
      </div>}

      {step.kind === "text" && <div className="ob-text">
        <textarea maxLength={500} placeholder={t(lang, "limitations_ph")} value={answers.limitations && answers.limitations !== "none" ? answers.limitations : ""} onChange={(e) => update({ ...answers, limitations: e.target.value })} />
        <button type="button" className={answers.limitations === "none" ? "ob-option selected" : "ob-option"} disabled={saving} onClick={() => { const next = { ...answers, limitations: "none" }; update(next); if (isLast) void submit(next); else setIndex(index + 1); }}>{t(lang, "ob_no_limits_btn")}</button>
      </div>}
    </div>

    {error && <div className="save-note error-note">{error}</div>}

    {step.kind !== "choice" && <div className="ob-actions">
      {step.kind === "lifts" && <button type="button" className="button button-ghost" onClick={() => { update({ ...answers, lifts: undefined }); setIndex(index + 1); }}>{t(lang, "ob_skip_btn")}</button>}
      <button type="button" className="button button-primary button-wide" disabled={saving || !isAnswered(step, answers) || (step.kind === "text" && !answers.limitations?.trim())} onClick={goNext}>{saving ? t(lang, "building_plan_ellipsis") : isLast ? t(lang, "ob_finish_btn") : t(lang, "ob_next_btn")}</button>
    </div>}
    {step.kind === "choice" && saving && <div className="save-note">{t(lang, "building_plan_ellipsis")}</div>}
  </div>;
}
