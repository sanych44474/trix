import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { OfflineSync } from "./OfflineSync";
import { InboxBell, InboxView } from "./Inbox";
import { api, ApiError, typedBody } from "./api";
import type { RequestBody, Dashboard, RecoveryFactor, RecoveryLabel } from "./types";
import { guessLang, hasLang, loadLang, t, type Key, type Lang } from "./i18n";
import { WhatsNewCard } from "./WhatsNew";
import { BadgeCelebration, WeekCard, WeekSummaryCard } from "./Week";
import { track } from "./logic/track";
import { navigationFor, viewFromSearch, type View } from "./logic/navigation";
import { DASHBOARD_CACHE_KEY, useDashboard } from "./useDashboard";
import { useTelegramChrome } from "./useTelegramChrome";
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
// Deep-link parameters from notification buttons (src/notify/appKeyboard.ts): ?client= opens a
// client's card in the trainer workspace, ?ask= pre-fills a question for the AI coach.
const linkParams = new URLSearchParams(window.location.search);
const linkClientId = Number(linkParams.get("client")) > 0 ? Number(linkParams.get("client")) : null;
const linkAsk = linkParams.get("ask")?.slice(0, 300) || undefined;

function RoleView({ dashboard, lang, onOpenPlan }: { dashboard: Dashboard; lang: Lang; onOpenPlan: (clientId?: number) => void }) {
  return <Suspense fallback={<Loading />}><WorkspaceView dashboard={dashboard} lang={lang} onOpenPlan={onOpenPlan} initialClientId={linkClientId} /></Suspense>;
}

export { photoUrl, apiUpload, composeCompare, drawWeekCard } from "./media";

export function Loading() { return <div className="view-stack"><div className="skeleton skeleton-hero" /><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>; }

export function App() {
  const [lang, setLangState] = useState<Lang>(() => {
    try { const l = (JSON.parse(localStorage.getItem(DASHBOARD_CACHE_KEY) ?? "null") as { lang?: Lang } | null)?.lang; if (l === "en" || l === "uk") return l; } catch { /* storage is optional */ }
    return guessLang();
  });
  // Each language is its own chunk (i18n.ts): load it before switching, so no text flashes in
  // the other language.
  const setLang = (next: Lang) => { if (hasLang(next)) setLangState(next); else void loadLang(next).then(() => setLangState(next)).catch(() => setLangState(next)); };
  const [view, setView] = useState<View>(() => viewFromSearch(window.location.search));
  const [planClientId, setPlanClientId] = useState<number | null>(null);
  const { dashboard, error, loading, onboardingPending, setOnboardingPending, load: loadDashboard } = useDashboard(setLang);
  // The coach chat as its own screen, reachable from Today and the workout summary; a prefill
  // drops a ready question in the box (the user still taps send).
  const [coachPrefill, setCoachPrefill] = useState<string | undefined>(linkAsk);
  const openCoach = (prefill?: string) => { track(prefill ? "app_coach_open_summary" : "app_coach_open_today"); setCoachPrefill(prefill); setView("coach"); };
  const pullStart = useRef<number | null>(null);
  useEffect(() => { const id = setTimeout(() => { void loadTrainView().catch(() => {}); }, 1200); return () => clearTimeout(id); }, []);
  useTelegramChrome(view, setView);
  const navigation = useMemo(() => navigationFor(dashboard?.viewer.role), [dashboard?.viewer.role]);
  if (loading && !dashboard) return <main className="app-shell"><Loading /></main>;
  if (error && !dashboard) return <main className="app-shell"><ErrorState lang={lang} error={error} retry={loadDashboard} /></main>;
  if (!dashboard) return null;
  const needsOnboarding = !dashboard.viewer.onboarded && dashboard.viewer.role !== "trainer";
  if (needsOnboarding && (onboardingPending || dashboard.viewer.planPending)) return <main className="app-shell"><header className="topbar"><div className="brand-mark">T</div><div><span className="eyebrow">{t(lang, "brand_title")}</span><strong>{t(lang, "brand_subtitle")}</strong></div></header><div className="view-stack"><div className="hero"><div><span className="eyebrow hero-eyebrow">{t(lang, "ob_pending_eyebrow")}</span><h1>{t(lang, "ob_pending_title")}</h1><p>{t(lang, "ob_pending_body")}</p><p>{t(lang, "ob_plan_ready_soon")}</p></div><button className="button button-light" onClick={loadDashboard}>{t(lang, "check_status")}</button></div><Card><div className="section-head"><div><span className="eyebrow">{t(lang, "ob_pending_next_eyebrow")}</span><h2>{t(lang, "ob_pending_next_title")}</h2></div></div><p className="muted">{t(lang, "ob_pending_next_body")}</p></Card></div></main>;
  if (needsOnboarding) return <main className="app-shell"><header className="topbar"><div className="brand-mark">T</div><div><span className="eyebrow">{t(lang, "brand_title")}</span><strong>{t(lang, "brand_subtitle")}</strong></div></header><Suspense fallback={<Loading />}><OnboardingView lang={lang} isClient={dashboard.viewer.role === "client"} onLangChange={setLang} onReload={loadDashboard} onComplete={() => setOnboardingPending(true)} /></Suspense></main>;
  const onTouchStart = (event: React.TouchEvent<HTMLElement>) => { if (window.scrollY === 0) pullStart.current = event.touches[0]?.clientY ?? null; };
  const onTouchEnd = (event: React.TouchEvent<HTMLElement>) => { const start = pullStart.current; pullStart.current = null; const end = event.changedTouches[0]?.clientY ?? 0; if (start !== null && end - start > 72 && !loading) loadDashboard(); };
  const openPlan = (clientId?: number) => { setPlanClientId(clientId ?? null); setView("plan"); };
  return <main className="app-shell" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}><header className="topbar"><div className="brand-mark">T</div><div><span className="eyebrow">{t(lang, "brand_title")}</span><strong>{t(lang, "brand_subtitle")}</strong></div><button className="icon-button" onClick={loadDashboard} aria-label={t(lang, "refresh_aria")}>↻</button><InboxBell lang={lang} open={view === "inbox"} onOpen={() => setView("inbox")} /><button className="icon-button" onClick={() => setView("settings")} aria-label={t(lang, "settings_aria")}>⚙</button></header><div className="content"><OfflineSync lang={lang} />{view === "today" && <TodayView dashboard={dashboard} lang={lang} onOpen={setView} onReload={loadDashboard} onAskCoach={() => openCoach()} />}{view === "train" && <Suspense fallback={<Loading />}><TrainView lang={lang} gamification={dashboard.gamification} onAskCoach={() => openCoach(t(lang, "coach_prefill_session"))} /></Suspense>}{view === "coach" && <Suspense fallback={<Loading />}><CoachView lang={lang} routed={dashboard.viewer.role === "client"} prefill={coachPrefill} onBack={() => { setCoachPrefill(undefined); setView("today"); }} /></Suspense>}{view === "plan" && <Suspense fallback={<Loading />}><PlanView lang={lang} clientId={planClientId} canRebuild={dashboard.viewer.role !== "client"} onOpenLibrary={() => setView("library")} onBack={planClientId !== null ? () => { setPlanClientId(null); setView("role"); } : undefined} /></Suspense>}{view === "fuel" && <Suspense fallback={<Loading />}><FuelView lang={lang} /></Suspense>}{view === "progress" && <Suspense fallback={<Loading />}><ProgressView dashboard={dashboard} lang={lang} /></Suspense>}{view === "more" && <Suspense fallback={<Loading />}><ExtrasView lang={lang} role={dashboard.viewer.role} onOpenLibrary={() => setView("library")} /></Suspense>}{view === "library" && <Suspense fallback={<Loading />}><LibraryView lang={lang} onBack={() => setView("more")} /></Suspense>}{view === "role" && <RoleView dashboard={dashboard} lang={lang} onOpenPlan={openPlan} />}{view === "inbox" && <InboxView lang={lang} onBack={() => setView("today")} onGo={(target) => setView(target)} />}{view === "settings" && <Suspense fallback={<Loading />}><ProfileView lang={lang} onBack={() => setView("today")} onLangChange={setLang} /></Suspense>}</div>{dashboard.badges && <BadgeCelebration lang={lang} badges={dashboard.badges} />}<nav className="bottom-nav" aria-label={t(lang, "nav_aria")}>{navigation.map((item) => <button key={item} className={view === item ? "nav-item active" : "nav-item"} onClick={() => { if (item !== "plan") setPlanClientId(null); setView(item); }}><span className="nav-icon">{item === "today" ? "⌂" : item === "train" ? "◈" : item === "plan" ? "▤" : item === "fuel" ? "◌" : item === "progress" ? "↗" : item === "more" ? "✦" : "◎"}</span><span className="nav-label">{navLabel(lang, item)}</span></button>)}</nav></main>;
}
