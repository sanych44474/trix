import { useState } from "react";
import { ApiError, api, jsonBody } from "./api";
import { t, type Key, type Lang } from "./i18n";

type Props = { onComplete: () => void; lang: Lang };

const options = {
  goal: [["fat loss", "goal_fat_loss"], ["muscle gain", "goal_muscle_gain"], ["recomposition", "goal_recomposition"], ["strength", "goal_strength"], ["endurance", "goal_endurance"]],
  level: [["beginner", "level_beginner"], ["intermediate", "level_intermediate"], ["advanced", "level_advanced"]],
  equipment: [["full gym", "equip_full_gym"], ["home basics (dumbbells, bands)", "equip_home_basics"], ["dumbbells only", "equip_dumbbells_only"], ["bodyweight only", "equip_bodyweight_only"]],
  diet: [["none", "diet_everything"], ["vegetarian", "diet_vegetarian"], ["vegan", "diet_vegan"]],
} as const satisfies Record<string, ReadonlyArray<readonly [string, Key]>>;

const weekdayKeys: Key[] = ["weekday_mon", "weekday_tue", "weekday_wed", "weekday_thu", "weekday_fri", "weekday_sat", "weekday_sun"];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="form-field"><span>{label}</span>{children}</label>;
}

export function OnboardingView({ onComplete, lang }: Props) {
  const [sex, setSex] = useState<"male" | "female">("male");
  const [age, setAge] = useState("30");
  const [heightCm, setHeightCm] = useState("175");
  const [weightKg, setWeightKg] = useState("75");
  const [goal, setGoal] = useState("muscle gain");
  const [level, setLevel] = useState("beginner");
  const [equipment, setEquipment] = useState("full gym");
  const [dietPrefs, setDietPrefs] = useState("none");
  const [days, setDays] = useState<number[]>([1, 3, 5]);
  const [limitations, setLimitations] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggleDay = (day: number) => setDays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day].sort((a, b) => a - b));
  const submit = async () => {
    if (days.length === 0) { setError(t(lang, "choose_day_error")); return; }
    setSaving(true); setError(null);
    try {
      await api("/api/v2/onboarding", { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({ sex, age: Number(age), heightCm: Number(heightCm), weightKg: Number(weightKg), goal, level, equipment, dietPrefs, trainingWeekdays: days, limitations: limitations.trim() || "none" }) });
      onComplete();
    } catch (err) {
      setError(err instanceof ApiError && err.code === "validation_error" ? t(lang, "validation_error_hint") : t(lang, "onboarding_save_error"));
    } finally { setSaving(false); }
  };
  return <div className="onboarding view-stack"><div className="eyebrow">{t(lang, "ob_eyebrow")}</div><div className="page-title"><h1>{t(lang, "ob_title")}</h1><span>{t(lang, "ob_time")}</span></div><p className="muted">{t(lang, "ob_intro")}</p><section className="card"><div className="section-head"><div><span className="eyebrow">{t(lang, "about_you_eyebrow")}</span><h2>{t(lang, "starting_point_title")}</h2></div></div><div className="form-grid"><Field label={t(lang, "field_sex")}><select value={sex} onChange={(event) => setSex(event.target.value as "male" | "female")}><option value="male">{t(lang, "sex_male")}</option><option value="female">{t(lang, "sex_female")}</option></select></Field><Field label={t(lang, "field_age")}><input type="number" min="13" max="120" value={age} onChange={(event) => setAge(event.target.value)} /></Field><Field label={t(lang, "field_height_cm")}><input type="number" min="100" max="250" value={heightCm} onChange={(event) => setHeightCm(event.target.value)} /></Field><Field label={t(lang, "field_weight_kg")}><input type="number" min="30" max="300" step="0.1" value={weightKg} onChange={(event) => setWeightKg(event.target.value)} /></Field></div></section><section className="card"><div className="section-head"><div><span className="eyebrow">{t(lang, "direction_eyebrow")}</span><h2>{t(lang, "training_for_title")}</h2></div></div><div className="form-grid"><Field label={t(lang, "field_goal")}><select value={goal} onChange={(event) => setGoal(event.target.value)}>{options.goal.map(([value, key]) => <option key={value} value={value}>{t(lang, key)}</option>)}</select></Field><Field label={t(lang, "field_experience")}><select value={level} onChange={(event) => setLevel(event.target.value)}>{options.level.map(([value, key]) => <option key={value} value={value}>{t(lang, key)}</option>)}</select></Field><Field label={t(lang, "field_equipment")}><select value={equipment} onChange={(event) => setEquipment(event.target.value)}>{options.equipment.map(([value, key]) => <option key={value} value={value}>{t(lang, key)}</option>)}</select></Field><Field label={t(lang, "field_food_pref")}><select value={dietPrefs} onChange={(event) => setDietPrefs(event.target.value)}>{options.diet.map(([value, key]) => <option key={value} value={value}>{t(lang, key)}</option>)}</select></Field></div></section><section className="card"><div className="section-head"><div><span className="eyebrow">{t(lang, "rhythm_eyebrow")}</span><h2>{t(lang, "choose_days_title")}</h2></div><span className="tag">{t(lang, "days_count", { n: days.length })}</span></div><div className="weekday-grid">{weekdayKeys.map((key, index) => <button className={days.includes(index + 1) ? "weekday selected" : "weekday"} key={key} onClick={() => toggleDay(index + 1)}>{t(lang, key)}</button>)}</div><Field label={t(lang, "field_limitations")}><textarea value={limitations} maxLength={500} placeholder={t(lang, "limitations_ph")} onChange={(event) => setLimitations(event.target.value)} /></Field></section>{error && <div className="save-note error-note">{error}</div>}<button className="button button-primary button-wide" onClick={() => void submit()} disabled={saving}>{saving ? t(lang, "building_plan_ellipsis") : t(lang, "create_plan_btn")}</button></div>;
}
