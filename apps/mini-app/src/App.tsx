import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { OfflineSync } from "./OfflineSync";
import { InboxBell, InboxView } from "./Inbox";
import { ApiError } from "./api";
import type { RequestBody, Dashboard } from "./types";
import { guessLang, hasLang, loadLang, t, type Key, type Lang } from "./i18n";
import { BadgeCelebration } from "./Week";
import { TodayView } from "./Today";
import { Icon, type IconName } from "./icons";
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

/** "Friday, 16 October" in the person's language, for the top bar. The weekday is formatted on
 *  its own: inside a full date ICU inflects it ("пʼятницю"), alone it is the plain name. */
function longDate(lang: Lang, iso: string): string {
  try {
    const locale = lang === "uk" ? "uk-UA" : "en-GB";
    const date = new Date(`${iso}T12:00:00Z`);
    const weekday = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(date);
    const dayMonth = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "UTC" }).format(date);
    return `${weekday.charAt(0).toLocaleUpperCase()}${weekday.slice(1)}, ${dayMonth}`;
  } catch { return iso; }
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

// PlanView's exercise.wmode is a stable code ("total"|"perSide"|"perHand", planApi.ts) rendered
// straight into a sentence -- same class of bug as the recovery/volume codes Today renders.
export const wmodeLabel = (lang: Lang, wmode: "total" | "perSide" | "perHand") =>
  t(lang, wmode === "perSide" ? "wmode_persidem" : wmode === "perHand" ? "wmode_perhandm" : "wmode_total");

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
  return <main className="app-shell" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}><header className="topbar"><div className="topbar-title"><strong>{longDate(lang, dashboard.today)}</strong>{dashboard.name && <span>{dashboard.name}</span>}</div><button className="icon-button" onClick={loadDashboard} aria-label={t(lang, "refresh_aria")}><Icon name="refresh" /></button><InboxBell lang={lang} open={view === "inbox"} onOpen={() => setView("inbox")} /><button className="icon-button" onClick={() => setView("settings")} aria-label={t(lang, "settings_aria")}><Icon name="gear" /></button></header><div className="content"><OfflineSync lang={lang} />{view === "today" && <TodayView dashboard={dashboard} lang={lang} onOpen={setView} onReload={loadDashboard} onAskCoach={() => openCoach()} />}{view === "train" && <Suspense fallback={<Loading />}><TrainView lang={lang} onAskCoach={() => openCoach(t(lang, "coach_prefill_session"))} /></Suspense>}{view === "coach" && <Suspense fallback={<Loading />}><CoachView lang={lang} routed={dashboard.viewer.role === "client"} prefill={coachPrefill} onBack={() => { setCoachPrefill(undefined); setView("today"); }} /></Suspense>}{view === "plan" && <Suspense fallback={<Loading />}><PlanView lang={lang} clientId={planClientId} canRebuild={dashboard.viewer.role !== "client"} onOpenLibrary={() => setView("library")} onBack={planClientId !== null ? () => { setPlanClientId(null); setView("role"); } : undefined} /></Suspense>}{view === "fuel" && <Suspense fallback={<Loading />}><FuelView lang={lang} /></Suspense>}{view === "progress" && <Suspense fallback={<Loading />}><ProgressView dashboard={dashboard} lang={lang} /></Suspense>}{view === "more" && <Suspense fallback={<Loading />}><ExtrasView lang={lang} role={dashboard.viewer.role} onOpenLibrary={() => setView("library")} /></Suspense>}{view === "library" && <Suspense fallback={<Loading />}><LibraryView lang={lang} onBack={() => setView("more")} /></Suspense>}{view === "role" && <RoleView dashboard={dashboard} lang={lang} onOpenPlan={openPlan} />}{view === "inbox" && <InboxView lang={lang} onBack={() => setView("today")} onGo={(target) => setView(target)} />}{view === "settings" && <Suspense fallback={<Loading />}><ProfileView lang={lang} onBack={() => setView("today")} onLangChange={setLang} /></Suspense>}</div>{dashboard.badges && <BadgeCelebration lang={lang} badges={dashboard.badges} />}<nav className="bottom-nav" aria-label={t(lang, "nav_aria")}>{navigation.map((item) => <button key={item} type="button" className={view === item ? "nav-item active" : "nav-item"} aria-current={view === item ? "page" : undefined} onClick={() => { if (item !== "plan") setPlanClientId(null); track(`app_nav_${item}`); setView(item); }}><span className="nav-icon"><Icon name={item as IconName} /></span><span className="nav-label">{navLabel(lang, item)}</span></button>)}</nav></main>;
}
