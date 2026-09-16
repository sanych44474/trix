import { useState } from "react";
import { ApiError, api, jsonBody } from "./api";

type Props = { onComplete: () => void };

const options = {
  goal: [["fat loss", "Fat loss"], ["muscle gain", "Muscle gain"], ["recomposition", "Recomposition"], ["strength", "Strength"], ["endurance", "Endurance"]],
  level: [["beginner", "Beginner"], ["intermediate", "Intermediate"], ["advanced", "Advanced"]],
  equipment: [["full gym", "Full gym"], ["home basics (dumbbells, bands)", "Home basics"], ["dumbbells only", "Dumbbells only"], ["bodyweight only", "Bodyweight only"]],
  diet: [["none", "Everything"], ["vegetarian", "Vegetarian"], ["vegan", "Vegan"]],
} as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="form-field"><span>{label}</span>{children}</label>;
}

export function OnboardingView({ onComplete }: Props) {
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
    if (days.length === 0) { setError("Choose at least one training day."); return; }
    setSaving(true); setError(null);
    try {
      await api("/api/v2/onboarding", { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({ sex, age: Number(age), heightCm: Number(heightCm), weightKg: Number(weightKg), goal, level, equipment, dietPrefs, trainingWeekdays: days, limitations: limitations.trim() || "none" }) });
      onComplete();
    } catch (err) {
      setError(err instanceof ApiError && err.code === "validation_error" ? "Check the required fields and try again." : "Could not save onboarding. Try again.");
    } finally { setSaving(false); }
  };
  return <div className="onboarding view-stack"><div className="eyebrow">TRIX / V2 · START HERE</div><div className="page-title"><h1>Build your baseline</h1><span>2 minutes</span></div><p className="muted">A few honest inputs are enough to shape your first plan. You can change everything later.</p><section className="card"><div className="section-head"><div><span className="eyebrow">ABOUT YOU</span><h2>Starting point</h2></div></div><div className="form-grid"><Field label="Sex"><select value={sex} onChange={(event) => setSex(event.target.value as "male" | "female")}><option value="male">Male</option><option value="female">Female</option></select></Field><Field label="Age"><input type="number" min="13" max="120" value={age} onChange={(event) => setAge(event.target.value)} /></Field><Field label="Height, cm"><input type="number" min="100" max="250" value={heightCm} onChange={(event) => setHeightCm(event.target.value)} /></Field><Field label="Weight, kg"><input type="number" min="30" max="300" step="0.1" value={weightKg} onChange={(event) => setWeightKg(event.target.value)} /></Field></div></section><section className="card"><div className="section-head"><div><span className="eyebrow">DIRECTION</span><h2>What are we training for?</h2></div></div><div className="form-grid"><Field label="Goal"><select value={goal} onChange={(event) => setGoal(event.target.value)}>{options.goal.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="Experience"><select value={level} onChange={(event) => setLevel(event.target.value)}>{options.level.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="Equipment"><select value={equipment} onChange={(event) => setEquipment(event.target.value)}>{options.equipment.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="Food preference"><select value={dietPrefs} onChange={(event) => setDietPrefs(event.target.value)}>{options.diet.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></div></section><section className="card"><div className="section-head"><div><span className="eyebrow">RHYTHM</span><h2>Choose your days</h2></div><span className="tag">{days.length} days</span></div><div className="weekday-grid">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label, index) => <button className={days.includes(index + 1) ? "weekday selected" : "weekday"} key={label} onClick={() => toggleDay(index + 1)}>{label}</button>)}</div><Field label="Limitations or injuries (optional)"><textarea value={limitations} maxLength={500} placeholder="Anything your plan should respect" onChange={(event) => setLimitations(event.target.value)} /></Field></section>{error && <div className="save-note error-note">{error}</div>}<button className="button button-primary button-wide" onClick={() => void submit()} disabled={saving}>{saving ? "Building your plan…" : "Create my plan"}</button></div>;
}
