import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, jsonBody } from "./api";
import type { Dashboard, LibraryProgram, LibraryResponse, Plan, PlatesResponse, ProfilePhoto, SquadInfo, WeekCardResponse } from "./types";
import { guessLang, t, type Lang } from "./i18n";
import { WorkspaceView } from "./Workspace";
import { OnboardingView } from "./Onboarding";
import { ProfileView } from "./ProfileView";
import { ProgressView } from "./ProgressView";
import { TrainView } from "./TrainView";
import { FuelView } from "./FuelView";

type View = "today" | "train" | "plan" | "fuel" | "progress" | "role" | "more" | "settings";

function viewFromLocation(): View {
  const raw = new URLSearchParams(window.location.search).get("view") ?? new URLSearchParams(window.location.search).get("startapp");
  const aliases: Record<string, View> = { home: "today", log: "train", workout: "train", survey: "progress", nutrition: "fuel", food: "fuel", profile: "settings", owner: "role" };
  const value = raw ? aliases[raw] ?? (raw as View) : "today";
  return ["today", "train", "plan", "fuel", "progress", "role", "more", "settings"].includes(value) ? value : "today";
}

function navLabel(lang: Lang, view: View): string {
  return t(lang, view === "today" ? "nav_today" : view === "train" ? "nav_train" : view === "plan" ? "nav_plan" : view === "fuel" ? "nav_fuel" : view === "progress" ? "nav_progress" : view === "role" ? "nav_role" : view === "more" ? "nav_more" : "nav_settings");
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
  const rings = [
    { label: t(lang, "metric_sessions"), value: workoutCount, goal: Math.max(1, dashboard.calendar.split.filter((day) => day.weekday > 0).length || 3) },
    { label: t(lang, "metric_water"), value: stats?.waterMl ?? 0, goal: stats?.waterGoal ?? 2000, suffix: " ml" },
    { label: t(lang, "metric_steps"), value: stats?.steps ?? 0, goal: stats?.stepsGoal ?? 8000 },
  ];
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
    <Card><div className="section-head"><div><span className="eyebrow">{t(lang, "activity_rings_eyebrow")}</span><h2>{t(lang, "activity_rings_title")}</h2></div><button className="text-button" onClick={() => onOpen("progress")}>{t(lang, "details_arrow")}</button></div><div className="ring-grid">{rings.map((ring) => { const pct = Math.min(100, Math.round((ring.value / Math.max(1, ring.goal)) * 100)); return <div className="ring-item" key={ring.label}><div className="ring" style={{ background: `conic-gradient(var(--accent) ${pct}%, var(--surface-2) 0)` }}><div><strong>{pct}%</strong><small>{ring.value}{ring.suffix ?? ""}</small></div></div><span>{ring.label}</span></div>; })}</div></Card>
    <Card>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "readiness_eyebrow")}</span><h2>{recovery.label}</h2></div><span className={`status-dot status-${recovery.score >= 70 ? "good" : recovery.score >= 45 ? "warn" : "bad"}`} /></div>
      {recovery.factors.length ? <ul className="factor-list">{recovery.factors.slice(0, 3).map((factor) => <li key={factor}>{factor}</li>)}</ul> : <p className="muted">{t(lang, "no_recovery_blockers")}</p>}
    </Card>
    {stats && <Card><div className="section-head"><div><span className="eyebrow">{t(lang, "daily_load_eyebrow")}</span><h2>{t(lang, "small_actions_count")}</h2></div><button className="text-button" onClick={() => onOpen("progress")}>{t(lang, "details_arrow")}</button></div><div className="metric-grid compact"><Metric label={t(lang, "metric_water")} value={`${formatNumber(stats.waterMl)} ml`} detail={t(lang, "goal_ml", { n: formatNumber(stats.waterGoal) })} /><Metric label={t(lang, "metric_steps")} value={formatNumber(stats.steps)} detail={t(lang, "goal_n", { n: formatNumber(stats.stepsGoal) })} /></div></Card>}
    <Card tone="accent"><div className="section-head"><div><span className="eyebrow">{t(lang, "nba_eyebrow")}</span><h2>{hasExercises ? t(lang, "nba_log_session") : t(lang, "nba_keep_baseline")}</h2></div><span className="action-arrow">↗</span></div><p>{hasExercises ? t(lang, "nba_evidence") : t(lang, "nba_open_plan")}</p><div className="button-row"><button className="button button-light" onClick={() => onOpen(hasExercises ? "train" : "plan")}>{hasExercises ? t(lang, "log_workout") : t(lang, "review_plan")}</button><button className="button button-outline-light" onClick={() => onOpen("fuel")}>{t(lang, "fuel_btn")}</button></div></Card>
  </div>;
}

type PlanAction = "weight" | "sets" | "del" | "move" | "swap" | "add" | "link" | "video";

function PlanView({ lang, clientId = null, onBack }: { lang: Lang; clientId?: number | null; onBack?: () => void }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<unknown>(null);
  // Separate from `error` on purpose: `error` means "couldn't load the plan, nothing to show" and
  // replaces the whole editor with ErrorState. A single edit failing -- most commonly a 409 from a
  // stale If-Match version after a concurrent change -- is recoverable and must not blank out an
  // already-rendered plan the user is mid-edit on; it shows as a small dismissible inline note.
  const [actionError, setActionError] = useState<unknown>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newExercises, setNewExercises] = useState<Record<number, string>>({});
  const [swapDrafts, setSwapDrafts] = useState<Record<string, string>>({});
  const [catalogResults, setCatalogResults] = useState<Record<string, Array<{ id: string; name: string; muscle: string }>>>({});
  const [catalogBusy, setCatalogBusy] = useState<string | null>(null);
  const [videoDrafts, setVideoDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api<Plan>(`/api/v2/plan${clientId ? `?clientId=${clientId}` : ""}`).then(setPlan).catch(setError);
  };
  useEffect(load, [clientId]);

  const edit = async (
    weekday: number,
    index: number,
    action: PlanAction,
    value?: string,
    expectName?: string,
    extra: Record<string, unknown> = {},
  ): Promise<boolean> => {
    if (!plan) return false;
    const key = `${weekday}:${index}:${action}`;
    setSaving(key); setSaved(null); setActionError(null);
    try {
      const result = await api<{ ok: true; days: Plan["days"]; version: string }>("/api/v2/plan", {
        method: "POST",
        headers: { "If-Match": `"${plan.version}"` },
        idempotencyKey: crypto.randomUUID(),
        body: jsonBody({ weekday, index, action, ...(clientId ? { clientId } : {}), ...(value !== undefined ? { value } : {}), ...(expectName ? { expectName } : {}), ...extra }),
      });
      setPlan({ ...plan, days: result.days, version: result.version });
      setSaved(key);
      return true;
    } catch (err) {
      // A 409 here is a stale If-Match version (the plan changed since this copy was loaded) --
      // recoverable by re-fetching, not a reason to blank the editor out from under the user.
      setActionError(err);
      return false;
    } finally {
      setSaving(null);
    }
  };

  const addExercise = async (weekday: number) => {
    const name = newExercises[weekday]?.trim();
    if (!name) return;
    if (await edit(weekday, -1, "add", name)) {
      setNewExercises((current) => ({ ...current, [weekday]: "" }));
    }
  };

  const searchCatalog = async (key: string, query: string) => {
    if (query.trim().length < 2) return;
    setCatalogBusy(key);
    try {
      const result = await api<{ items: Array<{ id: string; name: string; muscle: string }> }>(`/api/v2/plan/catalog?q=${encodeURIComponent(query.trim())}`);
      setCatalogResults((current) => ({ ...current, [key]: result.items ?? [] }));
    } catch (err) {
      setActionError(err);
    } finally {
      setCatalogBusy(null);
    }
  };

  if (error) return <ErrorState lang={lang} error={error} retry={load} />;
  if (!plan) return <Loading />;
  if (!plan.days.length) return <Empty title={t(lang, "no_plan_title")} detail={t(lang, "no_plan_detail")} />;

  return <div className="view-stack">
    <div className="eyebrow">{t(lang, "plan_eyebrow")}</div>
    <div className="page-title"><h1>{t(lang, "plan_owner_title", { name: plan.owner.name })}</h1><span>{t(lang, "days_count", { n: plan.days.length })}</span></div>
    {onBack && <button className="text-button" onClick={onBack}>← {t(lang, "nav_role")}</button>}
    <p className="muted">{t(lang, "plan_editor_hint")}</p>
    {actionError !== null && <Card tone="muted"><div className="error-state"><strong>{actionError instanceof Error && !(actionError instanceof ApiError) ? actionError.message : t(lang, "generic_error")}</strong><button className="button button-ghost" onClick={() => setActionError(null)}>{t(lang, "close")}</button></div></Card>}
    {saved && <div className="save-note">{t(lang, "plan_updated")}</div>}
    {plan.days.map((day) => <Card key={day.weekday}>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "day_label", { n: day.weekday })}</span><h2>{day.name}</h2></div><span className="tag">{day.muscleGroup}</span></div>
      <div className="plan-list">
        {day.exercises.map((exercise) => {
          const base = `${day.weekday}:${exercise.index}`;
          const weightKey = `${base}:weight`;
          const setsKey = `${base}:sets`;
          const swapKey = `${base}:swap`;
          const videoKey = `${base}:video`;
          const isSaving = (action: PlanAction) => saving === `${day.weekday}:${exercise.index}:${action}`;
          const canLink = exercise.index < day.exercises.length - 1;
          return <div className="plan-row plan-row-edit" key={`${day.weekday}-${exercise.index}-${exercise.name}`}>
            <span className="exercise-index">{String(exercise.index + 1).padStart(2, "0")}</span>
            <div>
              <div className="plan-exercise-title"><strong>{exercise.name}</strong>{exercise.ssGroup && <span className="tag">{t(lang, "plan_superset_label", { group: exercise.ssGroup })}</span>}</div>
              <small>{exercise.sets} · {exercise.startWeight}{exercise.wmode && ` · ${exercise.wmode}`}</small>
              {(exercise.technique || exercise.videoUrl) && <div className="plan-reference"><span>{exercise.technique ? `${t(lang, "plan_technique_label")}: ${exercise.technique}` : ""}</span>{exercise.videoUrl && <a href={exercise.videoUrl} target="_blank" rel="noreferrer">{exercise.videoTitle || t(lang, "plan_video_label")}</a>}</div>}
              <div className="plan-edit-fields">
                <input aria-label={t(lang, "weight_field_aria", { name: exercise.name })} value={drafts[weightKey] ?? exercise.startWeight} onChange={(event) => setDrafts((current) => ({ ...current, [weightKey]: event.target.value }))} />
                <button className="button button-ghost" disabled={saving !== null} onClick={() => void edit(day.weekday, exercise.index, "weight", drafts[weightKey] ?? exercise.startWeight, exercise.name)}>{isSaving("weight") ? "…" : saved === weightKey ? t(lang, "saved_label") : t(lang, "weight_label")}</button>
                <input aria-label={t(lang, "sets_field_aria", { name: exercise.name })} value={drafts[setsKey] ?? exercise.sets} onChange={(event) => setDrafts((current) => ({ ...current, [setsKey]: event.target.value }))} />
                <button className="button button-ghost" disabled={saving !== null} onClick={() => void edit(day.weekday, exercise.index, "sets", drafts[setsKey] ?? exercise.sets, exercise.name)}>{isSaving("sets") ? "…" : t(lang, "sets_label")}</button>
              </div>
              <div className="plan-inline-editor">
                <input value={swapDrafts[swapKey] ?? ""} maxLength={80} placeholder={t(lang, "plan_swap_ph")} onChange={(event) => setSwapDrafts((current) => ({ ...current, [swapKey]: event.target.value }))} />
                <button className="button button-ghost" disabled={catalogBusy === swapKey || (swapDrafts[swapKey] ?? "").trim().length < 2} onClick={() => void searchCatalog(swapKey, swapDrafts[swapKey] ?? "")}>{catalogBusy === swapKey ? "…" : t(lang, "plan_catalog_search")}</button>
                <button className="button button-ghost" disabled={saving !== null || !(swapDrafts[swapKey] ?? "").trim()} onClick={async () => { if (await edit(day.weekday, exercise.index, "swap", swapDrafts[swapKey]?.trim(), exercise.name)) setSwapDrafts((current) => ({ ...current, [swapKey]: "" })); }}>{isSaving("swap") ? "…" : t(lang, "plan_swap_btn")}</button>
              </div>
              {catalogResults[swapKey] && <div className="choice-list">{catalogResults[swapKey].length ? catalogResults[swapKey].map((choice) => <button className="choice-button" key={choice.id} onClick={async () => { if (await edit(day.weekday, exercise.index, "swap", choice.name, exercise.name, { catalogId: choice.id })) { setCatalogResults((current) => ({ ...current, [swapKey]: [] })); setSwapDrafts((current) => ({ ...current, [swapKey]: "" })); } }}><strong>{choice.name}</strong><small>{choice.muscle}</small></button>) : <span className="muted">{t(lang, "plan_catalog_empty")}</span>}</div>}
              <div className="plan-inline-editor">
                <input value={videoDrafts[videoKey] ?? ""} maxLength={300} placeholder={t(lang, "plan_video_ph")} onChange={(event) => setVideoDrafts((current) => ({ ...current, [videoKey]: event.target.value }))} />
                <button className="button button-ghost" disabled={saving !== null || !(videoDrafts[videoKey] ?? "").trim()} onClick={async () => { if (await edit(day.weekday, exercise.index, "video", videoDrafts[videoKey]?.trim(), exercise.name)) setVideoDrafts((current) => ({ ...current, [videoKey]: "" })); }}>{isSaving("video") ? "…" : t(lang, "plan_video_save")}</button>
              </div>
              <div className="plan-exercise-actions">
                <button className="text-button" disabled={saving !== null || exercise.index === 0} aria-label={t(lang, "plan_move_up")} onClick={() => void edit(day.weekday, exercise.index, "move", undefined, exercise.name, { dir: "up" })}>↑ {t(lang, "plan_move_up")}</button>
                <button className="text-button" disabled={saving !== null || exercise.index === day.exercises.length - 1} aria-label={t(lang, "plan_move_down")} onClick={() => void edit(day.weekday, exercise.index, "move", undefined, exercise.name, { dir: "down" })}>↓ {t(lang, "plan_move_down")}</button>
                {canLink && <button className="text-button" disabled={saving !== null} onClick={() => void edit(day.weekday, exercise.index, "link", undefined, exercise.name)}>{exercise.ssGroup ? t(lang, "plan_unlink_btn") : t(lang, "plan_link_btn")}</button>}
                <button className="text-button danger-button" disabled={saving !== null} onClick={() => { if (day.exercises.length <= 1) { setActionError(new Error(t(lang, "plan_last_exercise"))); return; } if (window.confirm(t(lang, "plan_delete_confirm"))) void edit(day.weekday, exercise.index, "del", undefined, exercise.name); }}>{t(lang, "plan_delete_btn")}</button>
              </div>
            </div>
          </div>;
        })}
      </div>
      <div className="plan-add-row">
        <input value={newExercises[day.weekday] ?? ""} maxLength={80} placeholder={t(lang, "plan_add_ph")} onChange={(event) => setNewExercises((current) => ({ ...current, [day.weekday]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") void addExercise(day.weekday); }} />
        <button className="button button-primary" disabled={saving !== null || !(newExercises[day.weekday] ?? "").trim()} onClick={() => void addExercise(day.weekday)}>{saving === `${day.weekday}:-1:add` ? "…" : t(lang, "plan_add_btn")}</button>
      </div>
    </Card>)}
  </div>;
}

function RoleView({ dashboard, lang, onOpenPlan }: { dashboard: Dashboard; lang: Lang; onOpenPlan: (clientId?: number) => void }) {
  return <WorkspaceView dashboard={dashboard} lang={lang} onOpenPlan={onOpenPlan} />;
}

// ---- Extras helpers: week-card / photo-compare image composition, upload ----

/** Same debug-query passthrough api.ts's appendDebugQuery does (not exported there) -- lets a
 * localhost session without real Telegram initData still authorize via ?debugUser=. */
function debugAppend(path: string): string {
  if (window.Telegram?.WebApp?.initData) return path;
  const query = window.location.search.slice(1);
  if (!query) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${query}`;
}

function photoQuery(): string {
  const tma = window.Telegram?.WebApp?.initData;
  if (tma) return `&tma=${encodeURIComponent(tma)}`;
  return window.location.search.replace(/^\?/, "&");
}

function photoUrl(id: number): string {
  return `/api/v2/photo?id=${id}${photoQuery()}`;
}

/** api() forces an "application/json" Content-Type on any request body, which corrupts a
 * multipart FormData upload (the browser needs to set its own boundary) -- so the two
 * image-upload endpoints (weekcard/photocompare) go through this instead, mirroring api()'s
 * auth/envelope handling but never touching Content-Type. */
async function apiUpload(path: string, form: FormData): Promise<{ ok: boolean }> {
  const requestHeaders = new Headers();
  const initData = window.Telegram?.WebApp?.initData ?? "";
  if (initData) requestHeaders.set("Authorization", `tma ${initData}`);
  requestHeaders.set("Accept", "application/json");
  const response = await fetch(debugAppend(path), { method: "POST", headers: requestHeaders, body: form });
  let body: unknown = null;
  try { body = await response.json(); } catch { /* empty response */ }
  if (!response.ok) {
    const failure = body as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(failure?.error?.code ?? "dependency_unavailable", failure?.error?.message ?? "Request failed", response.status);
  }
  if (body && typeof body === "object" && "data" in body) return (body as { data: { ok: boolean } }).data;
  return body as { ok: boolean };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

/** Side-by-side before/after canvas, matching the legacy vanilla webapp's photo-compare intent
 * (client composes the image; the bot has no server-side rendering) -- normalized to a common
 * height so two differently-cropped photos still line up. */
async function composeCompare(urlA: string, urlB: string): Promise<Blob | null> {
  const [a, b] = await Promise.all([loadImage(urlA), loadImage(urlB)]);
  const h = 900;
  const wA = Math.round((a.width / a.height) * h);
  const wB = Math.round((b.width / b.height) * h);
  const canvas = document.createElement("canvas");
  canvas.width = wA + wB + 8;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#0b0d11";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(a, 0, 0, wA, h);
  ctx.drawImage(b, wA + 8, 0, wB, h);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

/** Canvas-rendered week-card PNG (same numbers as the text card /api/v2/weekcard already
 * returns) -- pushed to the viewer's own Telegram chat afterward, the same "webview can't offer
 * a file download" workaround every other export in this app uses. */
function drawWeekCard(lang: Lang, stats: NonNullable<WeekCardResponse["stats"]>, name: string): HTMLCanvasElement {
  const W = 900;
  const H = 1180;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#242b38");
  grad.addColorStop(1, "#141820");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#eef1f6";
  g.font = "700 52px system-ui, -apple-system, sans-serif";
  g.fillText(`🏋️ ${name}`, 56, 130);
  g.fillStyle = "#ff5f3d";
  g.font = "400 30px system-ui, -apple-system, sans-serif";
  g.fillText(`${stats.since.slice(5)} → ${stats.until.slice(5)}`, 56, 178);
  g.strokeStyle = "rgba(255,95,61,.35)";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(56, 210);
  g.lineTo(W - 56, 210);
  g.stroke();
  const rows: [string, string][] = [
    [t(lang, "weekcard_workouts"), stats.planned ? `${stats.done}/${stats.planned}` : `${stats.done}`],
    [t(lang, "weekcard_sets"), `${stats.totalSets}`],
    [t(lang, "weekcard_volume"), `${stats.volumeKg} kg`],
    ...(stats.prs > 0 ? ([[t(lang, "weekcard_prs"), `${stats.prs} 🏆`]] as [string, string][]) : []),
    [t(lang, "metric_streak"), `${stats.streak} 🔥`],
    [t(lang, "weekcard_level"), `${stats.level} ⭐ (${stats.xp} XP)`],
  ];
  let y = 300;
  for (const [label, value] of rows) {
    g.fillStyle = "#8f99aa";
    g.font = "400 32px system-ui, -apple-system, sans-serif";
    g.fillText(label, 56, y);
    g.fillStyle = "#eef1f6";
    g.font = "700 46px system-ui, -apple-system, sans-serif";
    g.textAlign = "right";
    g.fillText(value, W - 56, y);
    g.textAlign = "left";
    y += 120;
  }
  g.fillStyle = "#4d7568";
  g.font = "400 24px system-ui, -apple-system, sans-serif";
  g.fillText("trix", 56, H - 36);
  return canvas;
}

function ExtrasView({ lang, role }: { lang: Lang; role: Dashboard["viewer"]["role"] }) {
  // week card
  const [week, setWeek] = useState<WeekCardResponse | null>(null);
  const [weekError, setWeekError] = useState<unknown>(null);
  const [weekBusy, setWeekBusy] = useState(false);
  const [weekSent, setWeekSent] = useState(false);
  const [weekCanvasUrl, setWeekCanvasUrl] = useState<string | null>(null);
  const [weekBlob, setWeekBlob] = useState<Blob | null>(null);
  const loadWeek = () => { setWeekError(null); api<WeekCardResponse>("/api/v2/weekcard").then(setWeek).catch(setWeekError); };
  useEffect(loadWeek, []);
  const generateWeekCard = () => {
    if (!week?.stats) return;
    const canvas = drawWeekCard(lang, week.stats, week.name);
    canvas.toBlob((blob) => { if (!blob) return; setWeekBlob(blob); setWeekCanvasUrl(URL.createObjectURL(blob)); });
  };
  const sendWeekCard = async () => {
    if (!weekBlob) return;
    setWeekBusy(true); setWeekSent(false);
    try {
      const form = new FormData();
      form.append("photo", weekBlob, "weekcard.png");
      await apiUpload("/api/v2/weekcard", form);
      setWeekSent(true);
    } catch (err) { setWeekError(err); } finally { setWeekBusy(false); }
  };

  // photo compare
  const [photos, setPhotos] = useState<ProfilePhoto[] | null>(null);
  const [photosError, setPhotosError] = useState<unknown>(null);
  const loadPhotos = () => { setPhotosError(null); api<{ photos: ProfilePhoto[] }>("/api/v2/profile").then((data) => setPhotos(data.photos)).catch(setPhotosError); };
  useEffect(loadPhotos, []);
  const [fromId, setFromId] = useState<number | null>(null);
  const [toId, setToId] = useState<number | null>(null);
  const [compareBusy, setCompareBusy] = useState(false);
  const [compareSent, setCompareSent] = useState(false);
  const [compareError, setCompareError] = useState<unknown>(null);
  const sendCompare = async () => {
    if (!photos || fromId == null || toId == null) return;
    const a = photos.find((p) => p.id === fromId);
    const b = photos.find((p) => p.id === toId);
    if (!a || !b) return;
    setCompareBusy(true); setCompareSent(false); setCompareError(null);
    try {
      const blob = await composeCompare(photoUrl(fromId), photoUrl(toId));
      if (!blob) throw new Error("compose failed");
      const form = new FormData();
      form.append("photo", blob, "progress.png");
      form.append("from", a.takenAt);
      form.append("to", b.takenAt);
      await apiUpload("/api/v2/photocompare", form);
      setCompareSent(true);
    } catch (err) { setCompareError(err); } finally { setCompareBusy(false); }
  };

  // plates calculator
  const [platesKg, setPlatesKg] = useState("");
  const [plates, setPlates] = useState<PlatesResponse | null>(null);
  const [platesBusy, setPlatesBusy] = useState(false);
  const calcPlates = async () => {
    const kg = Number(platesKg);
    if (!Number.isFinite(kg) || kg <= 0) return;
    setPlatesBusy(true);
    try { setPlates(await api<PlatesResponse>(`/api/v2/plates?kg=${kg}`)); } catch { setPlates(null); } finally { setPlatesBusy(false); }
  };

  // program library
  const [library, setLibrary] = useState<LibraryResponse | null>(null);
  const [libraryError, setLibraryError] = useState<unknown>(null);
  const loadLibrary = () => { setLibraryError(null); api<LibraryResponse>("/api/v2/library").then(setLibrary).catch(setLibraryError); };
  useEffect(loadLibrary, []);
  const [takingCode, setTakingCode] = useState<string | null>(null);
  const [takenName, setTakenName] = useState<string | null>(null);
  const takeProgram = async (program: LibraryProgram) => {
    setTakingCode(program.code); setTakenName(null);
    try { await api("/api/v2/library", { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({ code: program.code }) }); setTakenName(program.name); }
    catch (err) { setLibraryError(err); } finally { setTakingCode(null); }
  };

  // find a trainer (send a join request by trainer id -- there is no public trainer directory
  // in this product; see src/features/trainer/trainer.ts's openFindTrainer comment. This reuses
  // the exact same request record extrasApi.ts's /api/trainers already creates via createRequest,
  // the same one the trainer's own Requests inbox accepts/declines)
  const [trainerId, setTrainerId] = useState("");
  const [trainerNote, setTrainerNote] = useState("");
  const [trainerBusy, setTrainerBusy] = useState(false);
  const [trainerSent, setTrainerSent] = useState(false);
  const [trainerError, setTrainerError] = useState<unknown>(null);
  const sendTrainerRequest = async () => {
    const id = Number(trainerId);
    if (!Number.isFinite(id) || id <= 0) return;
    setTrainerBusy(true); setTrainerError(null); setTrainerSent(false);
    try {
      await api("/api/v2/trainers", { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({ trainerId: id, ...(trainerNote.trim() ? { note: trainerNote.trim() } : {}) }) });
      setTrainerSent(true); setTrainerId(""); setTrainerNote("");
    } catch (err) { setTrainerError(err); } finally { setTrainerBusy(false); }
  };

  // become a trainer -- reuses the exact same /api/v2/trainer/profile POST the bot's own
  // trainer-profile wizard and TrainerProfilePanel (Workspace.tsx) use: when the caller has no
  // v2_trainers row yet, extrasApi.ts's handler treats the same body as a NEW application
  // (applyTrainer, pending owner approval) instead of an edit. TrainerProfilePanel itself isn't
  // reachable here -- it only renders inside TrainerWorkspace, which is gated to role==="trainer"
  // already, so a solo user applying for the first time could never reach it.
  const [becomeName, setBecomeName] = useState("");
  const [becomeSpecialization, setBecomeSpecialization] = useState("");
  const [becomeCity, setBecomeCity] = useState("");
  const [becomeContact, setBecomeContact] = useState("");
  const [becomeBio, setBecomeBio] = useState("");
  const [becomeBusy, setBecomeBusy] = useState(false);
  const [becomeSent, setBecomeSent] = useState(false);
  const [becomeError, setBecomeError] = useState<unknown>(null);
  const applyAsTrainer = async () => {
    if (!becomeName.trim()) return;
    setBecomeBusy(true); setBecomeError(null); setBecomeSent(false);
    try {
      await api("/api/v2/trainer/profile", { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({ name: becomeName.trim(), specialization: becomeSpecialization.trim(), city: becomeCity.trim(), contact: becomeContact.trim(), bio: becomeBio.trim() }) });
      setBecomeSent(true);
    } catch (err) { setBecomeError(err); } finally { setBecomeBusy(false); }
  };

  // squads
  const [squads, setSquads] = useState<SquadInfo[] | null>(null);
  const [squadsError, setSquadsError] = useState<unknown>(null);
  const loadSquads = () => { setSquadsError(null); api<{ squads: SquadInfo[] }>("/api/v2/squads").then((data) => setSquads(data.squads)).catch(setSquadsError); };
  useEffect(loadSquads, []);

  return <div className="view-stack">
    <div className="eyebrow">{t(lang, "extras_eyebrow")}</div>
    <div className="page-title"><h1>{t(lang, "extras_title")}</h1></div>

    <Card>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "weekcard_eyebrow")}</span><h2>{t(lang, "weekcard_title")}</h2></div></div>
      {weekError !== null ? <ErrorState lang={lang} error={weekError} retry={loadWeek} /> : !week ? <div className="skeleton" /> : !week.stats ? <Empty title={t(lang, "weekcard_empty_title")} detail={t(lang, "weekcard_empty_detail")} /> : <>
        <p className="muted">{week.stats.since.slice(5)} → {week.stats.until.slice(5)}</p>
        <div className="metric-grid compact">
          <Metric label={t(lang, "weekcard_workouts")} value={week.stats.planned ? `${week.stats.done}/${week.stats.planned}` : `${week.stats.done}`} />
          <Metric label={t(lang, "weekcard_sets")} value={`${week.stats.totalSets}`} />
          <Metric label={t(lang, "weekcard_volume")} value={`${formatNumber(week.stats.volumeKg)} kg`} />
        </div>
        <div className="metric-grid compact">
          <Metric label={t(lang, "metric_streak")} value={`${week.stats.streak}`} />
          <Metric label={t(lang, "weekcard_level")} value={`${week.stats.level}`} detail={`${week.stats.xp} XP`} />
          {week.stats.prs > 0 && <Metric label={t(lang, "weekcard_prs")} value={`${week.stats.prs}`} />}
        </div>
        <div className="button-row" style={{ marginTop: 12 }}>
          <button className="button button-ghost" onClick={generateWeekCard}>{t(lang, "weekcard_generate_btn")}</button>
          {weekCanvasUrl && <button className="button button-primary" disabled={weekBusy} onClick={() => void sendWeekCard()}>{weekBusy ? t(lang, "saving_ellipsis") : t(lang, "weekcard_send_btn")}</button>}
        </div>
        {weekCanvasUrl && <img src={weekCanvasUrl} alt="" style={{ marginTop: 10, width: "100%", borderRadius: 12 }} />}
        {weekSent && <div className="save-note">{t(lang, "weekcard_sent_note")}</div>}
      </>}
    </Card>

    <Card>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "photocompare_eyebrow")}</span><h2>{t(lang, "photocompare_title")}</h2></div></div>
      {photosError !== null ? <ErrorState lang={lang} error={photosError} retry={loadPhotos} /> : !photos ? <div className="skeleton" /> : photos.length < 2 ? <Empty title={t(lang, "photocompare_empty_title")} detail={t(lang, "photocompare_need_two")} /> : <>
        <div className="input-row">
          <label className="form-field"><span>{t(lang, "photocompare_from_label")}</span><select value={fromId ?? ""} onChange={(event) => setFromId(Number(event.target.value) || null)}><option value="">—</option>{photos.map((p) => <option key={p.id} value={p.id}>{p.takenAt}</option>)}</select></label>
          <label className="form-field"><span>{t(lang, "photocompare_to_label")}</span><select value={toId ?? ""} onChange={(event) => setToId(Number(event.target.value) || null)}><option value="">—</option>{photos.map((p) => <option key={p.id} value={p.id}>{p.takenAt}</option>)}</select></label>
        </div>
        <div className="button-row" style={{ marginTop: 10 }}>
          <button className="button button-primary" disabled={compareBusy || fromId == null || toId == null || fromId === toId} onClick={() => void sendCompare()}>{compareBusy ? t(lang, "saving_ellipsis") : t(lang, "photocompare_send_btn")}</button>
        </div>
        {compareSent && <div className="save-note">{t(lang, "photocompare_sent_note")}</div>}
        {compareError !== null && <div className="save-note error-note">{t(lang, "generic_error")}</div>}
      </>}
    </Card>

    <Card>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "plates_eyebrow")}</span><h2>{t(lang, "plates_title")}</h2></div></div>
      <div className="input-row">
        <input type="number" inputMode="decimal" value={platesKg} placeholder={t(lang, "plates_kg_ph")} onChange={(event) => setPlatesKg(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void calcPlates(); }} />
        <button className="button button-ghost" onClick={() => void calcPlates()} disabled={platesBusy}>{platesBusy ? "…" : t(lang, "plates_calc_btn")}</button>
      </div>
      {plates && <div style={{ marginTop: 10 }}>
        {plates.plan ? <p className="muted"><strong>{plates.plan.loaded} kg</strong> · {t(lang, "plates_per_side")}: {plates.plan.perSide.length ? plates.plan.perSide.join(" + ") : "—"}{plates.plan.leftover ? ` · ${t(lang, "plates_leftover", { n: plates.plan.leftover })}` : ""}</p> : null}
        {plates.ramp.length > 0 && <><p className="muted" style={{ marginTop: 8 }}>{t(lang, "plates_warmup_title")}</p><ul className="factor-list">{plates.ramp.map((w, i) => <li key={i}>{w.weight} kg × {w.reps}{w.pct ? ` (${w.pct}%)` : ""}</li>)}</ul></>}
      </div>}
    </Card>

    <Card>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "library_eyebrow")}</span><h2>{t(lang, "library_title")}</h2></div></div>
      {libraryError !== null ? <ErrorState lang={lang} error={libraryError} retry={loadLibrary} /> : !library ? <div className="skeleton" /> : library.programs.length === 0 ? <Empty title={t(lang, "library_empty_title")} detail={t(lang, "library_empty_detail")} /> : <div className="plan-list">{library.programs.map((p) => <div className="plan-row" key={p.code}><div><strong>{p.name}</strong><small>{t(lang, "library_taken_count", { n: p.takenCount })}</small></div>{library.role !== "client" && <button className="button button-ghost" disabled={takingCode !== null} onClick={() => void takeProgram(p)}>{takingCode === p.code ? "…" : t(lang, "library_take_btn")}</button>}</div>)}</div>}
      {takenName && <div className="save-note">{t(lang, "library_taken_note", { name: takenName })}</div>}
    </Card>

    {role === "solo" && <Card>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "trainer_find_eyebrow")}</span><h2>{t(lang, "trainer_find_title")}</h2></div></div>
      <p className="muted">{t(lang, "trainer_find_detail")}</p>
      <div className="form-grid">
        <label className="form-field"><span>{t(lang, "field_trainer_id")}</span><input type="number" value={trainerId} onChange={(event) => setTrainerId(event.target.value)} /></label>
        <label className="form-field"><span>{t(lang, "field_note_optional")}</span><input value={trainerNote} maxLength={300} onChange={(event) => setTrainerNote(event.target.value)} /></label>
      </div>
      <div className="button-row" style={{ marginTop: 10 }}>
        <button className="button button-primary" disabled={trainerBusy || !trainerId.trim()} onClick={() => void sendTrainerRequest()}>{trainerBusy ? t(lang, "saving_ellipsis") : t(lang, "trainer_request_btn")}</button>
      </div>
      {trainerSent && <div className="save-note">{t(lang, "trainer_request_sent_note")}</div>}
      {trainerError !== null && <div className="save-note error-note">{t(lang, "generic_error")}</div>}
    </Card>}

    {role === "solo" && <Card>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "become_trainer_eyebrow")}</span><h2>{t(lang, "become_trainer_title")}</h2></div></div>
      {becomeSent ? <p className="muted">{t(lang, "become_trainer_pending_note")}</p> : <>
        <p className="muted">{t(lang, "become_trainer_detail")}</p>
        <div className="form-grid">
          <label className="form-field"><span>{t(lang, "field_name")}</span><input value={becomeName} maxLength={60} onChange={(event) => setBecomeName(event.target.value)} /></label>
          <label className="form-field"><span>{t(lang, "field_specialization")}</span><input value={becomeSpecialization} maxLength={120} onChange={(event) => setBecomeSpecialization(event.target.value)} /></label>
          <label className="form-field"><span>{t(lang, "field_city")}</span><input value={becomeCity} maxLength={60} onChange={(event) => setBecomeCity(event.target.value)} /></label>
          <label className="form-field"><span>{t(lang, "field_contact")}</span><input value={becomeContact} maxLength={120} onChange={(event) => setBecomeContact(event.target.value)} /></label>
        </div>
        <label className="form-field"><span>{t(lang, "field_bio")}</span><textarea value={becomeBio} maxLength={600} onChange={(event) => setBecomeBio(event.target.value)} /></label>
        <div className="button-row" style={{ marginTop: 10 }}>
          <button className="button button-primary" disabled={becomeBusy || !becomeName.trim()} onClick={() => void applyAsTrainer()}>{becomeBusy ? t(lang, "saving_ellipsis") : t(lang, "become_trainer_btn")}</button>
        </div>
        {becomeError !== null && <div className="save-note error-note">{t(lang, "generic_error")}</div>}
      </>}
    </Card>}

    <Card>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "squads_eyebrow")}</span><h2>{t(lang, "squads_title")}</h2></div></div>
      {squadsError !== null ? <ErrorState lang={lang} error={squadsError} retry={loadSquads} /> : !squads ? <div className="skeleton" /> : squads.length === 0 ? <Empty title={t(lang, "squads_empty_title")} detail={t(lang, "squads_empty_detail")} /> : squads.map((s, i) => <div key={i} style={{ marginBottom: i < squads.length - 1 ? 18 : 0 }}>
        <div className="section-head"><strong>{s.title || t(lang, "squads_default_title")}</strong><span className="tag">{t(lang, "squads_members_count", { n: s.memberCount })}</span></div>
        <div className="volume-list">{s.entries.map((e) => <div className="volume-row" key={e.name}><div><strong>{e.medal} {e.name}</strong>{e.me && <small>{t(lang, "you_label")}</small>}</div><span>{e.workouts}</span></div>)}</div>
        <p className="muted" style={{ marginTop: 6 }}>{s.silent > 0 ? t(lang, "squads_silent_hint", { n: s.silent, total: s.total }) : t(lang, "squads_all_in_hint", { total: s.total })}</p>
      </div>)}
    </Card>
  </div>;
}

function Loading() { return <div className="view-stack"><div className="skeleton skeleton-hero" /><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>; }

export function App() {
  const [lang, setLang] = useState<Lang>(() => guessLang());
  const [view, setView] = useState<View>(() => viewFromLocation()); const [planClientId, setPlanClientId] = useState<number | null>(null); const [dashboard, setDashboard] = useState<Dashboard | null>(null); const [error, setError] = useState<unknown>(null); const [loading, setLoading] = useState(true); const [onboardingPending, setOnboardingPending] = useState(false);
  const pullStart = useRef<number | null>(null);
  const loadDashboard = () => { setLoading(true); setError(null); api<Dashboard>("/api/v2/dashboard").then((data) => { setDashboard(data); setLang(data.lang); try { localStorage.setItem("trix:v2:dashboard", JSON.stringify(data)); } catch { /* cache is optional */ } }).catch(setError).finally(() => setLoading(false)); };
  useEffect(() => { try { const cached = localStorage.getItem("trix:v2:dashboard"); if (cached) { const data = JSON.parse(cached) as Dashboard; if (data?.viewer && data?.today) { setDashboard(data); setLang(data.lang); setLoading(false); } } } catch { try { localStorage.removeItem("trix:v2:dashboard"); } catch { /* storage is optional */ } } loadDashboard(); }, []);
  useEffect(() => { const scheme = window.Telegram?.WebApp?.colorScheme; if (scheme) document.documentElement.dataset.theme = scheme; }, []);
  useEffect(() => { const handler = (event: MouseEvent) => { if ((event.target as HTMLElement).closest("button")) window.Telegram?.WebApp.HapticFeedback?.impactOccurred("light"); }; document.addEventListener("click", handler); return () => document.removeEventListener("click", handler); }, []);
  useEffect(() => { const back = window.Telegram?.WebApp.BackButton; if (!back) return; if (view === "today") { back.hide(); return; } const handler = () => setView("today"); back.show(); back.onClick(handler); return () => back.offClick(handler); }, [view]);
  const navigation = useMemo(() => dashboard?.viewer.role === "trainer" || dashboard?.viewer.role === "solo" || dashboard?.viewer.role === "client" ? ["today", "train", "plan", "fuel", "progress", "more", "role"] as View[] : ["today", "role"] as View[], [dashboard?.viewer.role]);
  if (loading && !dashboard) return <main className="app-shell"><Loading /></main>;
  if (error && !dashboard) return <main className="app-shell"><ErrorState lang={lang} error={error} retry={loadDashboard} /></main>;
  if (!dashboard) return null;
  if (!dashboard.viewer.onboarded && onboardingPending) return <main className="app-shell"><header className="topbar"><div className="brand-mark">T</div><div><span className="eyebrow">{t(lang, "brand_title")}</span><strong>{t(lang, "brand_subtitle")}</strong></div></header><div className="view-stack"><div className="hero"><div><span className="eyebrow hero-eyebrow">{t(lang, "ob_pending_eyebrow")}</span><h1>{t(lang, "ob_pending_title")}</h1><p>{t(lang, "ob_pending_body")}</p></div><button className="button button-light" onClick={loadDashboard}>{t(lang, "check_status")}</button></div><Card><div className="section-head"><div><span className="eyebrow">{t(lang, "ob_pending_next_eyebrow")}</span><h2>{t(lang, "ob_pending_next_title")}</h2></div></div><p className="muted">{t(lang, "ob_pending_next_body")}</p></Card></div></main>;
  if (!dashboard.viewer.onboarded) return <main className="app-shell"><header className="topbar"><div className="brand-mark">T</div><div><span className="eyebrow">{t(lang, "brand_title")}</span><strong>{t(lang, "brand_subtitle")}</strong></div></header><OnboardingView lang={lang} onComplete={() => setOnboardingPending(true)} /></main>;
  const onTouchStart = (event: React.TouchEvent<HTMLElement>) => { if (window.scrollY === 0) pullStart.current = event.touches[0]?.clientY ?? null; };
  const onTouchEnd = (event: React.TouchEvent<HTMLElement>) => { const start = pullStart.current; pullStart.current = null; const end = event.changedTouches[0]?.clientY ?? 0; if (start !== null && end - start > 72 && !loading) loadDashboard(); };
  const openPlan = (clientId?: number) => { setPlanClientId(clientId ?? null); setView("plan"); };
  return <main className="app-shell" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}><header className="topbar"><div className="brand-mark">T</div><div><span className="eyebrow">{t(lang, "brand_title")}</span><strong>{t(lang, "brand_subtitle")}</strong></div><button className="icon-button" onClick={loadDashboard} aria-label={t(lang, "refresh_aria")}>↻</button><button className="icon-button" onClick={() => setView("settings")} aria-label={t(lang, "settings_aria")}>⚙</button></header><div className="content">{view === "today" && <TodayView dashboard={dashboard} lang={lang} onOpen={setView} />}{view === "train" && <TrainView lang={lang} />}{view === "plan" && <PlanView lang={lang} clientId={planClientId} onBack={planClientId !== null ? () => { setPlanClientId(null); setView("role"); } : undefined} />}{view === "fuel" && <FuelView lang={lang} />}{view === "progress" && <ProgressView dashboard={dashboard} lang={lang} />}{view === "more" && <ExtrasView lang={lang} role={dashboard.viewer.role} />}{view === "role" && <RoleView dashboard={dashboard} lang={lang} onOpenPlan={openPlan} />}{view === "settings" && <ProfileView lang={lang} onBack={() => setView("today")} onLangChange={setLang} />}</div><nav className="bottom-nav" aria-label={t(lang, "nav_aria")}>{navigation.map((item) => <button key={item} className={view === item ? "nav-item active" : "nav-item"} onClick={() => { if (item !== "plan") setPlanClientId(null); setView(item); }}><span className="nav-icon">{item === "today" ? "⌂" : item === "train" ? "◈" : item === "plan" ? "▤" : item === "fuel" ? "◌" : item === "progress" ? "↗" : item === "more" ? "✦" : "◎"}</span><span>{navLabel(lang, item)}</span></button>)}</nav></main>;
}
