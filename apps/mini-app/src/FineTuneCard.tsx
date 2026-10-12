import { useState } from "react";
import { api, typedBody } from "./api";
import { t, type Key, type Lang } from "./i18n";
import type { Dashboard } from "./types";

type Gap = NonNullable<Dashboard["viewer"]["profileGaps"]>[number];

// The questions onboarding no longer asks (or that the no-questionnaire start skipped), one at a
// time on Today. Each answer saves at once; filling a calorie input recomputes the targets on the
// server. "Later" hides the card for this session only -- it comes back while gaps remain.
const CHOICES: Partial<Record<Gap, Array<{ value: string | number; label: Key }>>> = {
  sex: [{ value: "male", label: "sex_male" }, { value: "female", label: "sex_female" }],
  lifestyle: [{ value: "sedentary", label: "obo_life_sedentary" }, { value: "moderate", label: "obo_life_moderate" }, { value: "active", label: "obo_life_active" }],
  sessionMinutes: [{ value: 30, label: "obo_min_30" }, { value: 45, label: "obo_min_45" }, { value: 60, label: "obo_min_60" }, { value: 90, label: "obo_min_90" }],
  dietPrefs: [{ value: "none", label: "diet_everything" }, { value: "vegetarian", label: "diet_vegetarian" }, { value: "vegan", label: "diet_vegan" }],
};
const QUESTION: Record<Gap, Key> = {
  sex: "obq_sex", age: "obq_age", heightCm: "obq_height", weightKg: "obq_weight",
  lifestyle: "obq_lifestyle", sessionMinutes: "obq_duration", dietPrefs: "obq_diet",
};
const NUMBER: Partial<Record<Gap, { min: number; max: number; step?: number; unit: Key; placeholder: string }>> = {
  age: { min: 13, max: 100, unit: "obu_years", placeholder: "30" },
  heightCm: { min: 100, max: 250, unit: "obu_cm", placeholder: "175" },
  weightKg: { min: 30, max: 300, step: 0.1, unit: "obu_kg", placeholder: "75" },
};

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
  const num = NUMBER[gap];
  const n = Number(value.replace(",", "."));
  const valid = !!num && value !== "" && Number.isFinite(n) && n >= num.min && n <= num.max;

  return <div className="card card-default fine-tune">
    <div className="section-head"><div><span className="eyebrow">{t(lang, "ft_eyebrow", { n: left.length })}</span><h2>{t(lang, QUESTION[gap])}</h2></div></div>
    <p className="muted">{t(lang, "ft_why")}</p>
    {CHOICES[gap] && <div className="ob-options">
      {CHOICES[gap]!.map((o) => <button key={String(o.value)} type="button" className="ob-option" disabled={busy} onClick={() => void save(o.value)}>{t(lang, o.label)}</button>)}
    </div>}
    {num && <div className="input-row">
      <input type="number" inputMode="decimal" min={num.min} max={num.max} step={num.step ?? 1} placeholder={num.placeholder} value={value} onChange={(e) => setValue(e.target.value)} />
      <span className="muted">{t(lang, num.unit)}</span>
      <button type="button" className="button button-primary" disabled={busy || !valid} onClick={() => void save(gap === "weightKg" ? Math.round(n * 10) / 10 : Math.round(n))}>{busy ? "…" : t(lang, "ft_save")}</button>
    </div>}
    <div className="button-row"><button type="button" className="text-button" onClick={() => setHidden(true)}>{t(lang, "ft_later")}</button></div>
  </div>;
}
