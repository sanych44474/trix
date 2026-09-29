// Exercise library: the 750 free-exercise-db exercises with pictures, filtered by muscle and
// equipment or searched by its Ukrainian or English name (Ukrainian movement words also map to English).
// Names show in the user's language (Ukrainian ones are baked into the data); opening one shows
// both frames and short steps (translated once server-side), and "add to plan" puts it on a plan
// day under that name with the English one as canonical, so the logger's pictures match exactly. Data and matcher load lazily with this view.
import { useEffect, useMemo, useState } from "react";
import { api, typedBody } from "./api";
import { t, type Key, type Lang } from "./i18n";
import type { Plan } from "./types";
import { FREE_EXERCISE_LIB } from "./data/freeExerciseLib";
import { FREE_EXERCISE_DB_COMMIT } from "./data/freeExerciseIds";
import { exerciseImageUrls } from "./logic/exerciseImages";
import { filterLibrary, parseLibrary, type LibraryEntry } from "./logic/library";

const MUSCLES = ["chest", "upper-back", "deltoids", "biceps", "triceps", "forearm", "abs", "obliques", "quadriceps", "hamstring", "gluteal", "calves", "adductors", "lower-back", "trapezius", "neck"];
const EQUIPMENT = ["body", "dumbbell", "barbell", "kettlebell", "band", "cable", "machine", "ezbar", "ball", "other"];
const WEEKDAY_KEYS: Key[] = ["weekday_mon", "weekday_tue", "weekday_wed", "weekday_thu", "weekday_fri", "weekday_sat", "weekday_sun"];
const PAGE = 30;

export function LibraryView({ lang, onBack }: { lang: Lang; onBack: () => void }) {
  const all = useMemo(() => parseLibrary(FREE_EXERCISE_LIB), []);
  const [muscle, setMuscle] = useState("");
  const [equipment, setEquipment] = useState("");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const list = useMemo(() => filterLibrary(all, { muscle, equipment, query }), [all, muscle, equipment, query]);
  useEffect(() => setShown(PAGE), [muscle, equipment, query]);
  const muscleLabel = (s: string) => t(lang, `muscle_${s.replace("-", "_")}` as Key);

  return <div className="view-stack">
    <button className="text-button" onClick={onBack}>← {t(lang, "nav_more")}</button>
    <div className="eyebrow">{t(lang, "exlib_eyebrow")}</div>
    <div className="page-title"><h1>{t(lang, "exlib_title")}</h1><span>{list.length}</span></div>
    <div className="library-filters">
      <input type="search" value={query} placeholder={t(lang, "library_search_ph")} onChange={(e) => setQuery(e.target.value)} />
      <select value={muscle} onChange={(e) => setMuscle(e.target.value)} aria-label={t(lang, "library_muscle")}>
        <option value="">{t(lang, "library_all_muscles")}</option>
        {MUSCLES.map((m) => <option key={m} value={m}>{muscleLabel(m)}</option>)}
      </select>
      <div className="chip-row">
        {EQUIPMENT.map((e) => (
          <button key={e} type="button" className={equipment === e ? "chip active" : "chip"} onClick={() => setEquipment(equipment === e ? "" : e)}>{t(lang, `libeq_${e}` as Key)}</button>
        ))}
      </div>
    </div>
    {list.length === 0 && <p className="muted">{t(lang, "library_empty")}</p>}
    <div className="library-list">
      {list.slice(0, shown).map((ex) => (
        <LibraryCard key={ex.id} lang={lang} ex={ex} open={open === ex.id} onToggle={() => setOpen(open === ex.id ? null : ex.id)} muscleLabel={muscleLabel} />
      ))}
    </div>
    {shown < list.length && <button className="button button-ghost" onClick={() => setShown(shown + PAGE)}>{t(lang, "library_more", { n: list.length - shown })}</button>}
    <p className="muted library-credit">{t(lang, "library_credit")}</p>
  </div>;
}

function LibraryCard({ lang, ex, open, onToggle, muscleLabel }: { lang: Lang; ex: LibraryEntry; open: boolean; onToggle: () => void; muscleLabel: (s: string) => string }) {
  const [thumb, full] = exerciseImageUrls(ex.id, FREE_EXERCISE_DB_COMMIT);
  const [details, setDetails] = useState<{ steps: string[]; name: string } | null>(null);
  const [days, setDays] = useState<Plan["days"] | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [day, setDay] = useState<number | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "added" | "error">("idle");
  useEffect(() => {
    if (!open || details) return;
    api<{ steps: string[]; name: string }>(`/api/v2/workout/steps?id=${encodeURIComponent(ex.id)}`).then(setDetails).catch(() => setDetails({ steps: [], name: ex.title }));
    api<Plan>("/api/v2/plan").then((p) => { setPlan(p); setDays(p.days ?? []); setDay(p.days?.[0]?.weekday ?? null); }).catch(() => setDays([]));
  }, [open, details, ex.id, ex.title]);
  const name = lang === "en" ? ex.title : ex.titleUk;
  const add = async () => {
    if (!plan || day === null) return;
    setState("busy");
    try {
      await api("/api/v2/plan", {
        method: "POST",
        headers: { "If-Match": `"${plan.version}"` },
        idempotencyKey: crypto.randomUUID(),
        body: typedBody<"editPlan">({ weekday: day, index: -1, action: "add", value: name, freeExerciseId: ex.id }),
      });
      setState("added");
    } catch { setState("error"); }
  };
  return (
    <article className={open ? "library-card open" : "library-card"}>
      <button type="button" className="library-row" onClick={onToggle} aria-expanded={open}>
        <img src={thumb} alt="" loading="lazy" decoding="async" width="72" height="54" />
        <span><strong>{name}</strong><small>{muscleLabel(ex.muscle)} · {t(lang, `libeq_${ex.equipment}` as Key)} · {t(lang, `liblevel_${ex.level}` as Key)}</small></span>
      </button>
      {open && <div className="library-detail">
        <div className="technique-frames"><div><img src={thumb} alt={`${ex.title} 1/2`} /><img src={full} alt={`${ex.title} 2/2`} loading="lazy" /></div></div>
        {details === null ? <div className="skeleton" /> : details.steps.length > 0 && <ol className="technique-steps">{details.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
        {days && days.length > 0 && <div className="library-add">
          <select value={day ?? ""} onChange={(e) => setDay(Number(e.target.value))} aria-label={t(lang, "library_day")}>
            {days.map((d) => <option key={d.weekday} value={d.weekday}>{t(lang, WEEKDAY_KEYS[d.weekday - 1]!)} · {d.muscleGroup}</option>)}
          </select>
          <button className="button button-primary" disabled={state === "busy" || state === "added"} onClick={() => void add()}>
            {state === "busy" ? "…" : state === "added" ? t(lang, "library_added") : t(lang, "library_add")}
          </button>
        </div>}
        {days && days.length === 0 && <p className="muted">{t(lang, "library_no_plan")}</p>}
        {state === "error" && <p className="muted">{t(lang, "generic_error")}</p>}
      </div>}
    </article>
  );
}
