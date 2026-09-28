import { TechniqueFrames } from "./TechniqueFrames";
import { t, type Lang } from "../i18n";
import { restMetricKey, type RestPrefs } from "../logic/rest";
import { isExerciseFilled, type LoggerExercise, type LoggerSet } from "../logic/logger";
import { Card } from "./ui";

export type SetField = "weight" | "reps" | "seconds" | "meters" | "rpe";

const REST_CHOICES = [45, 60, 90, 120, 180];
const RPE_CHOICES = [6, 7, 8, 9, 10];

export interface ExerciseCardProps {
  lang: Lang;
  exercise: LoggerExercise;
  restSec: number;
  restPrefs: RestPrefs;
  restPrefsOpen: boolean;
  swapOpen: boolean;
  swapChoices: Array<{ id: string; name: string }>;
  info: { technique: string; videoUrl?: string; videoTitle?: string } | null; // non-null only while this card's info is open
  busy: string | null;
  onStartRest: (seconds: number, label: string) => void;
  onToggleRestPrefs: () => void;
  onPatchRestPrefs: (patch: Partial<RestPrefs>) => void;
  onFillPlanned: () => void;
  onFillLast: () => void;
  onOpenSwap: () => void;
  onApplySwap: (name: string) => void;
  onOpenInfo: () => void;
  onUpdateSet: (setIndex: number, field: SetField, value: number) => void;
  onAddSet: () => void;
  onRemoveSet: (setIndex: number) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}

function metricTagKey(metric: LoggerExercise["metric"]) {
  return metric === "reps" ? "metric_tag_reps" : metric === "time" ? "metric_tag_time" : "metric_tag_distance";
}

export function ExerciseCard(props: ExerciseCardProps) {
  const { lang, exercise, restSec, restPrefs } = props;
  const sets = exercise.setsDone ?? [];
  const completed = isExerciseFilled(exercise);
  const prefKey = restMetricKey(exercise.metric);
  return (
    <Card tone={completed ? "muted" : "default"}>
      <div className="exercise-head">
        <div>
          <span className="exercise-index">{String(exercise.index + 1).padStart(2, "0")}</span>
          <h2>{completed ? "✓ " : ""}{exercise.name}</h2>
          {exercise.planName && <small className="muted swap-note">{t(lang, "swapped_from_note", { name: exercise.planName })}</small>}
        </div>
        <div className="button-row">
          <span className="tag">{t(lang, metricTagKey(exercise.metric))}</span>
          <button type="button" className="text-button" onClick={() => props.onStartRest(restSec, exercise.name)}>{t(lang, "train_start_rest_btn", { sec: restSec })}</button>
          <button type="button" className="text-button" aria-label={t(lang, "train_rest_prefs_aria")} onClick={props.onToggleRestPrefs}>⚙</button>
        </div>
      </div>
      {props.restPrefsOpen && (
        <div className="rest-prefs">
          {REST_CHOICES.map((sec) => (
            <button type="button" key={sec} className={restPrefs[prefKey] === sec ? "rest-chip selected" : "rest-chip"} onClick={() => props.onPatchRestPrefs({ [prefKey]: sec })}>{sec}s</button>
          ))}
          <button type="button" className={restPrefs.auto ? "rest-chip selected" : "rest-chip"} onClick={() => props.onPatchRestPrefs({ auto: !restPrefs.auto })}>{t(lang, "train_rest_auto")}</button>
          <button type="button" className={restPrefs.sound ? "rest-chip selected" : "rest-chip"} onClick={() => props.onPatchRestPrefs({ sound: !restPrefs.sound })}>{t(lang, "train_rest_sound")}</button>
          {exercise.restSec != null && <small className="muted">{t(lang, "train_rest_plan_wins")}</small>}
        </div>
      )}
      <p className="muted">
        {exercise.planSets
          ? `${exercise.planSets}${exercise.planWeight ? ` · ${exercise.planWeight}` : ""}`
          : t(lang, "exercise_sets_line", { n: exercise.sets, detail: exercise.metric === "reps" ? t(lang, "controlled_reps") : t(lang, "measured_effort") })}
      </p>
      <div className="button-row exercise-actions">
        <button className="text-button" onClick={props.onFillPlanned}>{t(lang, "train_as_planned_btn")}</button>
        {exercise.last?.length ? <button className="text-button" onClick={props.onFillLast}>{t(lang, "train_repeat_last_btn")}</button> : null}
        <button className="text-button" onClick={props.onOpenSwap}>{props.busy === `swap:${exercise.index}` ? "…" : t(lang, "train_swap_btn")}</button>
        <button className="text-button" onClick={props.onOpenInfo}>{props.busy === `info:${exercise.index}` ? "…" : t(lang, "train_info_btn")}</button>
      </div>
      {props.swapOpen && (
        <div className="choice-list">
          {props.swapChoices.length
            ? props.swapChoices.map((choice) => <button className="choice-button" key={choice.id} onClick={() => props.onApplySwap(choice.name)}>{choice.name}</button>)
            : <span className="muted">{t(lang, "train_no_swaps")}</span>}
        </div>
      )}
      {props.info && (
        <div className="info-box">
          <TechniqueFrames lang={lang} name={exercise.name} canonicalName={exercise.canonicalName} />
          <p>{props.info.technique || t(lang, "train_no_info")}</p>
          {props.info.videoUrl && <a href={props.info.videoUrl} target="_blank" rel="noreferrer">{props.info.videoTitle || t(lang, "train_watch_video")}</a>}
        </div>
      )}
      <div className="set-list">
        {sets.map((set, setIndex) => (
          <SetRow
            key={setIndex}
            lang={lang}
            metric={exercise.metric}
            set={set}
            setIndex={setIndex}
            onChange={(field, value) => props.onUpdateSet(setIndex, field, value)}
            onFinished={() => { if (restPrefs.auto) props.onStartRest(restSec, t(lang, "train_rest_for", { name: exercise.name, n: setIndex + 1 })); }}
            onRemove={() => props.onRemoveSet(setIndex)}
          />
        ))}
      </div>
      <div className="button-row exercise-footer">
        <button className="button button-ghost" onClick={props.onAddSet}>{t(lang, "train_add_set_btn")}</button>
        <button className="text-button" onClick={() => props.onMove(-1)}>↑</button>
        <button className="text-button" onClick={() => props.onMove(1)}>↓</button>
        <button className="text-button danger-button" onClick={props.onRemove}>{t(lang, "train_delete_btn")}</button>
      </div>
    </Card>
  );
}

function SetRow({ lang, metric, set, setIndex, onChange, onFinished, onRemove }: {
  lang: Lang;
  metric: LoggerExercise["metric"];
  set: LoggerSet;
  setIndex: number;
  onChange: (field: SetField, value: number) => void;
  onFinished: () => void; // the set's main number was entered -- the auto-rest trigger
  onRemove: () => void;
}) {
  const main = (field: "reps" | "seconds" | "meters", label: string, placeholder: string, inputMode: "numeric" | "decimal") => (
    <label>
      <span>{label}</span>
      <input
        type="number"
        inputMode={inputMode}
        value={set[field] || ""}
        placeholder={placeholder}
        onChange={(event) => onChange(field, Number(event.target.value))}
        onBlur={(event) => { if (Number(event.target.value) > 0) onFinished(); }}
      />
    </label>
  );
  return (
    <div className="set-row">
      <span className="set-number">{setIndex + 1}</span>
      {metric === "reps" ? (
        <>
          <label>
            <span>{t(lang, "field_load")}</span>
            <input type="number" inputMode="decimal" value={set.weight || ""} placeholder={t(lang, "ph_kg")} onChange={(event) => onChange("weight", Number(event.target.value))} />
          </label>
          {main("reps", t(lang, "field_reps"), t(lang, "ph_reps"), "numeric")}
        </>
      ) : metric === "time"
        ? main("seconds", t(lang, "field_seconds"), t(lang, "ph_sec"), "numeric")
        : main("meters", t(lang, "field_meters"), t(lang, "ph_m"), "decimal")}
      <div className="rpe-chips">
        {RPE_CHOICES.map((rpe) => <button type="button" className={set.rpe === rpe ? "rpe-chip selected" : "rpe-chip"} key={rpe} onClick={() => onChange("rpe", rpe)}>{rpe}</button>)}
      </div>
      <button type="button" className="icon-button set-remove" onClick={onRemove} aria-label={t(lang, "train_remove_set_aria")}>×</button>
    </div>
  );
}
