import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { OfflineSync } from "./OfflineSync";
import { InboxBell, InboxView } from "./Inbox";
import { registerLearnedMuscles } from "./logic/exerciseMuscles";
import { api, ApiError, typedBody } from "./api";
import type { RequestBody, Dashboard, RecoveryFactor, RecoveryLabel, WeekCardResponse } from "./types";
import { guessLang, hasLang, loadLang, t, type Key, type Lang } from "./i18n";
import { WhatsNewCard } from "./WhatsNew";
import { BadgeCelebration, WeekCard, WeekSummaryCard } from "./Week";
import { track } from "./logic/track";
const WorkspaceView = lazy(() => import("./Workspace").then((m) => ({ default: m.WorkspaceView })));
const OnboardingView = lazy(() => import("./Onboarding").then((m) => ({ default: m.OnboardingView })));
const ProfileView = lazy(() => import("./ProfileView").then((m) => ({ default: m.ProfileView })));
const ProgressView = lazy(() => import("./ProgressView").then((m) => ({ default: m.ProgressView })));
const FuelView = lazy(() => import("./FuelView").then((m) => ({ default: m.FuelView })));
const PlanView = lazy(() => import("./PlanView").then((m) => ({ default: m.PlanView })));
const ExtrasView = lazy(() => import("./ExtrasView").then((m) => ({ default: m.ExtrasView })));
// The logger is its own chunk but fetched right after the first paint (below), so opening it is
// instant; the service worker precaches every chunk, so it works offline too.
const loadTrainView = () => import("./TrainView");
const TrainView = lazy(() => loadTrainView().then((m) => ({ default: m.TrainView })));
const CoachView = lazy(() => import("./workspace/AiCoachView").then((m) => ({ default: m.AiCoachView })));
const LibraryView = lazy(() => import("./Library").then((m) => ({ default: m.LibraryView })));

type View = "today" | "train" | "plan" | "fuel" | "progress" | "role" | "more" | "settings" | "library" | "inbox" | "coach";

function viewFromLocation(): View {
  const raw = new URLSearchParams(window.location.search).get("view") ?? new URLSearchParams(window.location.search).get("startapp");
  const aliases: Record<string, View> = { home: "today", log: "train", workout: "train", survey: "progress", nutrition: "fuel", food: "fuel", profile: "settings", owner: "role", chat: "coach", ask: "coach" };
  const value = raw ? aliases[raw] ?? (raw as View) : "today";
  return ["today", "train", "plan", "fuel", "progress", "role", "more", "settings", "library", "coach"].includes(value) ? value : "today";
}

function navLabel(lang: Lang, view: View): string {
  return t(lang, view === "today" ? "nav_today" : view === "train" ? "nav_train" : view === "plan" ? "nav_plan" : view === "fuel" ? "nav_fuel" : view === "progress" ? "nav_progress" : view === "role" ? "nav_role" : view === "more" ? "nav_more" : "nav_settings");
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
}

export function Card({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "accent" | "muted" }) {
  return <section className={`card card-${tone}`}>{children}</section>;
}

export function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

export function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="empty"><span className="empty-mark">—</span><strong>{title}</strong><small>{detail}</small></div>;
}

export function ErrorState({ lang, error, retry }: { lang: Lang; error: unknown; retry: () => void }) {
  const message = error instanceof ApiError && error.code === "unauthorized" ? t(lang, "unauthorized_error") : t(lang, "generic_error");
  return <Card tone="muted"><div className="error-state"><strong>{message}</strong><button className="button button-ghost" onClick={retry}>{t(lang, "retry")}</button></div></Card>;
}

// The dashboard sends stable recovery codes (src/domain/recovery.ts), never prose -- rendered here.
const recoveryLabel = (lang: Lang, label: RecoveryLabel) => t(lang, `recovery_label_${label}` as Key);
const recoveryFactor = (lang: Lang, factor: RecoveryFactor) => t(lang, `recovery_factor_${factor.code}` as Key, { n: factor.count ?? 0 });

// PlanView's exercise.wmode is a stable code ("total"|"perSide"|"perHand", planApi.ts) rendered
// straight into a sentence -- same class of bug as the recovery/volume codes above.
export const wmodeLabel = (lang: Lang, wmode: "total" | "perSide" | "perHand") =>
  t(lang, wmode === "perSide" ? "wmode_persidem" : wmode === "perHand" ? "wmode_perhandm" : "wmode_total");

// "Chest is still recovering -- swap today with Thursday's legs?" (dashboard.recoverySwap, computed
// server-side from the plan and recent logs). One tap trades the two plan days' weekdays.
function RecoverySwapCard({ lang, swap, onDone }: { lang: Lang; swap: NonNullable<Dashboard["recoverySwap"]>; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  const muscles = swap.tired.map((slug) => t(lang, `muscle_${slug.replace("-", "_")}` as Key).toLowerCase()).join(", ");
  const apply = async () => {
    setBusy(true); setError(null);
    try {
      await api("/api/v2/plan", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"editPlan">({ action: "dayswap", weekday: swap.weekday, other: swap.other }) });
      onDone();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return <Card tone="accent">
    <div className="section-head"><div><span className="eyebrow">{t(lang, "rswap_eyebrow")}</span><h2>{t(lang, "rswap_title", { muscles })}</h2></div></div>
    <p>{t(lang, "rswap_body", { because: swap.because.join(", "), other: t(lang, WEEKDAY_KEYS[swap.other - 1]), otherGroup: swap.otherGroup, todayGroup: swap.todayGroup })}</p>
    {error !== null && <p className="muted">{t(lang, "generic_error")}</p>}
    <div className="button-row">
      <button className="button button-primary" disabled={busy} onClick={() => void apply()}>{busy ? t(lang, "saving_ellipsis") : t(lang, "rswap_btn", { other: t(lang, WEEKDAY_KEYS[swap.other - 1]) })}</button>
      <button className="button button-ghost" disabled={busy} onClick={() => setDismissed(true)}>{t(lang, "rswap_keep")}</button>
    </div>
  </Card>;
}

function TodayView({ dashboard, lang, onOpen, onReload, onAskCoach }: { dashboard: Dashboard; lang: Lang; onOpen: (view: View) => void; onReload: () => void; onAskCoach: () => void }) {
  const stats = dashboard.todayStats;
  const recovery = dashboard.recovery;
  const workoutCount = dashboard.calendar.logs.filter((log) => log.date === dashboard.today && log.done).length;
  const hasExercises = !!dashboard.logForm?.exercises?.length;
  const rings = [
    { label: t(lang, "metric_sessions"), value: workoutCount, goal: Math.max(1, dashboard.calendar.split.filter((day) => day.weekday > 0).length || 3) },
    { label: t(lang, "metric_water"), value: stats?.waterMl ?? 0, goal: stats?.waterGoal ?? 2000, suffix: ` ${t(lang, "unit_ml")}` },
    { label: t(lang, "metric_steps"), value: stats?.steps ?? 0, goal: stats?.stepsGoal ?? 8000 },
  ];
  return <div className="view-stack">
    <div className="eyebrow">{dashboard.today}</div>
    <div className="hero">
      <div><span className="eyebrow hero-eyebrow">{t(lang, "today_hero_eyebrow")}</span><h1>{dashboard.name ? t(lang, "today_greeting", { name: dashboard.name }) : t(lang, "today_ready")}</h1><p>{hasExercises ? t(lang, "today_exercises_waiting", { n: dashboard.logForm!.exercises.length }) : t(lang, "today_momentum")}</p></div>
      <button className="button button-light" onClick={() => onOpen("train")}>{hasExercises ? t(lang, "start_session") : t(lang, "open_training")}</button>
    </div>
    {dashboard.whatsnew && <WhatsNewCard lang={lang} version={dashboard.whatsnew.version} text={dashboard.whatsnew.text} />}
    {dashboard.recoverySwap && <RecoverySwapCard lang={lang} swap={dashboard.recoverySwap} onDone={onReload} />}
    <WeekSummaryCard lang={lang} dashboard={dashboard} />
    {dashboard.week && <WeekCard lang={lang} week={dashboard.week} />}
    <button type="button" className="coach-entry" onClick={onAskCoach}><span aria-hidden="true">💬</span><span><strong>{t(lang, dashboard.viewer.role === "client" ? "ask_trainer_nav_btn" : "coach_entry_title")}</strong><small>{t(lang, "coach_entry_detail")}</small></span><span aria-hidden="true">›</span></button>
    <div className="metric-grid">
      <Metric label={t(lang, "metric_recovery")} value={`${recovery.score}`} detail={recoveryLabel(lang, recovery.label)} />
      <Metric label={t(lang, "metric_streak")} value={t(lang, "streak_weeks", { n: dashboard.gamification?.streak ?? 0 })} detail={t(lang, "level_n", { n: dashboard.gamification?.level ?? 1 })} />
      <Metric label={t(lang, "metric_sessions")} value={`${workoutCount}`} detail={t(lang, "today_detail")} />
    </div>
    <Card><div className="section-head"><div><span className="eyebrow">{t(lang, "activity_rings_eyebrow")}</span><h2>{t(lang, "activity_rings_title")}</h2></div><button className="text-button" onClick={() => onOpen("progress")}>{t(lang, "details_arrow")}</button></div><div className="ring-grid">{rings.map((ring) => { const pct = Math.min(100, Math.round((ring.value / Math.max(1, ring.goal)) * 100)); return <div className="ring-item" key={ring.label}><div className="ring" style={{ background: `conic-gradient(var(--accent) ${pct}%, var(--surface-2) 0)` }}><div><strong>{pct}%</strong><small>{ring.value}{ring.suffix ?? ""}</small></div></div><span>{ring.label}</span></div>; })}</div></Card>
    <Card>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "readiness_eyebrow")}</span><h2>{recoveryLabel(lang, recovery.label)}</h2></div><span className={`status-dot status-${recovery.score >= 70 ? "good" : recovery.score >= 45 ? "warn" : "bad"}`} /></div>
      {recovery.factors.length ? <ul className="factor-list">{recovery.factors.slice(0, 3).map((factor) => <li key={factor.code}>{recoveryFactor(lang, factor)}</li>)}</ul> : <p className="muted">{t(lang, "no_recovery_blockers")}</p>}
    </Card>
    {stats && <Card><div className="section-head"><div><span className="eyebrow">{t(lang, "daily_load_eyebrow")}</span><h2>{t(lang, "small_actions_count")}</h2></div><button className="text-button" onClick={() => onOpen("progress")}>{t(lang, "details_arrow")}</button></div><div className="metric-grid compact"><Metric label={t(lang, "metric_water")} value={`${formatNumber(stats.waterMl)} ${t(lang, "unit_ml")}`} detail={t(lang, "goal_ml", { n: formatNumber(stats.waterGoal) })} /><Metric label={t(lang, "metric_steps")} value={formatNumber(stats.steps)} detail={t(lang, "goal_n", { n: formatNumber(stats.stepsGoal) })} /></div></Card>}
    <Card tone="accent"><div className="section-head"><div><span className="eyebrow">{t(lang, "nba_eyebrow")}</span><h2>{hasExercises ? t(lang, "nba_log_session") : t(lang, "nba_keep_baseline")}</h2></div><span className="action-arrow">↗</span></div><p>{hasExercises ? t(lang, "nba_evidence") : t(lang, "nba_open_plan")}</p><div className="button-row"><button className="button button-light" onClick={() => onOpen(hasExercises ? "train" : "plan")}>{hasExercises ? t(lang, "log_workout") : t(lang, "review_plan")}</button><button className="button button-outline-light" onClick={() => onOpen("fuel")}>{t(lang, "fuel_btn")}</button></div></Card>
  </div>;
}

export type PlanAction = "weight" | "sets" | "del" | "move" | "swap" | "add" | "link" | "video";
// The plan-edit request body straight from the contract, so every field name the editor sends
// is checked against what the handler declares it reads.
export type PlanEditBody = RequestBody<"editPlan">;
// The muscle-group templates a new day can be filled from, straight off the contract so this
// list cannot drift from the server's DAY_GROUPS table.
export type DayGroup = NonNullable<PlanEditBody["group"]>;
export const DAY_GROUPS: DayGroup[] = ["chest", "back", "legs", "shoulders", "arms", "full", "core"];
// Same order/keys Onboarding.tsx uses, index 0 = Monday = weekday 1.
export const WEEKDAY_KEYS: Key[] = ["weekday_mon", "weekday_tue", "weekday_wed", "weekday_thu", "weekday_fri", "weekday_sat", "weekday_sun"];

// The plan has exercises needing gear outside the owner's equipment (a dumbbells-only person with
// barbell work): one tap swaps them all for same-muscle ones they can do, or changes the
// equipment first if the profile answer was wrong.
export const EQUIPMENT_CHOICES: Array<[NonNullable<PlanEditBody["equipment"]>, Key]> = [["full gym", "equip_full_gym"], ["home basics (dumbbells, bands)", "equip_home_basics"], ["dumbbells only", "equip_dumbbells_only"], ["bodyweight only", "equip_bodyweight_only"]];
function RoleView({ dashboard, lang, onOpenPlan }: { dashboard: Dashboard; lang: Lang; onOpenPlan: (clientId?: number) => void }) {
  return <Suspense fallback={<Loading />}><WorkspaceView dashboard={dashboard} lang={lang} onOpenPlan={onOpenPlan} /></Suspense>;
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

export function photoUrl(id: number): string {
  return `/api/v2/photo?id=${id}${photoQuery()}`;
}

/** api() forces an "application/json" Content-Type on any request body, which corrupts a
 * multipart FormData upload (the browser needs to set its own boundary) -- so the two
 * image-upload endpoints (weekcard/photocompare) go through this instead, mirroring api()'s
 * auth/envelope handling but never touching Content-Type. */
export async function apiUpload(path: string, form: FormData): Promise<{ ok: boolean }> {
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
export async function composeCompare(urlA: string, urlB: string): Promise<Blob | null> {
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
export function drawWeekCard(lang: Lang, stats: NonNullable<WeekCardResponse["stats"]>, name: string): HTMLCanvasElement {
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

export function Loading() { return <div className="view-stack"><div className="skeleton skeleton-hero" /><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>; }

export function App() {
  const [lang, setLangState] = useState<Lang>(() => {
    try { const l = (JSON.parse(localStorage.getItem("trix:v2:dashboard") ?? "null") as { lang?: Lang } | null)?.lang; if (l === "en" || l === "uk") return l; } catch { /* storage is optional */ }
    return guessLang();
  });
  // Each language is its own chunk (i18n.ts): load it before switching, so no text flashes in
  // the other language.
  const setLang = (next: Lang) => { if (hasLang(next)) setLangState(next); else void loadLang(next).then(() => setLangState(next)).catch(() => setLangState(next)); };
  const [view, setView] = useState<View>(() => viewFromLocation()); const [planClientId, setPlanClientId] = useState<number | null>(null); const [dashboard, setDashboard] = useState<Dashboard | null>(null); const [error, setError] = useState<unknown>(null); const [loading, setLoading] = useState(true); const [onboardingPending, setOnboardingPending] = useState(false);
  // The coach chat as its own screen, reachable from Today and the workout summary; a prefill
  // drops a ready question in the box (the user still taps send).
  const [coachPrefill, setCoachPrefill] = useState<string | undefined>(undefined);
  const openCoach = (prefill?: string) => { track(prefill ? "app_coach_open_summary" : "app_coach_open_today"); setCoachPrefill(prefill); setView("coach"); };
  const pullStart = useRef<number | null>(null);
  const loadDashboard = () => { setLoading(true); setError(null); api<Dashboard>("/api/v2/dashboard").then((data) => { registerLearnedMuscles(data.calendar?.learnedMuscles ?? []); setDashboard(data); setLang(data.lang); try { localStorage.setItem("trix:v2:dashboard", JSON.stringify(data)); } catch { /* cache is optional */ } }).catch(setError).finally(() => setLoading(false)); };
  useEffect(() => { try { const cached = localStorage.getItem("trix:v2:dashboard"); if (cached) { const data = JSON.parse(cached) as Dashboard; if (data?.viewer && data?.today) { registerLearnedMuscles(data.calendar?.learnedMuscles ?? []); setDashboard(data); setLang(data.lang); setLoading(false); } } } catch { try { localStorage.removeItem("trix:v2:dashboard"); } catch { /* storage is optional */ } } loadDashboard(); }, []);
  useEffect(() => { const id = setTimeout(() => { void loadTrainView().catch(() => {}); }, 1200); return () => clearTimeout(id); }, []);
  // While the plan is being built, re-check every few seconds and switch over by itself.
  const waitingForPlan = !!dashboard && !dashboard.viewer.onboarded && (onboardingPending || !!dashboard.viewer.planPending);
  useEffect(() => {
    if (!waitingForPlan) return;
    const id = setInterval(() => { api<Dashboard>("/api/v2/dashboard").then((data) => { if (data.viewer.onboarded) { setOnboardingPending(false); setDashboard(data); } }).catch(() => {}); }, 4000);
    return () => clearInterval(id);
  }, [waitingForPlan]);

  useEffect(() => { const scheme = window.Telegram?.WebApp?.colorScheme; if (scheme) document.documentElement.dataset.theme = scheme; }, []);
  useEffect(() => { const handler = (event: MouseEvent) => { if ((event.target as HTMLElement).closest("button")) window.Telegram?.WebApp.HapticFeedback?.impactOccurred("light"); }; document.addEventListener("click", handler); return () => document.removeEventListener("click", handler); }, []);
  // Telegram's own "Settings" item in the Mini App's ⋮ menu (SettingsButton, 7.0+) opens our settings.
  useEffect(() => { const sb = window.Telegram?.WebApp.SettingsButton; if (!sb) return; const open = () => setView("settings"); sb.show(); sb.onClick(open); return () => sb.offClick(open); }, []);
  useEffect(() => { const back = window.Telegram?.WebApp.BackButton; if (!back) return; if (view === "today") { back.hide(); return; } const handler = () => setView("today"); back.show(); back.onClick(handler); return () => back.offClick(handler); }, [view]);
  const navigation = useMemo(() => dashboard?.viewer.role === "trainer" || dashboard?.viewer.role === "solo" || dashboard?.viewer.role === "client" ? ["today", "train", "plan", "fuel", "progress", "more", "role"] as View[] : ["today", "role"] as View[], [dashboard?.viewer.role]);
  if (loading && !dashboard) return <main className="app-shell"><Loading /></main>;
  if (error && !dashboard) return <main className="app-shell"><ErrorState lang={lang} error={error} retry={loadDashboard} /></main>;
  if (!dashboard) return null;
  const needsOnboarding = !dashboard.viewer.onboarded && dashboard.viewer.role !== "trainer";
  if (needsOnboarding && (onboardingPending || dashboard.viewer.planPending)) return <main className="app-shell"><header className="topbar"><div className="brand-mark">T</div><div><span className="eyebrow">{t(lang, "brand_title")}</span><strong>{t(lang, "brand_subtitle")}</strong></div></header><div className="view-stack"><div className="hero"><div><span className="eyebrow hero-eyebrow">{t(lang, "ob_pending_eyebrow")}</span><h1>{t(lang, "ob_pending_title")}</h1><p>{t(lang, "ob_pending_body")}</p><p>{t(lang, "ob_plan_ready_soon")}</p></div><button className="button button-light" onClick={loadDashboard}>{t(lang, "check_status")}</button></div><Card><div className="section-head"><div><span className="eyebrow">{t(lang, "ob_pending_next_eyebrow")}</span><h2>{t(lang, "ob_pending_next_title")}</h2></div></div><p className="muted">{t(lang, "ob_pending_next_body")}</p></Card></div></main>;
  if (needsOnboarding) return <main className="app-shell"><header className="topbar"><div className="brand-mark">T</div><div><span className="eyebrow">{t(lang, "brand_title")}</span><strong>{t(lang, "brand_subtitle")}</strong></div></header><Suspense fallback={<Loading />}><OnboardingView lang={lang} isClient={dashboard.viewer.role === "client"} onLangChange={setLang} onReload={loadDashboard} onComplete={() => setOnboardingPending(true)} /></Suspense></main>;
  const onTouchStart = (event: React.TouchEvent<HTMLElement>) => { if (window.scrollY === 0) pullStart.current = event.touches[0]?.clientY ?? null; };
  const onTouchEnd = (event: React.TouchEvent<HTMLElement>) => { const start = pullStart.current; pullStart.current = null; const end = event.changedTouches[0]?.clientY ?? 0; if (start !== null && end - start > 72 && !loading) loadDashboard(); };
  const openPlan = (clientId?: number) => { setPlanClientId(clientId ?? null); setView("plan"); };
  return <main className="app-shell" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}><header className="topbar"><div className="brand-mark">T</div><div><span className="eyebrow">{t(lang, "brand_title")}</span><strong>{t(lang, "brand_subtitle")}</strong></div><button className="icon-button" onClick={loadDashboard} aria-label={t(lang, "refresh_aria")}>↻</button><InboxBell lang={lang} open={view === "inbox"} onOpen={() => setView("inbox")} /><button className="icon-button" onClick={() => setView("settings")} aria-label={t(lang, "settings_aria")}>⚙</button></header><div className="content"><OfflineSync lang={lang} />{view === "today" && <TodayView dashboard={dashboard} lang={lang} onOpen={setView} onReload={loadDashboard} onAskCoach={() => openCoach()} />}{view === "train" && <Suspense fallback={<Loading />}><TrainView lang={lang} gamification={dashboard.gamification} onAskCoach={() => openCoach(t(lang, "coach_prefill_session"))} /></Suspense>}{view === "coach" && <Suspense fallback={<Loading />}><CoachView lang={lang} routed={dashboard.viewer.role === "client"} prefill={coachPrefill} onBack={() => { setCoachPrefill(undefined); setView("today"); }} /></Suspense>}{view === "plan" && <Suspense fallback={<Loading />}><PlanView lang={lang} clientId={planClientId} onOpenLibrary={() => setView("library")} onBack={planClientId !== null ? () => { setPlanClientId(null); setView("role"); } : undefined} /></Suspense>}{view === "fuel" && <Suspense fallback={<Loading />}><FuelView lang={lang} /></Suspense>}{view === "progress" && <Suspense fallback={<Loading />}><ProgressView dashboard={dashboard} lang={lang} /></Suspense>}{view === "more" && <Suspense fallback={<Loading />}><ExtrasView lang={lang} role={dashboard.viewer.role} onOpenLibrary={() => setView("library")} /></Suspense>}{view === "library" && <Suspense fallback={<Loading />}><LibraryView lang={lang} onBack={() => setView("more")} /></Suspense>}{view === "role" && <RoleView dashboard={dashboard} lang={lang} onOpenPlan={openPlan} />}{view === "inbox" && <InboxView lang={lang} onBack={() => setView("today")} onGo={(target) => setView(target)} />}{view === "settings" && <Suspense fallback={<Loading />}><ProfileView lang={lang} onBack={() => setView("today")} onLangChange={setLang} /></Suspense>}</div>{dashboard.badges && <BadgeCelebration lang={lang} badges={dashboard.badges} />}<nav className="bottom-nav" aria-label={t(lang, "nav_aria")}>{navigation.map((item) => <button key={item} className={view === item ? "nav-item active" : "nav-item"} onClick={() => { if (item !== "plan") setPlanClientId(null); setView(item); }}><span className="nav-icon">{item === "today" ? "⌂" : item === "train" ? "◈" : item === "plan" ? "▤" : item === "fuel" ? "◌" : item === "progress" ? "↗" : item === "more" ? "✦" : "◎"}</span><span className="nav-label">{navLabel(lang, item)}</span></button>)}</nav></main>;
}
