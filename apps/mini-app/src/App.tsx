import { useEffect, useMemo, useState } from "react";
import { api, ApiError, jsonBody } from "./api";
import type { Dashboard, FoodSearchItem, Nutrition, Plan, WorkoutToday } from "./types";
import { WorkspaceView } from "./Workspace";
import { OnboardingView } from "./Onboarding";
import { ProfileView } from "./ProfileView";

type View = "today" | "train" | "plan" | "fuel" | "progress" | "role" | "settings";

const labels: Record<View, string> = {
  today: "Today",
  train: "Train",
  plan: "Plan",
  fuel: "Fuel",
  progress: "Progress",
  role: "Workspace",
  settings: "Settings",
};

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

function ErrorState({ error, retry }: { error: unknown; retry: () => void }) {
  const message = error instanceof ApiError && error.code === "unauthorized" ? "Open this page from Telegram to continue." : "Something went wrong. Try again.";
  return <Card tone="muted"><div className="error-state"><strong>{message}</strong><button className="button button-ghost" onClick={retry}>Retry</button></div></Card>;
}

function TodayView({ dashboard, onOpen }: { dashboard: Dashboard; onOpen: (view: View) => void }) {
  const stats = dashboard.todayStats;
  const recovery = dashboard.recovery;
  const workoutCount = dashboard.calendar.logs.filter((log) => log.date === dashboard.today && log.done).length;
  return <div className="view-stack">
    <div className="eyebrow">{dashboard.today}</div>
    <div className="hero">
      <div><span className="eyebrow hero-eyebrow">TRIX PERFORMANCE SYSTEM</span><h1>{dashboard.name ? `Good to see you, ${dashboard.name}` : "Ready when you are"}</h1><p>{dashboard.logForm?.exercises?.length ? `${dashboard.logForm.exercises.length} exercises are waiting for you.` : "Build momentum with one useful action today."}</p></div>
      <button className="button button-light" onClick={() => onOpen("train")}>{dashboard.logForm?.exercises?.length ? "Start session" : "Open training"}</button>
    </div>
    <div className="metric-grid">
      <Metric label="Recovery" value={`${recovery.score}`} detail={recovery.label} />
      <Metric label="Streak" value={`${dashboard.gamification?.streak ?? 0} wk`} detail={`Level ${dashboard.gamification?.level ?? 1}`} />
      <Metric label="Sessions" value={`${workoutCount}`} detail="today" />
    </div>
    <Card>
      <div className="section-head"><div><span className="eyebrow">READINESS</span><h2>{recovery.label}</h2></div><span className={`status-dot status-${recovery.score >= 70 ? "good" : recovery.score >= 45 ? "warn" : "bad"}`} /></div>
      {recovery.factors.length ? <ul className="factor-list">{recovery.factors.slice(0, 3).map((factor) => <li key={factor}>{factor}</li>)}</ul> : <p className="muted">No recovery blockers detected.</p>}
    </Card>
    {stats && <Card><div className="section-head"><div><span className="eyebrow">DAILY LOAD</span><h2>Small actions count</h2></div><button className="text-button" onClick={() => onOpen("progress")}>Details →</button></div><div className="metric-grid compact"><Metric label="Water" value={`${formatNumber(stats.waterMl)} ml`} detail={`goal ${formatNumber(stats.waterGoal)} ml`} /><Metric label="Steps" value={formatNumber(stats.steps)} detail={`goal ${formatNumber(stats.stepsGoal)}`} /></div></Card>}
    <Card tone="accent"><div className="section-head"><div><span className="eyebrow">NEXT BEST ACTION</span><h2>{dashboard.logForm?.exercises?.length ? "Log your session" : "Keep your baseline alive"}</h2></div><span className="action-arrow">↗</span></div><p>{dashboard.logForm?.exercises?.length ? "A completed session gives your next progression decision real evidence." : "Open your plan, review the next session, or log a quick meal."}</p><div className="button-row"><button className="button button-light" onClick={() => onOpen(dashboard.logForm?.exercises?.length ? "train" : "plan")}>{dashboard.logForm?.exercises?.length ? "Log workout" : "Review plan"}</button><button className="button button-outline-light" onClick={() => onOpen("fuel")}>Fuel</button></div></Card>
  </div>;
}

function TrainView() {
  const draftKey = "trix:v2:workout-draft";
  const [workout, setWorkout] = useState<WorkoutToday | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [drafted, setDrafted] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const load = () => {
    setLoading(true); setError(null);
    api<WorkoutToday>("/api/v2/workout/today").then((data) => {
      try {
        const raw = localStorage.getItem(draftKey);
        const draft = raw ? JSON.parse(raw) as WorkoutToday : null;
        if (draft?.date === data.date && Array.isArray(draft.exercises)) {
          setWorkout({ ...data, exercises: draft.exercises });
          setDrafted(true);
          return;
        }
      } catch { localStorage.removeItem(draftKey); }
      setWorkout(data);
      setDrafted(false);
    }).catch(setError).finally(() => setLoading(false));
  };
  useEffect(load, []);
  const update = (index: number, key: "weight" | "reps" | "seconds" | "meters", value: number) => setWorkout((current) => {
    if (!current) return current;
    const next = { ...current, exercises: current.exercises.map((exercise) => exercise.index === index ? ({ ...exercise, setsDone: [{ ...(exercise.setsDone?.[0] ?? { weight: 0, reps: 0 }), [key]: value }] }) : exercise) };
    try { localStorage.setItem(draftKey, JSON.stringify(next)); setDrafted(true); } catch { /* storage is optional */ }
    return next;
  });
  const save = async () => {
    if (!workout) return;
    setSaving(true); setSaved(false);
    try {
      await api("/api/v2/workout/save", { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({ entries: workout.exercises.filter((e) => e.setsDone?.length).map((e) => ({ name: e.name, setsDone: e.setsDone })) }) });
      localStorage.removeItem(draftKey); setDrafted(false);
      setSaved(true); window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success");
    } catch (err) { setError(err); } finally { setSaving(false); }
  };
  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} retry={load} />;
  if (!workout?.exercises?.length) return <Empty title="Rest day" detail="Your next planned session will appear here." />;
  return <div className="view-stack"><div className="eyebrow">GUIDED LOGGER · {workout.date}</div><div className="page-title"><h1>Training session</h1><span>{workout.exercises.length} moves</span></div>{saved && <div className="save-note">Session saved. Nice work.</div>}{drafted && <div className="draft-note">Draft saved on this device. Reconnect to sync it.</div>}<div className="exercise-list">{workout.exercises.map((exercise) => { const set = exercise.setsDone?.[0] ?? { weight: 0, reps: 0 }; const metricFields = exercise.metric === "reps" ? <><label><span>Load</span><input type="number" inputMode="decimal" value={set.weight || ""} placeholder="kg" onChange={(event) => update(exercise.index, "weight", Number(event.target.value))} /></label><label><span>Reps</span><input type="number" inputMode="numeric" value={set.reps || ""} placeholder="reps" onChange={(event) => update(exercise.index, "reps", Number(event.target.value))} /></label></> : exercise.metric === "time" ? <label><span>Seconds</span><input type="number" inputMode="numeric" value={set.seconds || ""} placeholder="sec" onChange={(event) => update(exercise.index, "seconds", Number(event.target.value))} /></label> : <label><span>Meters</span><input type="number" inputMode="decimal" value={set.meters || ""} placeholder="m" onChange={(event) => update(exercise.index, "meters", Number(event.target.value))} /></label>; return <Card key={`${exercise.index}-${exercise.name}`}><div className="exercise-head"><div><span className="exercise-index">{String(exercise.index + 1).padStart(2, "0")}</span><h2>{exercise.name}</h2></div><span className="tag">{exercise.metric}</span></div><p className="muted">{exercise.sets} sets · {exercise.metric === "reps" ? "controlled reps" : "measured effort"}</p><div className="input-row">{metricFields}</div></Card>; })}</div><button className="button button-primary button-wide" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save session"}</button></div>;
}

function PlanView() {
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
  if (error) return <ErrorState error={error} retry={() => window.location.reload()} />;
  if (!plan) return <Loading />;
  if (!plan.days.length) return <Empty title="No active plan" detail="Finish onboarding to build your first plan." />;
  return <div className="view-stack"><div className="eyebrow">ACTIVE PROGRAM · EDITABLE</div><div className="page-title"><h1>{plan.owner.name}'s plan</h1><span>{plan.days.length} days</span></div>{saved && <div className="save-note">Plan updated.</div>}{plan.days.map((day) => <Card key={day.weekday}><div className="section-head"><div><span className="eyebrow">DAY {day.weekday}</span><h2>{day.name}</h2></div><span className="tag">{day.muscleGroup}</span></div><div className="plan-list">{day.exercises.map((exercise) => { const weightKey = `${day.weekday}:${exercise.index}:weight`; const setsKey = `${day.weekday}:${exercise.index}:sets`; return <div className="plan-row plan-row-edit" key={`${day.weekday}-${exercise.index}`}><span className="exercise-index">{String(exercise.index + 1).padStart(2, "0")}</span><div><strong>{exercise.name}</strong><small>{exercise.sets} · {exercise.startWeight}</small><div className="plan-edit-fields"><input aria-label={`${exercise.name} weight`} value={drafts[weightKey] ?? exercise.startWeight} onChange={(event) => setDrafts((current) => ({ ...current, [weightKey]: event.target.value }))} /><button className="button button-ghost" disabled={saving === weightKey} onClick={() => void edit(day.weekday, exercise.index, "weight", drafts[weightKey] ?? exercise.startWeight, exercise.name)}>{saving === weightKey ? "…" : saved === weightKey ? "Saved" : "Weight"}</button><input aria-label={`${exercise.name} sets`} value={drafts[setsKey] ?? exercise.sets} onChange={(event) => setDrafts((current) => ({ ...current, [setsKey]: event.target.value }))} /><button className="button button-ghost" disabled={saving === setsKey} onClick={() => void edit(day.weekday, exercise.index, "sets", drafts[setsKey] ?? exercise.sets, exercise.name)}>{saving === setsKey ? "…" : "Sets"}</button></div></div></div>; })}</div></Card>)}</div>;
}

function FuelView() {
  const [nutrition, setNutrition] = useState<Nutrition | null>(null); const [error, setError] = useState<unknown>(null); const [text, setText] = useState(""); const [search, setSearch] = useState(""); const [barcode, setBarcode] = useState(""); const [results, setResults] = useState<FoodSearchItem[]>([]); const [grams, setGrams] = useState("100"); const [saving, setSaving] = useState(false); const [searching, setSearching] = useState(false); const [selected, setSelected] = useState<FoodSearchItem | null>(null);
  const load = () => { setError(null); api<Nutrition>("/api/v2/nutrition").then(setNutrition).catch(setError); }; useEffect(load, []);
  const log = async () => { if (!text.trim()) return; setSaving(true); try { await api("/api/v2/log", { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({ kind: "food", text: text.trim() }) }); setText(""); load(); } catch (err) { setError(err); } finally { setSaving(false); } };
  const searchFood = async (action: "dbsearch" | "barcode") => { const q = action === "dbsearch" ? search.trim() : barcode.replace(/\D/g, ""); if (!q || q.length < 2) return; setSearching(true); try { const result = await api<{ items: FoodSearchItem[] }>("/api/v2/nutrition", { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody(action === "dbsearch" ? { action, q } : { action, code: q }) }); setResults(result.items ?? []); } catch (err) { setError(err); } finally { setSearching(false); } };
  const addFood = async (item: FoodSearchItem) => { const amount = Number(grams); if (!Number.isFinite(amount) || amount < 1 || amount > 3000) return; setSaving(true); try { await api("/api/v2/nutrition", { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({ action: "dbadd", name: item.name, grams: amount, per100: item.per100 }) }); setSelected(null); setResults([]); load(); } catch (err) { setError(err); } finally { setSaving(false); } };
  const readd = async (ri: number) => { setSaving(true); try { await api("/api/v2/nutrition", { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({ action: "readd", ri }) }); load(); } catch (err) { setError(err); } finally { setSaving(false); } };
  if (error) return <ErrorState error={error} retry={load} />; if (!nutrition) return <Loading />;
  return <div className="view-stack"><div className="eyebrow">FUEL · {nutrition.date}</div><div className="page-title"><h1>Eat with intent</h1><span>{formatNumber(nutrition.totals.kcal)} kcal</span></div><Card tone="accent"><div className="macro-grid"><Metric label="Calories" value={`${formatNumber(nutrition.totals.kcal)}`} detail={nutrition.targets ? `of ${formatNumber(nutrition.targets.calories)}` : undefined} /><Metric label="Protein" value={`${formatNumber(nutrition.totals.protein)} g`} detail={nutrition.targets ? `of ${formatNumber(nutrition.targets.protein)} g` : undefined} /></div></Card><Card><div className="section-head"><div><span className="eyebrow">AI QUICK LOG</span><h2>Describe the meal</h2></div></div><div className="input-row"><input value={text} placeholder="e.g. oats, yogurt and berries" onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void log(); }} /><button className="button button-primary" onClick={() => void log()} disabled={saving}>{saving ? "…" : "Log"}</button></div></Card><Card><div className="section-head"><div><span className="eyebrow">FOOD SEARCH</span><h2>Use measured portions</h2></div></div><div className="input-row"><input value={search} placeholder="Search oats, yogurt…" onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchFood("dbsearch"); }} /><button className="button button-ghost" onClick={() => void searchFood("dbsearch")} disabled={searching}>{searching ? "…" : "Search"}</button></div><div className="input-row"><input value={barcode} inputMode="numeric" placeholder="Barcode" onChange={(event) => setBarcode(event.target.value)} /><button className="button button-ghost" onClick={() => void searchFood("barcode")} disabled={searching}>Scan code</button></div>{results.length > 0 && <div className="food-results">{results.map((item) => <button className="food-result" key={`${item.name}-${item.brand ?? ""}`} onClick={() => setSelected(item)}><span><strong>{item.name}</strong><small>{item.brand || "per 100 g"}</small></span><span>{item.per100.kcal} kcal</span></button>)}</div>}{selected && <div className="portion-editor"><strong>{selected.name}</strong><div className="input-row"><input type="number" min="1" max="3000" value={grams} onChange={(event) => setGrams(event.target.value)} /><span className="muted">grams</span><button className="button button-primary" onClick={() => void addFood(selected)} disabled={saving}>Add portion</button></div></div>}</Card>{nutrition.recent?.length ? <Card><div className="section-head"><div><span className="eyebrow">RECENT</span><h2>Repeat a reliable meal</h2></div></div><div className="food-results">{nutrition.recent.slice(0, 6).map((item) => <button className="food-result" key={item.ri} onClick={() => void readd(item.ri)} disabled={saving}><span><strong>{item.desc}</strong><small>P {formatNumber(item.protein)}</small></span><span>{formatNumber(item.kcal)} kcal</span></button>)}</div></Card> : null}{nutrition.meals.length ? <Card><div className="section-head"><div><span className="eyebrow">TODAY</span><h2>Logged meals</h2></div></div><div className="meal-list">{nutrition.meals.map((meal) => <div className="meal-row" key={meal.index}><div><strong>{meal.desc}</strong><small>{meal.grams ? `${meal.grams} g · ` : ""}P {formatNumber(meal.protein)} · F {formatNumber(meal.fats)} · C {formatNumber(meal.carbs)}</small></div><span>{formatNumber(meal.kcal)}</span></div>)}</div></Card> : <Empty title="Nothing logged yet" detail="A rough log is better than an invisible day." />}{nutrition.mealPlan?.days?.length ? <Card><div className="section-head"><div><span className="eyebrow">MEAL PLAN</span><h2>Use the plan as a compass</h2></div></div><p className="muted">Your generated meal plan has {nutrition.mealPlan.days.length} day(s). The bot remains available for the full grocery and portion workflow.</p></Card> : null}</div>;
}

function ProgressView({ dashboard }: { dashboard: Dashboard }) {
  const latest = dashboard.weight.points.at(-1); const first = dashboard.weight.points[0];
  return <div className="view-stack"><div className="eyebrow">PERFORMANCE DATA</div><div className="page-title"><h1>Progress</h1><span>{dashboard.today}</span></div><div className="metric-grid"><Metric label="Current weight" value={latest ? `${formatNumber(latest.kg)} kg` : "—"} detail={dashboard.weight.goal ? `goal ${formatNumber(dashboard.weight.goal)} kg` : "add a weigh-in"} /><Metric label="Recovery" value={`${dashboard.recovery.score}`} detail={dashboard.recovery.label} /><Metric label="Conditioning" value={`${dashboard.conditioning.minutes} min`} detail={`${dashboard.conditioning.zone} load`} /></div><Card><div className="section-head"><div><span className="eyebrow">WEIGHT TREND</span><h2>{dashboard.weight.projection?.reached ? "Goal reached" : dashboard.weight.projection?.onTrack ? "On track" : "Keep observing"}</h2></div></div>{dashboard.weight.points.length > 1 ? <div className="sparkline">{dashboard.weight.points.map((point, index) => <span key={point.date} style={{ left: `${(index / (dashboard.weight.points.length - 1)) * 100}%`, bottom: `${Math.max(4, Math.min(92, ((point.kg - (first?.kg ?? point.kg) + 5) / 10) * 100))}%` }} title={`${point.date}: ${point.kg} kg`} />)}</div> : <Empty title="Build your baseline" detail="Two or more weigh-ins unlock the trend." />}</Card><Card><div className="section-head"><div><span className="eyebrow">WEEKLY VOLUME</span><h2>Strength load</h2></div><button className="text-button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>Top ↑</button></div>{dashboard.volume.length ? <div className="volume-list">{dashboard.volume.map((item) => <div className="volume-row" key={item.group}><div><strong>{item.group}</strong><small>{item.sets} sets · {item.zone}</small></div><div className="bar"><span style={{ width: `${Math.min(100, (item.sets / Math.max(item.mav, 1)) * 100)}%` }} /></div></div>)}</div> : <Empty title="No volume yet" detail="Complete a session to see useful training data." />}</Card></div>;
}

function RoleView({ dashboard }: { dashboard: Dashboard }) {
  return <WorkspaceView dashboard={dashboard} />;
}

function Loading() { return <div className="view-stack"><div className="skeleton skeleton-hero" /><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>; }

export function App() {
  const [view, setView] = useState<View>("today"); const [dashboard, setDashboard] = useState<Dashboard | null>(null); const [error, setError] = useState<unknown>(null); const [loading, setLoading] = useState(true); const [onboardingPending, setOnboardingPending] = useState(false);
  const loadDashboard = () => { setLoading(true); setError(null); api<Dashboard>("/api/v2/dashboard").then(setDashboard).catch(setError).finally(() => setLoading(false)); };
  useEffect(() => { loadDashboard(); }, []);
  useEffect(() => { const back = window.Telegram?.WebApp.BackButton; if (!back) return; if (view === "today") { back.hide(); return; } const handler = () => setView("today"); back.show(); back.onClick(handler); return () => back.offClick(handler); }, [view]);
  const navigation = useMemo(() => dashboard?.viewer.role === "trainer" || dashboard?.viewer.role === "solo" || dashboard?.viewer.role === "client" ? ["today", "train", "plan", "fuel", "progress", "role"] as View[] : ["today", "role"] as View[], [dashboard?.viewer.role]);
  if (loading && !dashboard) return <main className="app-shell"><Loading /></main>;
  if (error && !dashboard) return <main className="app-shell"><ErrorState error={error} retry={loadDashboard} /></main>;
  if (!dashboard) return null;
  if (!dashboard.viewer.onboarded && onboardingPending) return <main className="app-shell"><header className="topbar"><div className="brand-mark">T</div><div><span className="eyebrow">TRIX / V2</span><strong>Performance system</strong></div></header><div className="view-stack"><div className="hero"><div><span className="eyebrow hero-eyebrow">PLAN BUILDING</span><h1>Your baseline is saved.</h1><p>The coach is shaping your first plan. It will appear here as soon as the background generation finishes.</p></div><button className="button button-light" onClick={loadDashboard}>Check status</button></div><Card><div className="section-head"><div><span className="eyebrow">NEXT</span><h2>You can close this screen</h2></div></div><p className="muted">Telegram will notify you when the plan is ready. Your answers are already stored.</p></Card></div></main>;
  if (!dashboard.viewer.onboarded) return <main className="app-shell"><header className="topbar"><div className="brand-mark">T</div><div><span className="eyebrow">TRIX / V2</span><strong>Performance system</strong></div></header><OnboardingView onComplete={() => setOnboardingPending(true)} /></main>;
  return <main className="app-shell"><header className="topbar"><div className="brand-mark">T</div><div><span className="eyebrow">TRIX / V2</span><strong>Performance system</strong></div><button className="icon-button" onClick={loadDashboard} aria-label="Refresh">↻</button><button className="icon-button" onClick={() => setView("settings")} aria-label="Settings">⚙</button></header><div className="content">{view === "today" && <TodayView dashboard={dashboard} onOpen={setView} />}{view === "train" && <TrainView />}{view === "plan" && <PlanView />}{view === "fuel" && <FuelView />}{view === "progress" && <ProgressView dashboard={dashboard} />}{view === "role" && <RoleView dashboard={dashboard} />}{view === "settings" && <ProfileView onBack={() => setView("today")} />}</div><nav className="bottom-nav" aria-label="Primary navigation">{navigation.map((item) => <button key={item} className={view === item ? "nav-item active" : "nav-item"} onClick={() => setView(item)}><span className="nav-icon">{item === "today" ? "⌂" : item === "train" ? "◈" : item === "plan" ? "▤" : item === "fuel" ? "◌" : item === "progress" ? "↗" : "◎"}</span><span>{labels[item]}</span></button>)}</nav></main>;
}
