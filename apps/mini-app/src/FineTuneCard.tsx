import { useState } from "react";
import { api, typedBody } from "./api";
import { t, type Key, type Lang } from "./i18n";
import type { Dashboard } from "./types";
import { QUESTIONS, type QuestionId } from "../../../src/domain/onboardingQuestions";

type Gap = NonNullable<Dashboard["viewer"]["profileGaps"]>[number];

// The questions onboarding no longer asks (or that the no-questionnaire start skipped), one at a
// time on Today. Each answer saves at once; filling a calorie input recomputes the targets on the
// server. "Later" hides the card for this session only -- it comes back while gaps remain.
// Options, labels and bounds come from the onboarding question set (src/domain/onboardingQuestions.ts).
const QUESTION_ID: Record<Gap, QuestionId> = {
  sex: "sex", age: "age", heightCm: "height", weightKg: "weight",
  lifestyle: "lifestyle", sessionMinutes: "duration", dietPrefs: "diet",
};
const question = (gap: Gap) => QUESTIONS.find((q) => q.id === QUESTION_ID[gap])!;
// sessionMinutes is a number on the profile; every other choice is a string.
const choiceValue = (gap: Gap, value: string): string | number => (gap === "sessionMinutes" ? Number(value) : value);

export function FineTuneCard({ lang, gaps, onSaved }: { lang: Lang; gaps: Gap[]; onSaved: () => void }) {
  const [hidden, setHidden] = useState(false);
  const [done, setDone] = useState<Gap[]>([]);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const left = gaps.filter((g) => !done.includes(g));
  const gap = left[0];
  if (hidden || !gap) return null;

  const save = async (v: string | number) => {
    setBusy(true);
    try {
      await api("/api/v2/profile", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"updateProfile">({ [gap]: v }) });
      setDone((d) => [...d, gap]);
      setValue("");
      if (left.length === 1) onSaved();
    } catch { /* keep the question; the user can retry */ } finally { setBusy(false); }
  };
  const q = question(gap);
  const num = q.number;
  const n = Number(value.replace(",", "."));
  const valid = !!num && value !== "" && Number.isFinite(n) && n >= num.min && n <= num.max;

  return <div className="card card-default fine-tune">
    <div className="section-head"><div><span className="eyebrow">{t(lang, "ft_eyebrow", { n: left.length })}</span><h2>{t(lang, q.q as Key)}</h2></div></div>
    <p className="muted">{t(lang, "ft_why")}</p>
    {q.options && <div className="ob-options">
      {q.options.map((o) => <button key={o.value} type="button" className="ob-option" disabled={busy} onClick={() => void save(choiceValue(gap, o.value))}>{t(lang, o.label as Key)}</button>)}
    </div>}
    {num && <div className="input-row">
      <input type="number" inputMode="decimal" min={num.min} max={num.max} step={num.step} placeholder={num.placeholder} value={value} onChange={(e) => setValue(e.target.value)} />
      <span className="muted">{t(lang, num.unit as Key)}</span>
      <button type="button" className="button button-primary" disabled={busy || !valid} onClick={() => void save(gap === "weightKg" ? Math.round(n * 10) / 10 : Math.round(n))}>{busy ? "…" : t(lang, "ft_save")}</button>
    </div>}
    <div className="button-row"><button type="button" className="text-button" onClick={() => setHidden(true)}>{t(lang, "ft_later")}</button></div>
  </div>;
}
