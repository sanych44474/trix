// One exercise in focus mode: the name, the target, a one-line technique cue, and the sets as a
// table -- set, load, reps, done. A planned set is logged with one tap on its check (its suggested
// numbers are already in the row); tapping the row opens it for editing instead. The row being
// edited keeps its typed numbers in the parent (TrainView), so moving to another exercise and
// back doesn't lose them. Less frequent actions open from the top bar's "more" button.
import { TechniqueFrames } from "./TechniqueFrames";
import { FormCheck } from "../media/FormCheck";
import { lazy, Suspense, useRef, useState, type KeyboardEvent } from "react";
import { musclesForExercise } from "../logic/exerciseMuscles";
import { t, type Lang } from "../i18n";
import type { RestPrefs } from "../logic/rest";
import { isSetFilled, plannedSetsFor, type LoggerExercise, type LoggerSet } from "../logic/logger";
import { Icon } from "../icons";

const REST_CHOICES = [45, 60, 90, 120, 180];
const RPE_CHOICES = [6, 7, 8, 9, 10];

/** The row being edited: its numbers, and the text as typed ("62," on the way to "62,5"). */
export type RowDraft = { row: number; set: LoggerSet; text?: Partial<Record<"weight" | "reps" | "seconds" | "meters", string>> };

const ExerciseMuscles = lazy(() => import("./ExerciseMuscles").then((m) => ({ default: m.ExerciseMuscles })));

export interface FocusExerciseProps {
  lang: Lang;
  sex?: "male" | "female";
  /** The muscle figure is unfolded (kept by the parent, so it stays open across exercises). */
  musclesOpen: boolean;
  onToggleMuscles: () => void;
  exercise: LoggerExercise;
  restSec: number;
  restPrefs: RestPrefs;
  menuOpen: boolean;
  restPrefsOpen: boolean;
  swapOpen: boolean;
  swapChoices: Array<{ id: string; name: string }>;
  info: { technique: string; videoUrl?: string; videoTitle?: string } | null;
  busy: string | null;
  draft: RowDraft | null;
  onDraft: (draft: RowDraft | null) => void;
  onStartRest: (seconds: number, label: string) => void;
  onToggleRestPrefs: () => void;
  onPatchRestPrefs: (patch: Partial<RestPrefs>) => void;
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
  onCloseMenu: () => void;
}

type Main = "reps" | "seconds" | "meters";
const mainField = (metric: LoggerExercise["metric"]): Main => metric === "time" ? "seconds" : metric === "distance" ? "meters" : "reps";
const fmt = (lang: Lang, n: number) => { const s = String(Math.round(n * 100) / 100); return lang === "uk" ? s.replace(".", ",") : s; };

/** What a set should be: the numbers "Repeat last" put in, else today's progression target, else
 *  the plan's numbers. */
export function suggestion(exercise: LoggerExercise, setIndex: number): LoggerSet {
  const repeated = exercise.prefill?.[Math.min(setIndex, exercise.prefill.length - 1)];
  if (repeated) return { ...repeated };
  const planned = plannedSetsFor(exercise);
  const base = planned[Math.min(setIndex, planned.length - 1)] ?? planned[0];
  if (exercise.metric === "reps" && exercise.target) return { ...base, weight: exercise.target.w, reps: exercise.target.r };
  return base;
}

/** The first sentence of the technique note: a cue, not an article. */
function cue(technique: string | undefined): string {
  if (!technique) return "";
  // First sentence. No lookbehind: iOS before 16.4 can't parse it, and a parse error blanks the whole app.
  const flat = technique.replace(/\s+/g, " ").trim();
  const first = flat.match(/^.*?[.!?](?=\s)/)?.[0] ?? flat;
  return first.length > 120 ? `${first.slice(0, 117)}…` : first;
}

export function FocusExercise(props: FocusExerciseProps) {
  const { lang, exercise, restSec, restPrefs, draft } = props;
  const main = mainField(exercise.metric);
  const reps = exercise.metric === "reps";
  const sets = exercise.setsDone ?? [];
  const planned = Math.max(1, exercise.sets || 1);
  const rows = Math.max(planned, sets.length);
  const done = (i: number) => Boolean(sets[i] && isSetFilled(sets[i]));
  const firstOpen = Array.from({ length: rows }, (_, i) => i).find((i) => !done(i));
  const editing = draft && draft.row < rows ? draft : null;
  const [rpeOpen, setRpeOpen] = useState(false);
  const mainInput = useRef<HTMLInputElement>(null);

  const seed = (i: number): LoggerSet => (done(i) ? { ...sets[i] } : { ...suggestion(exercise, i), ...(sets[i]?.weight ? { weight: sets[i].weight } : {}) });
  const commit = (i: number, value: LoggerSet) => {
    if (!(Number(value[main] ?? 0) > 0)) return;
    const newlyDone = !done(i);
    props.onWriteSet(i, value);
    props.onDraft(null);
    setRpeOpen(false);
    // Only a set finished just now starts the rest; fixing an earlier set leaves the running one alone.
    if (restPrefs.auto && newlyDone) props.onStartRest(restSec, t(lang, "train_rest_for", { name: exercise.name, n: i + 1 }));
    window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
  };
  const undo = (i: number) => {
    props.onWriteSet(i, { ...sets[i], reps: 0, ...(exercise.metric === "time" ? { seconds: 0 } : {}), ...(exercise.metric === "distance" ? { meters: 0 } : {}) } as LoggerSet);
    props.onDraft({ row: i, set: seed(i) });
  };
  const type = (field: "weight" | Main, raw: string) => {
    if (!editing) return;
    props.onDraft({ row: editing.row, set: { ...editing.set, [field]: Number(raw.replace(",", ".")) || 0 }, text: { ...editing.text, [field]: raw } });
  };
  // The keyboard's Enter: from the load field it moves to reps, from reps it logs the set -- the
  // same as the check. The inputs are not in a form and say they are not credentials: a weight
  // and a reps field that vanish on "done" read to Android's password manager as a login.
  const onEnter = (field: "weight" | Main) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || !editing) return;
    e.preventDefault();
    if (field === "weight") mainInput.current?.focus();
    else commit(editing.row, editing.set);
  };
  const noAutofill = { autoComplete: "off", autoCorrect: "off", spellCheck: false, "data-lpignore": "true", "data-1p-ignore": "true", "data-form-type": "other" } as const;
  const unitMain = main === "reps" ? "" : main === "seconds" ? t(lang, "ph_sec") : t(lang, "ph_m");
  const mainHead = main === "reps" ? t(lang, "field_reps") : main === "seconds" ? t(lang, "field_seconds") : t(lang, "field_meters");
  const target = exercise.planSets ? `${exercise.planSets}${exercise.planWeight && exercise.planWeight !== "—" ? ` · ${exercise.planWeight}` : ""}` : t(lang, "exercise_sets_line", { n: exercise.sets, detail: reps ? t(lang, "controlled_reps") : t(lang, "measured_effort") });
  const hint = cue(exercise.technique);
  const muscles = musclesForExercise(exercise.name) ?? (exercise.planName ? musclesForExercise(exercise.planName) : null);

  return (
    <section className="focus-ex" aria-labelledby="focus-ex-title">
      <h1 id="focus-ex-title">{exercise.name}</h1>
      <p className="focus-target num">{target}</p>
      {exercise.target && <p className="focus-progress num">{t(lang, "target_last", { set: setLabel(exercise.target.lastW, exercise.target.lastR) })} → <strong>{t(lang, "target_today", { set: setLabel(exercise.target.w, exercise.target.r) })}</strong></p>}
      {exercise.planName && <p className="focus-progress">{t(lang, "swapped_from_note", { name: exercise.planName })}</p>}
      {exercise.note && <p className="focus-note"><Icon name="chat" size={18} /><span><strong>{t(lang, "focus_note_label")}</strong> {exercise.note}</span></p>}
      {muscles && muscles.primary.length > 0 && <Suspense fallback={<div className="focus-muscles" />}>
        <ExerciseMuscles lang={lang} muscles={muscles} sex={props.sex} open={props.musclesOpen} onToggle={props.onToggleMuscles} />
      </Suspense>}
      {(hint || props.info) && <button type="button" className="focus-cue" onClick={props.onOpenInfo} aria-expanded={Boolean(props.info)}>
        <Icon name="info" size={20} /><span>{hint || t(lang, "train_info_btn")}</span>
      </button>}

      {props.menuOpen && (
        <div className="action-sheet" role="menu">
          <button type="button" className="chip-button" onClick={() => { props.onFillPlanned(); props.onCloseMenu(); }}>{t(lang, "train_as_planned_btn")}</button>
          {exercise.last?.length ? <button type="button" className="chip-button" onClick={() => { props.onFillLast(); props.onCloseMenu(); }}>{t(lang, "train_repeat_last_btn")}</button> : null}
          <button type="button" className="chip-button" onClick={props.onOpenSwap}>{props.busy === `swap:${exercise.index}` ? "…" : t(lang, "train_swap_btn")}</button>
          <button type="button" className="chip-button" onClick={() => { props.onStartRest(restSec, exercise.name); props.onCloseMenu(); }}><Icon name="timer" size={18} />{restSec} {t(lang, "ph_sec")}</button>
          <button type="button" className="chip-button" onClick={props.onToggleRestPrefs} aria-expanded={props.restPrefsOpen}>{t(lang, "train_rest_prefs_aria")}</button>
          <button type="button" className="chip-button" onClick={() => props.onMove(-1)}>{t(lang, "train_move_up")}</button>
          <button type="button" className="chip-button" onClick={() => props.onMove(1)}>{t(lang, "train_move_down")}</button>
          <button type="button" className="chip-button danger" onClick={props.onRemove}>{t(lang, "train_delete_btn")}</button>
        </div>
      )}
      {props.restPrefsOpen && (
        <div className="chip-row">
          {REST_CHOICES.map((sec) => <button type="button" key={sec} className="chip-button" aria-pressed={restSec === sec} onClick={() => props.onPickRest(sec)}>{sec} {t(lang, "ph_sec")}</button>)}
          <button type="button" className="chip-button" aria-pressed={restPrefs.auto} onClick={() => props.onPatchRestPrefs({ auto: !restPrefs.auto })}>{t(lang, "train_rest_auto")}</button>
          <button type="button" className="chip-button" aria-pressed={restPrefs.sound} onClick={() => props.onPatchRestPrefs({ sound: !restPrefs.sound })}>{t(lang, "train_rest_sound")}</button>
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

      <div className={reps ? "set-table" : "set-table one"} role="table" aria-label={exercise.name}>
        <div className="set-head" role="row">
          <span role="columnheader">#</span>
          {reps && <span role="columnheader">{t(lang, "field_load")}</span>}
          <span role="columnheader">{mainHead}</span>
          <span role="columnheader" className="sr-only">{t(lang, "set_done_btn")}</span>
        </div>
        {Array.from({ length: rows }, (_, i) => {
          const isEditing = editing?.row === i;
          const isDone = done(i);
          const shown = isDone ? sets[i] : suggestion(exercise, i);
          if (isEditing) {
            const v = editing.set;
            return (
              <div key={i} className="set-row-v2 editing" role="row">
                <span className="set-n">{i + 1}</span>
                {reps && <label className="set-field"><input type="text" inputMode="decimal" name="set-load" enterKeyHint="next" {...noAutofill} onKeyDown={onEnter("weight")} aria-label={t(lang, "field_load")} value={editing.text?.weight ?? fmt(lang, v.weight ?? 0)} onFocus={(e) => e.currentTarget.select()} onChange={(e) => type("weight", e.target.value)} /><span>{t(lang, "ph_kg")}</span></label>}
                <label className="set-field"><input ref={mainInput} type="text" inputMode={main === "meters" ? "decimal" : "numeric"} name={`set-${main}`} enterKeyHint="done" {...noAutofill} onKeyDown={onEnter(main)} aria-label={mainHead} value={editing.text?.[main] ?? fmt(lang, v[main] ?? 0)} onFocus={(e) => e.currentTarget.select()} onChange={(e) => type(main, e.target.value)} />{unitMain && <span>{unitMain}</span>}</label>
                <button type="button" className="set-ok primary" disabled={!(v[main] ?? 0)} onClick={() => commit(i, v)} aria-label={t(lang, "set_done_btn")}><Icon name="check" /></button>
              </div>
            );
          }
          return (
            <div key={i} className={isDone ? "set-row-v2 done" : i === firstOpen ? "set-row-v2 next" : "set-row-v2"} role="row">
              <button type="button" className="set-cells" onClick={() => props.onDraft({ row: i, set: seed(i) })} aria-label={t(lang, "set_edit_aria", { n: i + 1 })}>
                <span className="set-n">{i + 1}</span>
                {reps && <span className="num">{shown.weight ? <>{fmt(lang, shown.weight)}<small>{t(lang, "ph_kg")}</small></> : <small>BW</small>}</span>}
                <span className="num">{fmt(lang, shown[main] ?? 0)}{unitMain && <small>{unitMain}</small>}{isDone && shown.rpe ? <small> · RPE {shown.rpe}</small> : null}</span>
              </button>
              <button type="button" className={isDone ? "set-ok on" : "set-ok"} onClick={() => (isDone ? undo(i) : commit(i, seed(i)))} aria-label={isDone ? t(lang, "set_undo_aria", { n: i + 1 }) : t(lang, "set_done_btn")} aria-pressed={isDone}><Icon name="check" /></button>
            </div>
          );
        })}
      </div>

      {editing && (
        <div className="set-tools">
          {rpeOpen || editing.set.rpe ? (
            <div className="chip-row" role="group" aria-label={t(lang, "set_rpe_label")}>
              {RPE_CHOICES.map((rpe) => <button type="button" key={rpe} className="chip-button chip-num" aria-pressed={editing.set.rpe === rpe} onClick={() => props.onDraft({ ...editing, set: { ...editing.set, rpe: editing.set.rpe === rpe ? undefined : rpe } })}>{rpe}</button>)}
            </div>
          ) : <button type="button" className="button button-quiet button-small" onClick={() => setRpeOpen(true)}>+ {t(lang, "set_rpe_label")}</button>}
          {rows > 1 && <button type="button" className="button button-quiet button-small danger" onClick={() => { props.onRemoveSet(editing.row); props.onDraft(null); }}>{t(lang, "set_remove_btn")}</button>}
        </div>
      )}
      <button type="button" className="button button-quiet button-block add-set" onClick={props.onAddSet}><Icon name="plus" size={20} />{t(lang, "train_add_set_btn").replace(/^\+\s*/, "")}</button>
    </section>
  );
}

const setLabel = (w: number, r: number) => `${w > 0 ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(w) : "BW"}×${r}`;
