import { useEffect, useMemo, useState } from "react";
import { api, ApiError, jsonBody } from "./api";
import type { Dashboard, FoodSearchItem, Nutrition, Plan, WorkoutCopyExercise, WorkoutHistoryItem, WorkoutToday } from "./types";
import { guessLang, t, type Lang } from "./i18n";
import { WorkspaceView } from "./Workspace";
import { OnboardingView } from "./Onboarding";
import { ProfileView } from "./ProfileView";

type View = "today" | "train" | "plan" | "fuel" | "progress" | "role" | "settings";

function navLabel(lang: Lang, view: View): string {
  return t(lang, view === "today" ? "nav_today" : view === "train" ? "nav_train" : view === "plan" ? "nav_plan" : view === "fuel" ? "nav_fuel" : view === "progress" ? "nav_progress" : view === "role" ? "nav_role" : "nav_settings");
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
}

function Card({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "accent" | "muted" }) {
  return <section className={`card card-${tone}`}>{children}</section>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="empty"><span className="empty-mark">—</span><strong>{title}</strong><small>{detail}</small></div>;
}

function ErrorState({ lang, error, retry }: { lang: Lang; error: unknown; retry: () => void }) {
  const message = error instanceof ApiError && error.code === "unauthorized" ? t(lang, "unauthorized_error") : t(lang, "generic_error");
  return <Card tone="muted"><div className="error-state"><strong>{message}</strong><button className="button button-ghost" onClick={retry}>{t(lang, "retry")}</button></div></Card>;
}

function TodayView({ dashboard, lang, onOpen }: { dashboard: Dashboard; lang: Lang; onOpen: (view: View) => void }) {
  const stats = dashboard.todayStats;
  const recovery = dashboard.recovery;
  const workoutCount = dashboard.calendar.logs.filter((log) => log.date === dashboard.today && log.done).length;
  const hasExercises = !!dashboard.logForm?.exercises?.length;
  return <div className="view-stack">
    <div className="eyebrow">{dashboard.today}</div>
    <div className="hero">
      <div><span className="eyebrow hero-eyebrow">{t(lang, "today_hero_eyebrow")}</span><h1>{dashboard.name ? t(lang, "today_greeting", { name: dashboard.name }) : t(lang, "today_ready")}</h1><p>{hasExercises ? t(lang, "today_exercises_waiting", { n: dashboard.logForm!.exercises.length }) : t(lang, "today_momentum")}</p></div>
      <button className="button button-light" onClick={() => onOpen("train")}>{hasExercises ? t(lang, "start_session") : t(lang, "open_training")}</button>
    </div>
    <div className="metric-grid">
      <Metric label={t(lang, "metric_recovery")} value={`${recovery.score}`} detail={recovery.label} />
      <Metric label={t(lang, "metric_streak")} value={t(lang, "streak_weeks", { n: dashboard.gamification?.streak ?? 0 })} detail={t(lang, "level_n", { n: dashboard.gamification?.level ?? 1 })} />
      <Metric label={t(lang, "metric_sessions")} value={`${workoutCount}`} detail={t(lang, "today_detail")} />
    </div>
    <Card>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "readiness_eyebrow")}</span><h2>{recovery.label}</h2></div><span className={`status-dot status-${recovery.score >= 70 ? "good" : recovery.score >= 45 ? "warn" : "bad"}`} /></div>
      {recovery.factors.length ? <ul className="factor-list">{recovery.factors.slice(0, 3).map((factor) => <li key={factor}>{factor}</li>)}</ul> : <p className="muted">{t(lang, "no_recovery_blockers")}</p>}
    </Card>
    {stats && <Card><div className="section-head"><div><span className="eyebrow">{t(lang, "daily_load_eyebrow")}</span><h2>{t(lang, "small_actions_count")}</h2></div><button className="text-button" onClick={() => onOpen("progress")}>{t(lang, "details_arrow")}</button></div><div className="metric-grid compact"><Metric label={t(lang, "metric_water")} value={`${formatNumber(stats.waterMl)} ml`} detail={t(lang, "goal_ml", { n: formatNumber(stats.waterGoal) })} /><Metric label={t(lang, "metric_steps")} value={formatNumber(stats.steps)} detail={t(lang, "goal_n", { n: formatNumber(stats.stepsGoal) })} /></div></Card>}
    <Card tone="accent"><div className="section-head"><div><span className="eyebrow">{t(lang, "nba_eyebrow")}</span><h2>{hasExercises ? t(lang, "nba_log_session") : t(lang, "nba_keep_baseline")}</h2></div><span className="action-arrow">↗</span></div><p>{hasExercises ? t(lang, "nba_evidence") : t(lang, "nba_open_plan")}</p><div className="button-row"><button className="button button-light" onClick={() => onOpen(hasExercises ? "train" : "plan")}>{hasExercises ? t(lang, "log_workout") : t(lang, "review_plan")}</button><button className="button button-outline-light" onClick={() => onOpen("fuel")}>{t(lang, "fuel_btn")}</button></div></Card>
  </div>;
}

// ---- Train view helpers: repeat a past session / log a missed day ----

/** Map a past session's saved sets (from /api/v2/workout/past) into the shape the guided
 * logger edits -- only the first set is editable in this UI (same simplification the existing
 * today-logger already applies), so we carry over the first recorded set per exercise. */
function copyToLoggerExercises(items: WorkoutCopyExercise[]): WorkoutToday["exercises"] {
  return items.map((item, index) => {
    const first = item.sets[0];
    return {
      index,
      name: item.name,
      metric: item.metric,
      sets: item.sets.length || 1,
      ...(first ? { setsDone: [{ weight: first.w, reps: first.r, seconds: first.sec, meters: first.m }] } : {}),
    };
  });
}

function isoWeekday(dateStr: string): number {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  return day === 0 ? 7 : day;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function TrainView({ lang }: { lang: Lang }) {
  const draftKey = "trix:v2:workout-draft";
  const [subview, setSubview] = useState<"today" | "history">("today");
  const [workout, setWorkout] = useState<WorkoutToday | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveNoteDate, setSaveNoteDate] = useState<string | null>(null);
  const [drafted, setDrafted] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [logDate, setLogDate] = useState<string | null>(null); // non-null => saving for a past date, not today
  const [copiedFrom, setCopiedFrom] = useState<string | null>(null); // history date exercises were copied from

  const [history, setHistory] = useState<WorkoutHistoryItem[] | null>(null);
  const [historyError, setHistoryError] = useState<unknown>(null);
  const [historyBusy, setHistoryBusy] = useState<string | null>(null);
  const [missedDate, setMissedDate] = useState("");

  const load = () => {
    setLoading(true); setError(null);
    api<WorkoutToday>("/api/v2/workout/today").then((data) => {
      setLogDate(null); setCopiedFrom(null); setSaved(false); setSaveNoteDate(null);
      try {
        const raw = localStorage.getItem(draftKey);
        const draft = raw ? JSON.parse(raw) as WorkoutToday & { logDate?: string; copiedFrom?: string } : null;
        if (draft?.date === data.date && Array.isArray(draft.exercises)) {
          setWorkout({ ...data, exercises: draft.exercises });
          setLogDate(draft.logDate ?? null);
          setCopiedFrom(draft.copiedFrom ?? null);
          setDrafted(true);
          return;
        }
      } catch { localStorage.removeItem(draftKey); }
      setWorkout(data);
      setDrafted(false);
    }).catch(setError).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const persistDraft = (next: WorkoutToday, nextLogDate: string | null, nextCopiedFrom: string | null) => {
    try { localStorage.setItem(draftKey, JSON.stringify({ ...next, logDate: nextLogDate, copiedFrom: nextCopiedFrom })); setDrafted(true); } catch { /* storage is optional */ }
  };

  const update = (index: number, key: "weight" | "reps" | "seconds" | "meters", value: number) => setWorkout((current) => {
    if (!current) return current;
    const next = { ...current, exercises: current.exercises.map((exercise) => exercise.index === index ? ({ ...exercise, setsDone: [{ ...(exercise.setsDone?.[0] ?? { weight: 0, reps: 0 }), [key]: value }] }) : exercise) };
    persistDraft(next, logDate, copiedFrom);
    return next;
  });

  const loadHistory = () => {
    setHistoryError(null);
    api<{ logs: WorkoutHistoryItem[] }>("/api/v2/workout/history").then((data) => setHistory(data.logs)).catch(setHistoryError);
  };
  useEffect(() => { if (subview === "history" && history === null) loadHistory(); }, [subview, history]);

  const todayDate = workout?.date ?? isoDate(new Date());
  const minMissedDate = isoDate(new Date(Date.parse(`${todayDate}T00:00:00Z`) - 14 * 86_400_000));

  const repeatToday = async (date: string) => {
    if (!workout) return;
    setHistoryBusy(`repeat:${date}`);
    try {
      const data = await api<{ exercises: WorkoutCopyExercise[] }>(`/api/v2/workout/past?date=${date}`);
      const exercises = copyToLoggerExercises(data.exercises);
      const next = { ...workout, exercises };
      setWorkout(next);
      setLogDate(null);
      setCopiedFrom(date);
      persistDraft(next, null, date);
      setSubview("today");
    } catch (err) { setHistoryError(err); } finally { setHistoryBusy(null); }
  };

  const startMissedBlank = async (date: string) => {
    setHistoryBusy(`blank:${date}`);
    try {
      const data = await api<WorkoutToday>(`/api/v2/workout/today?date=${date}`);
      setWorkout(data);
      setLogDate(date);
      setCopiedFrom(null);
      persistDraft(data, date, null);
      setSubview("today");
    } catch (err) { setHistoryError(err); } finally { setHistoryBusy(null); }
  };

  const startMissedFromHistory = async (targetDate: string, sourceDate: string) => {
    setHistoryBusy(`fill:${sourceDate}`);
    try {
      const data = await api<{ exercises: WorkoutCopyExercise[] }>(`/api/v2/workout/past?date=${sourceDate}`);
      const exercises = copyToLoggerExercises(data.exercises);
      const next: WorkoutToday = { date: targetDate, weekday: isoWeekday(targetDate) as WorkoutToday["weekday"], exercises };
      setWorkout(next);
      setLogDate(targetDate);
      setCopiedFrom(sourceDate);
      persistDraft(next, targetDate, sourceDate);
      setSubview("today");
    } catch (err) { setHistoryError(err); } finally { setHistoryBusy(null); }
  };

  const backToToday = () => { localStorage.removeItem(draftKey); load(); };

  const save = async () => {
    if (!workout) return;
    setSaving(true); setSaved(false);
    const targetDate = logDate;
    try {
      await api("/api/v2/workout/save", { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({ entries: workout.exercises.filter((e) => e.setsDone?.length).map((e) => ({ name: e.name, setsDone: e.setsDone })), ...(targetDate ? { date: targetDate } : {}) }) });
      localStorage.removeItem(draftKey); setDrafted(false);
      setSaved(true); setSaveNoteDate(targetDate);
      window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
      if (targetDate) { setHistory(null); load(); }
    } catch (err) { setError(err); } finally { setSaving(false); }
  };

  if (loading) return <Loading />;
  if (error) return <ErrorState lang={lang} error={error} retry={load} />;

  const tabs = <div className="button-row">
    <button className={subview === "today" ? "button button-primary" : "button button-ghost"} onClick={() => setSubview("today")}>{t(lang, "train_tab_today")}</button>
    <button className={subview === "history" ? "button button-primary" : "button button-ghost"} onClick={() => setSubview("history")}>{t(lang, "train_tab_history")}</button>
  </div>;

  if (subview === "history") {
    return <div className="view-stack">
      <div className="eyebrow">{t(lang, "history_eyebrow")}</div>
      <div className="page-title"><h1>{t(lang, "history_title")}</h1></div>
      {tabs}
      {historyError !== null && <ErrorState lang={lang} error={historyError} retry={loadHistory} />}
      {historyError === null && history === null && <Loading />}
      {historyError === null && history !== null && (history.length === 0
        ? <Empty title={t(lang, "history_empty_title")} detail={t(lang, "history_empty_detail")} />
        : <div className="exercise-list">{history.map((item) => <Card key={item.date}>
            <div className="exercise-head"><div><h2>{item.date}</h2></div><span className="tag">{t(lang, "history_row_exercises", { n: item.n })}</span></div>
            <p className="muted">{item.title}</p>
            <div className="button-row">
              <button className="button button-primary" disabled={historyBusy !== null} onClick={() => void repeatToday(item.date)}>{historyBusy === `repeat:${item.date}` ? t(lang, "saving_ellipsis") : t(lang, "repeat_btn")}</button>
              {item.date >= minMissedDate && item.date < todayDate && <button className="button button-ghost" disabled={historyBusy !== null} onClick={() => setMissedDate(item.date)}>{t(lang, "log_missed_btn")}</button>}
            </div>
          </Card>)}</div>)}
      <Card tone="muted">
        <div className="section-head"><div><span className="eyebrow">{t(lang, "log_missed_eyebrow")}</span><h2>{t(lang, "log_missed_title")}</h2></div></div>
        <p className="muted">{t(lang, "log_missed_detail")}</p>
        <div className="input-row">
          <label className="form-field"><span>{t(lang, "pick_date_label")}</span><input type="date" min={minMissedDate} max={todayDate} value={missedDate} onChange={(event) => setMissedDate(event.target.value)} /></label>
        </div>
        {missedDate && <div className="button-row">
          <button className="button button-primary" disabled={historyBusy !== null} onClick={() => void startMissedBlank(missedDate)}>{historyBusy === `blank:${missedDate}` ? t(lang, "saving_ellipsis") : t(lang, "start_blank_btn")}</button>
          {(history ?? []).filter((item) => item.date !== missedDate).slice(0, 3).map((item) => <button key={item.date} className="button button-ghost" disabled={historyBusy !== null} onClick={() => void startMissedFromHistory(missedDate, item.date)}>{historyBusy === `fill:${item.date}` ? t(lang, "saving_ellipsis") : `${t(lang, "use_these_exercises_btn")} (${item.date})`}</button>)}
        </div>}
      </Card>
    </div>;
  }

  if (!workout?.exercises?.length) return <div className="view-stack">{tabs}<Empty title={t(lang, "rest_day_title")} detail={t(lang, "rest_day_detail")} /></div>;

  return <div className="view-stack">
    <div className="eyebrow">{t(lang, "guided_logger_eyebrow", { date: logDate ?? workout.date })}</div>
    <div className="page-title"><h1>{t(lang, "training_session_title")}</h1><span>{t(lang, "moves_count", { n: workout.exercises.length })}</span></div>
    {tabs}
    {(logDate || copiedFrom) && <div className="button-row"><button className="text-button" onClick={backToToday}>{t(lang, "back_to_today")}</button></div>}
    {saved && <div className="save-note">{saveNoteDate ? t(lang, "session_saved_for_date", { date: saveNoteDate }) : t(lang, "session_saved")}</div>}
    {logDate && !saved && <div className="draft-note">{t(lang, "logging_for_date_note", { date: logDate })}</div>}
    {copiedFrom && !logDate && !saved && <div className="draft-note">{t(lang, "repeated_note", { date: copiedFrom })}</div>}
    {drafted && <div className="draft-note">{t(lang, "draft_saved_note")}</div>}
    <div className="exercise-list">{workout.exercises.map((exercise) => {
      const set = exercise.setsDone?.[0] ?? { weight: 0, reps: 0 };
      const metricFields = exercise.metric === "reps"
        ? <><label><span>{t(lang, "field_load")}</span><input type="number" inputMode="decimal" value={set.weight || ""} placeholder={t(lang, "ph_kg")} onChange={(event) => update(exercise.index, "weight", Number(event.target.value))} /></label><label><span>{t(lang, "field_reps")}</span><input type="number" inputMode="numeric" value={set.reps || ""} placeholder={t(lang, "ph_reps")} onChange={(event) => update(exercise.index, "reps", Number(event.target.value))} /></label></>
        : exercise.metric === "time"
        ? <label><span>{t(lang, "field_seconds")}</span><input type="number" inputMode="numeric" value={set.seconds || ""} placeholder={t(lang, "ph_sec")} onChange={(event) => update(exercise.index, "seconds", Number(event.target.value))} /></label>
        : <label><span>{t(lang, "field_meters")}</span><input type="number" inputMode="decimal" value={set.meters || ""} placeholder={t(lang, "ph_m")} onChange={(event) => update(exercise.index, "meters", Number(event.target.value))} /></label>;
      return <Card key={`${exercise.index}-${exercise.name}`}>
        <div className="exercise-head"><div><span className="exercise-index">{String(exercise.index + 1).padStart(2, "0")}</span><h2>{exercise.name}</h2></div><span className="tag">{t(lang, exercise.metric === "reps" ? "metric_tag_reps" : exercise.metric === "time" ? "metric_tag_time" : "metric_tag_distance")}</span></div>
        <p className="muted">{t(lang, "exercise_sets_line", { n: exercise.sets, detail: exercise.metric === "reps" ? t(lang, "controlled_reps") : t(lang, "measured_effort") })}</p>
        <div className="input-row">{metricFields}</div>
      </Card>;
    })}</div>
    <button className="button button-primary button-wide" onClick={save} disabled={saving}>{saving ? t(lang, "saving_ellipsis") : logDate ? t(lang, "save_for_date", { date: logDate }) : t(lang, "save_session")}</button>
  </div>;
}

function PlanView({ lang }: { lang: Lang }) {
  const [plan, setPlan] = useState<Plan | null>(null); const [error, setError] = useState<unknown>(null); const [drafts, setDrafts] = useState<Record<string, string>>({}); const [saving, setSaving] = useState<string | null>(null); const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => { api<Plan>("/api/v2/plan").then(setPlan).catch(setError); }, []);
  const edit = async (weekday: number, index: number, action: "weight" | "sets", value: string, expectName: string) => {
    if (!plan || !value.trim()) return;
    const key = `${weekday}:${index}:${action}`;
    setSaving(key); setSaved(null); setError(null);
    try {
      const result = await api<{ ok: true; days: Plan["days"]; version: string }>("/api/v2/plan", { method: "POST", headers: { "If-Match": `"${plan.version}"` }, idempotencyKey: crypto.randomUUID(), body: jsonBody({ weekday, index, action, value, expectName }) });
      setPlan({ ...plan, days: result.days, version: result.version }); setSaved(key);
    } catch (err) { setError(err); }
    finally { setSaving(null); }
  };
  if (error) return <ErrorState lang={lang} error={error} retry={() => window.location.reload()} />;
  if (!plan) return <Loading />;
  if (!plan.days.length) return <Empty title={t(lang, "no_plan_title")} detail={t(lang, "no_plan_detail")} />;
  return <div className="view-stack"><div className="eyebrow">{t(lang, "plan_eyebrow")}</div><div className="page-title"><h1>{t(lang, "plan_owner_title", { name: plan.owner.name })}</h1><span>{t(lang, "days_count", { n: plan.days.length })}</span></div>{saved && <div className="save-note">{t(lang, "plan_updated")}</div>}{plan.days.map((day) => <Card key={day.weekday}><div className="section-head"><div><span className="eyebrow">{t(lang, "day_label", { n: day.weekday })}</span><h2>{day.name}</h2></div><span className="tag">{day.muscleGroup}</span></div><div className="plan-list">{day.exercises.map((exercise) => { const weightKey = `${day.weekday}:${exercise.index}:weight`; const setsKey = `${day.weekday}:${exercise.index}:sets`; return <div className="plan-row plan-row-edit" key={`${day.weekday}-${exercise.index}`}><span className="exercise-index">{String(exercise.index + 1).padStart(2, "0")}</span><div><strong>{exercise.name}</strong><small>{exercise.sets} · {exercise.startWeight}</small><div className="plan-edit-fields"><input aria-label={t(lang, "weight_field_aria", { name: exercise.name })} value={drafts[weightKey] ?? exercise.startWeight} onChange={(event) => setDrafts((current) => ({ ...current, [weightKey]: event.target.value }))} /><button className="button button-ghost" disabled={saving === weightKey} onClick={() => void edit(day.weekday, exercise.index, "weight", drafts[weightKey] ?? exercise.startWeight, exercise.name)}>{saving === weightKey ? "…" : saved === weightKey ? t(lang, "saved_label") : t(lang, "weight_label")}</button><input aria-label={t(lang, "sets_field_aria", { name: exercise.name })} value={drafts[setsKey] ?? exercise.sets} onChange={(event) => setDrafts((current) => ({ ...current, [setsKey]: event.target.value }))} /><button className="button button-ghost" disabled={saving === setsKey} onClick={() => void edit(day.weekday, exercise.index, "sets", drafts[setsKey] ?? exercise.sets, exercise.name)}>{saving === setsKey ? "…" : t(lang, "sets_label")}</button></div></div></div>; })}</div></Card>)}</div>;
}

function FuelView({ lang }: { lang: Lang }) {
  const [nutrition, setNutrition] = useState<Nutrition | null>(null); const [error, setError] = useState<unknown>(null); const [text, setText] = useState(""); const [search, setSearch] = useState(""); const [barcode, setBarcode] = useState(""); const [results, setResults] = useState<FoodSearchItem[]>([]); const [grams, setGrams] = useState("100"); const [saving, setSaving] = useState(false); const [searching, setSearching] = useState(false); const [selected, setSelected] = useState<FoodSearchItem | null>(null);
  const load = () => { setError(null); api<Nutrition>("/api/v2/nutrition").then(setNutrition).catch(setError); }; useEffect(load, []);
  const log = async () => { if (!text.trim()) return; setSaving(true); try { await api("/api/v2/log", { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({ kind: "food", text: text.trim() }) }); setText(""); load(); } catch (err) { setError(err); } finally { setSaving(false); } };
  const searchFood = async (action: "dbsearch" | "barcode") => { const q = action === "dbsearch" ? search.trim() : barcode.replace(/\D/g, ""); if (!q || q.length < 2) return; setSearching(true); try { const result = await api<{ items: FoodSearchItem[] }>("/api/v2/nutrition", { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody(action === "dbsearch" ? { action, q } : { action, code: q }) }); setResults(result.items ?? []); } catch (err) { setError(err); } finally { setSearching(false); } };
  const addFood = async (item: FoodSearchItem) => { const amount = Number(grams); if (!Number.isFinite(amount) || amount < 1 || amount > 3000) return; setSaving(true); try { await api("/api/v2/nutrition", { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({ action: "dbadd", name: item.name, grams: amount, per100: item.per100 }) }); setSelected(null); setResults([]); load(); } catch (err) { setError(err); } finally { setSaving(false); } };
  const readd = async (ri: number) => { setSaving(true); try { await api("/api/v2/nutrition", { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({ action: "readd", ri }) }); load(); } catch (err) { setError(err); } finally { setSaving(false); } };
  if (error) return <ErrorState lang={lang} error={error} retry={load} />; if (!nutrition) return <Loading />;
  return <div className="view-stack"><div className="eyebrow">{t(lang, "fuel_eyebrow", { date: nutrition.date })}</div><div className="page-title"><h1>{t(lang, "eat_intent_title")}</h1><span>{t(lang, "kcal_value", { n: formatNumber(nutrition.totals.kcal) })}</span></div><Card tone="accent"><div className="macro-grid"><Metric label={t(lang, "metric_calories")} value={`${formatNumber(nutrition.totals.kcal)}`} detail={nutrition.targets ? t(lang, "of_n", { n: formatNumber(nutrition.targets.calories) }) : undefined} /><Metric label={t(lang, "metric_protein")} value={`${formatNumber(nutrition.totals.protein)} g`} detail={nutrition.targets ? t(lang, "of_n_g", { n: formatNumber(nutrition.targets.protein) }) : undefined} /></div></Card><Card><div className="section-head"><div><span className="eyebrow">{t(lang, "ai_quick_log_eyebrow")}</span><h2>{t(lang, "describe_meal_title")}</h2></div></div><div className="input-row"><input value={text} placeholder={t(lang, "meal_input_ph")} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void log(); }} /><button className="button button-primary" onClick={() => void log()} disabled={saving}>{saving ? "…" : t(lang, "log_btn")}</button></div></Card><Card><div className="section-head"><div><span className="eyebrow">{t(lang, "food_search_eyebrow")}</span><h2>{t(lang, "measured_portions_title")}</h2></div></div><div className="input-row"><input value={search} placeholder={t(lang, "search_input_ph")} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchFood("dbsearch"); }} /><button className="button button-ghost" onClick={() => void searchFood("dbsearch")} disabled={searching}>{searching ? "…" : t(lang, "search_btn")}</button></div><div className="input-row"><input value={barcode} inputMode="numeric" placeholder={t(lang, "barcode_ph")} onChange={(event) => setBarcode(event.target.value)} /><button className="button button-ghost" onClick={() => void searchFood("barcode")} disabled={searching}>{t(lang, "scan_code_btn")}</button></div>{results.length > 0 && <div className="food-results">{results.map((item) => <button className="food-result" key={`${item.name}-${item.brand ?? ""}`} onClick={() => setSelected(item)}><span><strong>{item.name}</strong><small>{item.brand || t(lang, "per_100g")}</small></span><span>{item.per100.kcal} kcal</span></button>)}</div>}{selected && <div className="portion-editor"><strong>{selected.name}</strong><div className="input-row"><input type="number" min="1" max="3000" value={grams} onChange={(event) => setGrams(event.target.value)} /><span className="muted">{t(lang, "grams_unit")}</span><button className="button button-primary" onClick={() => void addFood(selected)} disabled={saving}>{t(lang, "add_portion_btn")}</button></div></div>}</Card>{nutrition.recent?.length ? <Card><div className="section-head"><div><span className="eyebrow">{t(lang, "recent_eyebrow")}</span><h2>{t(lang, "repeat_meal_title")}</h2></div></div><div className="food-results">{nutrition.recent.slice(0, 6).map((item) => <button className="food-result" key={item.ri} onClick={() => void readd(item.ri)} disabled={saving}><span><strong>{item.desc}</strong><small>{t(lang, "protein_short", { n: formatNumber(item.protein) })}</small></span><span>{formatNumber(item.kcal)} kcal</span></button>)}</div></Card> : null}{nutrition.meals.length ? <Card><div className="section-head"><div><span className="eyebrow">{t(lang, "today_eyebrow")}</span><h2>{t(lang, "logged_meals_title")}</h2></div></div><div className="meal-list">{nutrition.meals.map((meal) => <div className="meal-row" key={meal.index}><div><strong>{meal.desc}</strong><small>{meal.grams ? t(lang, "grams_prefix", { n: meal.grams }) : ""}{t(lang, "macro_line", { p: formatNumber(meal.protein), f: formatNumber(meal.fats), c: formatNumber(meal.carbs) })}</small></div><span>{formatNumber(meal.kcal)}</span></div>)}</div></Card> : <Empty title={t(lang, "nothing_logged_title")} detail={t(lang, "nothing_logged_detail")} />}{nutrition.mealPlan?.days?.length ? <Card><div className="section-head"><div><span className="eyebrow">{t(lang, "meal_plan_eyebrow")}</span><h2>{t(lang, "use_plan_compass_title")}</h2></div></div><p className="muted">{t(lang, "meal_plan_detail", { n: nutrition.mealPlan.days.length })}</p></Card> : null}</div>;
}

function ProgressView({ dashboard, lang }: { dashboard: Dashboard; lang: Lang }) {
  const latest = dashboard.weight.points.at(-1); const first = dashboard.weight.points[0];
  return <div className="view-stack"><div className="eyebrow">{t(lang, "progress_eyebrow")}</div><div className="page-title"><h1>{t(lang, "progress_title")}</h1><span>{dashboard.today}</span></div><div className="metric-grid"><Metric label={t(lang, "metric_current_weight")} value={latest ? `${formatNumber(latest.kg)} kg` : "—"} detail={dashboard.weight.goal ? t(lang, "goal_kg", { n: formatNumber(dashboard.weight.goal) }) : t(lang, "add_weighin")} /><Metric label={t(lang, "metric_recovery")} value={`${dashboard.recovery.score}`} detail={dashboard.recovery.label} /><Metric label={t(lang, "metric_conditioning")} value={t(lang, "min_value", { n: dashboard.conditioning.minutes })} detail={t(lang, "zone_load", { zone: dashboard.conditioning.zone })} /></div><Card><div className="section-head"><div><span className="eyebrow">{t(lang, "weight_trend_eyebrow")}</span><h2>{dashboard.weight.projection?.reached ? t(lang, "goal_reached") : dashboard.weight.projection?.onTrack ? t(lang, "on_track") : t(lang, "keep_observing")}</h2></div></div>{dashboard.weight.points.length > 1 ? <div className="sparkline">{dashboard.weight.points.map((point, index) => <span key={point.date} style={{ left: `${(index / (dashboard.weight.points.length - 1)) * 100}%`, bottom: `${Math.max(4, Math.min(92, ((point.kg - (first?.kg ?? point.kg) + 5) / 10) * 100))}%` }} title={`${point.date}: ${point.kg} kg`} />)}</div> : <Empty title={t(lang, "build_baseline_title")} detail={t(lang, "build_baseline_detail")} />}</Card><Card><div className="section-head"><div><span className="eyebrow">{t(lang, "weekly_volume_eyebrow")}</span><h2>{t(lang, "strength_load_title")}</h2></div><button className="text-button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>{t(lang, "top_btn")}</button></div>{dashboard.volume.length ? <div className="volume-list">{dashboard.volume.map((item) => <div className="volume-row" key={item.group}><div><strong>{item.group}</strong><small>{t(lang, "volume_row_detail", { n: item.sets, zone: item.zone })}</small></div><div className="bar"><span style={{ width: `${Math.min(100, (item.sets / Math.max(item.mav, 1)) * 100)}%` }} /></div></div>)}</div> : <Empty title={t(lang, "no_volume_title")} detail={t(lang, "no_volume_detail")} />}</Card></div>;
}

function RoleView({ dashboard, lang }: { dashboard: Dashboard; lang: Lang }) {
  return <WorkspaceView dashboard={dashboard} lang={lang} />;
}

function Loading() { return <div className="view-stack"><div className="skeleton skeleton-hero" /><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>; }

export function App() {
  const [lang, setLang] = useState<Lang>(() => guessLang());
  const [view, setView] = useState<View>("today"); const [dashboard, setDashboard] = useState<Dashboard | null>(null); const [error, setError] = useState<unknown>(null); const [loading, setLoading] = useState(true); const [onboardingPending, setOnboardingPending] = useState(false);
  const loadDashboard = () => { setLoading(true); setError(null); api<Dashboard>("/api/v2/dashboard").then((data) => { setDashboard(data); setLang(data.lang); }).catch(setError).finally(() => setLoading(false)); };
  useEffect(() => { loadDashboard(); }, []);
  useEffect(() => { const back = window.Telegram?.WebApp.BackButton; if (!back) return; if (view === "today") { back.hide(); return; } const handler = () => setView("today"); back.show(); back.onClick(handler); return () => back.offClick(handler); }, [view]);
  const navigation = useMemo(() => dashboard?.viewer.role === "trainer" || dashboard?.viewer.role === "solo" || dashboard?.viewer.role === "client" ? ["today", "train", "plan", "fuel", "progress", "role"] as View[] : ["today", "role"] as View[], [dashboard?.viewer.role]);
  if (loading && !dashboard) return <main className="app-shell"><Loading /></main>;
  if (error && !dashboard) return <main className="app-shell"><ErrorState lang={lang} error={error} retry={loadDashboard} /></main>;
  if (!dashboard) return null;
  if (!dashboard.viewer.onboarded && onboardingPending) return <main className="app-shell"><header className="topbar"><div className="brand-mark">T</div><div><span className="eyebrow">{t(lang, "brand_title")}</span><strong>{t(lang, "brand_subtitle")}</strong></div></header><div className="view-stack"><div className="hero"><div><span className="eyebrow hero-eyebrow">{t(lang, "ob_pending_eyebrow")}</span><h1>{t(lang, "ob_pending_title")}</h1><p>{t(lang, "ob_pending_body")}</p></div><button className="button button-light" onClick={loadDashboard}>{t(lang, "check_status")}</button></div><Card><div className="section-head"><div><span className="eyebrow">{t(lang, "ob_pending_next_eyebrow")}</span><h2>{t(lang, "ob_pending_next_title")}</h2></div></div><p className="muted">{t(lang, "ob_pending_next_body")}</p></Card></div></main>;
  if (!dashboard.viewer.onboarded) return <main className="app-shell"><header className="topbar"><div className="brand-mark">T</div><div><span className="eyebrow">{t(lang, "brand_title")}</span><strong>{t(lang, "brand_subtitle")}</strong></div></header><OnboardingView lang={lang} onComplete={() => setOnboardingPending(true)} /></main>;
  return <main className="app-shell"><header className="topbar"><div className="brand-mark">T</div><div><span className="eyebrow">{t(lang, "brand_title")}</span><strong>{t(lang, "brand_subtitle")}</strong></div><button className="icon-button" onClick={loadDashboard} aria-label={t(lang, "refresh_aria")}>↻</button><button className="icon-button" onClick={() => setView("settings")} aria-label={t(lang, "settings_aria")}>⚙</button></header><div className="content">{view === "today" && <TodayView dashboard={dashboard} lang={lang} onOpen={setView} />}{view === "train" && <TrainView lang={lang} />}{view === "plan" && <PlanView lang={lang} />}{view === "fuel" && <FuelView lang={lang} />}{view === "progress" && <ProgressView dashboard={dashboard} lang={lang} />}{view === "role" && <RoleView dashboard={dashboard} lang={lang} />}{view === "settings" && <ProfileView lang={lang} onBack={() => setView("today")} />}</div><nav className="bottom-nav" aria-label={t(lang, "nav_aria")}>{navigation.map((item) => <button key={item} className={view === item ? "nav-item active" : "nav-item"} onClick={() => setView(item)}><span className="nav-icon">{item === "today" ? "⌂" : item === "train" ? "◈" : item === "plan" ? "▤" : item === "fuel" ? "◌" : item === "progress" ? "↗" : "◎"}</span><span>{navLabel(lang, item)}</span></button>)}</nav></main>;
}
