// One exercise in the logger. Built for the gym: one set is "active" at a time, with large
// steppers for the load and the reps (or seconds / metres) and one big "Done" button under the
// thumb. Done sets collapse to a line above it; the next set becomes active by itself. The
// active set's numbers live in local state until "Done", so stepping through a value never
// half-logs a set. Less frequent actions (swap, repeat last time, rest options, reorder,
// delete) sit behind the "more" button instead of a row of orange links on every card.
import { useEffect, useState } from "react";
import { TechniqueFrames } from "./TechniqueFrames";
import { FormCheck } from "../media/FormCheck";
import { t, type Lang } from "../i18n";
import type { RestPrefs } from "../logic/rest";
import { isSetFilled, plannedSetsFor, type LoggerExercise, type LoggerSet } from "../logic/logger";
import { Icon } from "../icons";

export type SetField = "weight" | "reps" | "seconds" | "meters" | "rpe";

const REST_CHOICES = [45, 60, 90, 120, 180];
const RPE_CHOICES = [6, 7, 8, 9, 10];

export interface ExerciseCardProps {
  lang: Lang;
  exercise: LoggerExercise;
  expanded: boolean;
  restSec: number;
  restPrefs: RestPrefs;
  restPrefsOpen: boolean;
  swapOpen: boolean;
  swapChoices: Array<{ id: string; name: string }>;
  info: { technique: string; videoUrl?: string; videoTitle?: string } | null; // non-null only while this card's info is open
  busy: string | null;
  onToggle: () => void;
  onStartRest: (seconds: number, label: string) => void;
  onToggleRestPrefs: () => void;
  onPatchRestPrefs: (patch: Partial<RestPrefs>) => void;
  /** A rest chip: this exercise's rest (an override when the plan sets one, else the default). */
  onPickRest: (sec: number) => void;
  onFillPlanned: () => void;
  onFillLast: () => void;
  onOpenSwap: () => void;
  onApplySwap: (choice: { id: string; name: string }) => void;
  onSearchSwap: (text: string) => void;
  onOpenInfo: () => void;
  onWriteSet: (setIndex: number, set: LoggerSet) => void;
  onAddSet: () => void;
  onRemoveSet: (setIndex: number) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}

type Main = "reps" | "seconds" | "meters";
const mainField = (metric: LoggerExercise["metric"]): Main => metric === "time" ? "seconds" : metric === "distance" ? "meters" : "reps";
const num = (n: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);

/** What the next set should be: today's progression target, else the plan's numbers. */
function suggestion(exercise: LoggerExercise, setIndex: number): LoggerSet {
  const planned = plannedSetsFor(exercise);
  const base = planned[Math.min(setIndex, planned.length - 1)] ?? planned[0];
  if (exercise.metric === "reps" && exercise.target) return { ...base, weight: exercise.target.w, reps: exercise.target.r };
  return base;
}

function setSummary(lang: Lang, metric: LoggerExercise["metric"], set: LoggerSet): string {
  if (metric === "time") return `${set.seconds ?? 0} ${t(lang, "ph_sec")}`;
  if (metric === "distance") return `${num(set.meters ?? 0)} ${t(lang, "ph_m")}`;
  return set.weight ? `${t(lang, "set_kg", { n: num(set.weight) })} × ${set.reps}` : `${set.reps} ${t(lang, "ph_reps")}`;
}

export function ExerciseCard(props: ExerciseCardProps) {
  const { lang, exercise, restSec, restPrefs, expanded } = props;
  const main = mainField(exercise.metric);
  const sets = exercise.setsDone ?? [];
  const planned = Math.max(1, exercise.sets || 1);
  const rows = Math.max(planned, sets.length);
  const doneCount = sets.filter(isSetFilled).length;
  const firstOpen = Array.from({ length: rows }, (_, i) => i).find((i) => !(sets[i] && isSetFilled(sets[i])));
  const allDone = firstOpen === undefined;
  const [picked, setPicked] = useState<number | null>(null);
  const active = picked ?? firstOpen ?? null;
  const [menu, setMenu] = useState(false);
  const [rpeOpen, setRpeOpen] = useState(false);

  // The active set's working values: the logged set when editing one, else the suggestion
  // (keeping a load the person already stepped to on this row).
  const seed = (i: number): LoggerSet => {
    const own = sets[i];
    const hint = suggestion(exercise, i);
    if (own && isSetFilled(own)) return { ...own };
    return { ...hint, ...(own?.weight ? { weight: own.weight } : {}) };
  };
  const [draft, setDraft] = useState<LoggerSet | null>(() => active === null ? null : seed(active));
  useEffect(() => { setDraft(active === null ? null : seed(active)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [active, exercise.name, rows]);

  const commit = () => {
    if (active === null || !draft) return;
    const value = Math.max(0, Number(draft[main] ?? 0));
    if (!value) return;
    props.onWriteSet(active, { ...draft, [main]: value });
    setPicked(null);
    if (restPrefs.auto) props.onStartRest(restSec, t(lang, "train_rest_for", { name: exercise.name, n: active + 1 }));
    window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
  };
  const undo = () => {
    if (active === null) return;
    props.onWriteSet(active, { ...(sets[active] ?? draft ?? {}), weight: sets[active]?.weight ?? 0, reps: 0, seconds: exercise.metric === "time" ? 0 : undefined, meters: exercise.metric === "distance" ? 0 : undefined } as LoggerSet);
    setPicked(active);
  };

  const summary = allDone && sets.length
    ? `${doneCount}/${rows} · ${setSummary(lang, exercise.metric, sets.filter(isSetFilled)[doneCount - 1])}`
    : doneCount ? `${doneCount}/${rows}`
    : exercise.planSets ? `${exercise.planSets}${exercise.planWeight ? ` · ${exercise.planWeight}` : ""}` : `${planned} ×`;

  if (!expanded) {
    return (
      <section className={`exercise-card collapsed${allDone && doneCount ? " is-done" : ""}`}>
        <button type="button" className="exercise-toggle" onClick={props.onToggle} aria-expanded={false} aria-label={t(lang, "exercise_open_aria", { name: exercise.name })}>
          <span className="exercise-state" aria-hidden="true">{allDone && doneCount ? <Icon name="check" size={18} /> : exercise.index + 1}</span>
          <span className="exercise-toggle-text"><strong>{exercise.name}</strong><small>{summary}</small></span>
          <Icon name="chevron" size={20} className="row-chevron" />
        </button>
      </section>
    );
  }

  const weightStep = (draft?.weight ?? 0) >= 20 ? 2.5 : 1;
  const mainStep = main === "reps" ? 1 : main === "seconds" ? 5 : (draft?.meters ?? 0) >= 200 ? 50 : 10;
  const fieldLabel = main === "reps" ? t(lang, "field_reps") : main === "seconds" ? t(lang, "field_seconds") : t(lang, "field_meters");
  const bump = (field: "weight" | Main, delta: number) => setDraft((d) => d ? { ...d, [field]: Math.max(0, Math.round(((d[field] ?? 0) + delta) * 100) / 100) } : d);
  const type = (field: "weight" | Main, raw: string) => setDraft((d) => d ? { ...d, [field]: Number(raw.replace(",", ".")) || 0 } : d);
  const activeDone = active !== null && Boolean(sets[active] && isSetFilled(sets[active]));
  const extra = active !== null && active >= planned;

  const renderLines = (from: number, to: number) => from >= to ? null : (
    <ol className="set-lines" start={from + 1}>
      {Array.from({ length: to - from }, (_, k) => {
        const i = from + k;
        const own = sets[i];
        const done = Boolean(own && isSetFilled(own));
        return (
          <li key={i}>
            <button type="button" className={done ? "set-line done" : "set-line"} onClick={() => setPicked(i)} aria-label={t(lang, "set_edit_aria", { n: i + 1 })}>
              <span className="set-index">{i + 1}</span>
              <span className="num">{setSummary(lang, exercise.metric, done ? own! : suggestion(exercise, i))}{done && own!.rpe ? <small> · RPE {own!.rpe}</small> : null}</span>
              {done && <Icon name="check" size={20} className="set-check" />}
            </button>
          </li>
        );
      })}
    </ol>
  );

  return (
    <section className="exercise-card">
      <div className="exercise-top">
        <button type="button" className="exercise-title" onClick={props.onToggle} aria-expanded={true}>
          <span className="exercise-state" aria-hidden="true">{exercise.index + 1}</span>
          <span><strong>{exercise.name}</strong>
            <small>{exercise.planSets ? `${exercise.planSets}${exercise.planWeight ? ` · ${exercise.planWeight}` : ""}` : t(lang, "exercise_sets_line", { n: exercise.sets, detail: exercise.metric === "reps" ? t(lang, "controlled_reps") : t(lang, "measured_effort") })}</small>
            {exercise.planName && <small>{t(lang, "swapped_from_note", { name: exercise.planName })}</small>}
          </span>
        </button>
        <div className="exercise-tools">
          <button type="button" className="icon-button" onClick={props.onOpenInfo} aria-label={t(lang, "train_info_btn")} aria-pressed={Boolean(props.info)}>{props.busy === `info:${exercise.index}` ? "…" : <Icon name="info" />}</button>
          <button type="button" className="icon-button" onClick={() => setMenu((m) => !m)} aria-label={t(lang, "exercise_more_aria")} aria-expanded={menu}><Icon name="dots" /></button>
        </div>
      </div>

      {exercise.target && (
        <p className="target-hint">
          {t(lang, "target_last", { set: setLabel(exercise.target.lastW, exercise.target.lastR) })}
          {" → "}<strong>{t(lang, "target_today", { set: setLabel(exercise.target.w, exercise.target.r) })}</strong>
        </p>
      )}

      {menu && (
        <div className="action-sheet">
          <button type="button" className="chip-button" onClick={() => { props.onFillPlanned(); setMenu(false); }}>{t(lang, "train_as_planned_btn")}</button>
          {exercise.last?.length ? <button type="button" className="chip-button" onClick={() => { props.onFillLast(); setMenu(false); }}>{t(lang, "train_repeat_last_btn")}</button> : null}
          <button type="button" className="chip-button" onClick={props.onOpenSwap}>{props.busy === `swap:${exercise.index}` ? "…" : t(lang, "train_swap_btn")}</button>
          <button type="button" className="chip-button" onClick={() => props.onStartRest(restSec, exercise.name)}><Icon name="timer" size={18} />{restSec} {t(lang, "ph_sec")}</button>
          <button type="button" className="chip-button" onClick={props.onToggleRestPrefs} aria-expanded={props.restPrefsOpen}>{t(lang, "train_rest_prefs_aria")}</button>
          <button type="button" className="chip-button" onClick={() => props.onMove(-1)}>{t(lang, "train_move_up")}</button>
          <button type="button" className="chip-button" onClick={() => props.onMove(1)}>{t(lang, "train_move_down")}</button>
          <button type="button" className="chip-button danger" onClick={props.onRemove}>{t(lang, "train_delete_btn")}</button>
        </div>
      )}
      {props.restPrefsOpen && (
        <div className="chip-row rest-prefs">
          {REST_CHOICES.map((sec) => (
            <button type="button" key={sec} className="chip-button" aria-pressed={restSec === sec} onClick={() => props.onPickRest(sec)}>{sec} {t(lang, "ph_sec")}</button>
          ))}
          <button type="button" className="chip-button" aria-pressed={restPrefs.auto} onClick={() => props.onPatchRestPrefs({ auto: !restPrefs.auto })}>{t(lang, "train_rest_auto")}</button>
          <button type="button" className="chip-button" aria-pressed={restPrefs.sound} onClick={() => props.onPatchRestPrefs({ sound: !restPrefs.sound })}>{t(lang, "train_rest_sound")}</button>
          {exercise.restSec != null && <small className="muted">{t(lang, "train_rest_plan_hint", { sec: exercise.restSec })}</small>}
        </div>
      )}
      {props.swapOpen && (
        <div className="choice-list">
          {props.swapChoices.length
            ? props.swapChoices.map((choice) => <button className="choice-button" key={choice.id || choice.name} onClick={() => props.onApplySwap(choice)}>{choice.name}</button>)
            : <span className="muted">{t(lang, "train_no_swaps")}</span>}
          <form className="input-row swap-search" onSubmit={(event) => { event.preventDefault(); const input = event.currentTarget.elements.namedItem("q") as HTMLInputElement; props.onSearchSwap(input.value); input.value = ""; }}>
            <input name="q" placeholder={t(lang, "swap_search_placeholder")} maxLength={80} autoComplete="off" />
            <button className="button button-secondary" type="submit">{t(lang, "swap_search_btn")}</button>
          </form>
          <small className="muted">{t(lang, "swap_search_hint")}</small>
        </div>
      )}
      {props.info && (
        <div className="info-box">
          <TechniqueFrames lang={lang} name={exercise.name} canonicalName={exercise.canonicalName} />
          <p>{props.info.technique || t(lang, "train_no_info")}</p>
          {props.info.videoUrl && <a href={props.info.videoUrl} target="_blank" rel="noreferrer">{props.info.videoTitle || t(lang, "train_watch_video")}</a>}
          <FormCheck lang={lang} exercise={exercise.name} />
        </div>
      )}

      {renderLines(0, active ?? rows)}
      {active !== null && draft && (
        <div className="active-set" aria-label={extra ? t(lang, "set_extra_n", { n: active + 1 }) : t(lang, "set_n_of", { n: active + 1, total: planned })}>
          <div className="row-between"><strong>{extra ? t(lang, "set_extra_n", { n: active + 1 }) : t(lang, "set_n_of", { n: active + 1, total: planned })}</strong>
            {(activeDone || rows > 1) && <span className="row-actions">
              {activeDone && <button type="button" className="button button-quiet button-small" onClick={undo}>{t(lang, "set_not_done_btn")}</button>}
              {rows > 1 && <button type="button" className="button button-quiet button-small danger" onClick={() => { props.onRemoveSet(active); setPicked(null); }}>{t(lang, "set_remove_btn")}</button>}
            </span>}
          </div>
          <div className={exercise.metric === "reps" ? "steppers two" : "steppers"}>
            {exercise.metric === "reps" && <Stepper lang={lang} label={t(lang, "field_load")} unit={t(lang, "ph_kg")} value={draft.weight ?? 0} inputMode="decimal" onStep={(d) => bump("weight", d * weightStep)} onType={(v) => type("weight", v)} />}
            <Stepper lang={lang} label={fieldLabel} unit={main === "reps" ? t(lang, "ph_reps") : main === "seconds" ? t(lang, "ph_sec") : t(lang, "ph_m")} value={draft[main] ?? 0} inputMode={main === "meters" ? "decimal" : "numeric"} onStep={(d) => bump(main, d * mainStep)} onType={(v) => type(main, v)} />
          </div>
          {rpeOpen || draft.rpe ? <div className="rpe" role="group" aria-label={t(lang, "set_rpe_label")}>
            <span>{t(lang, "set_rpe_label")}</span>
            <div className="chip-row">
              {RPE_CHOICES.map((rpe) => <button type="button" key={rpe} className="chip-button chip-num" aria-pressed={draft.rpe === rpe} onClick={() => setDraft((d) => d ? { ...d, rpe: d.rpe === rpe ? undefined : rpe } : d)}>{rpe}</button>)}
            </div>
          </div> : <button type="button" className="button button-quiet button-small rpe-open" onClick={() => setRpeOpen(true)}>+ {t(lang, "set_rpe_label")}</button>}
          <button type="button" className="button button-primary button-block button-tall" disabled={!(draft[main] ?? 0)} onClick={commit}><Icon name="check" />{t(lang, "set_done_btn")}</button>
        </div>
      )}

      {active !== null && renderLines(active + 1, rows)}
      {allDone && active === null && doneCount > 0 && <p className="all-done"><Icon name="check" size={18} />{t(lang, "exercise_all_sets_done")}</p>}
      <button type="button" className="button button-quiet button-block" onClick={props.onAddSet}><Icon name="plus" size={20} />{t(lang, "train_add_set_btn").replace(/^\+\s*/, "")}</button>
    </section>
  );
}

function Stepper({ lang, label, unit, value, inputMode, onStep, onType }: {
  lang: Lang; label: string; unit: string; value: number; inputMode: "numeric" | "decimal";
  onStep: (direction: -1 | 1) => void; onType: (raw: string) => void;
}) {
  // While typing, the field shows exactly what was typed ("62," on the way to "62,5"); the
  // formatted number comes back on blur.
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (lang === "uk" ? String(value).replace(".", ",") : String(value));
  return (
    <div className="stepper">
      <span className="stepper-label">{label}</span>
      <div className="stepper-body">
        <button type="button" className="stepper-btn" onClick={() => onStep(-1)} aria-label={t(lang, "set_less_aria", { field: label })}><Icon name="minus" /></button>
        <label className="stepper-value">
          <input type="text" inputMode={inputMode} value={shown} aria-label={label} onFocus={(e) => e.currentTarget.select()} onChange={(e) => { setText(e.target.value); onType(e.target.value); }} onBlur={() => setText(null)} />
          <span>{unit}</span>
        </label>
        <button type="button" className="stepper-btn" onClick={() => onStep(1)} aria-label={t(lang, "set_more_aria", { field: label })}><Icon name="plus" /></button>
      </div>
    </div>
  );
}

const setLabel = (w: number, r: number) => `${w > 0 ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(w) : "BW"}×${r}`;
