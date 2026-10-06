// Building blocks and payload types shared by the Workspace screens.
import type { Dashboard, TrainerProfile } from "../types";
import { t, type Lang } from "../i18n";

export type WorkspaceProps = { dashboard: Dashboard; lang: Lang; onOpenPlan?: (clientId?: number) => void };

export type Buddy = {
  buddy: null | {
    name: string;
    level: number;
    xp: number;
    intoLevel: number;
    needed: number;
    streak: number;
    weekWorkouts: number;
    myWeekWorkouts: number;
    week: Array<{ date: string; ex: string[] }>;
    duel: { myWins: number; theirWins: number; myStreak: number };
  };
};

export type Challenges = {
  active: Array<{ code: string; emoji: string; title: string; current: number; target: number; pct: number; done: boolean; daysLeft: number }>;
  available: Array<{ code: string; emoji: string; title: string; target: number; windowDays: number }>;
  won: number;
};

export type Records = {
  records: Array<{ exercise: string; best: string; metric: string; updated: string | null }>;
  badges: Array<{ label: string; earned: boolean }>;
};

export type Boards = {
  optedIn: boolean;
  consistency?: { rank: number; total: number; top: Array<{ pos: number; name: string; value: number; detail: string; me: boolean }> };
};

export type TrainerQuestions = { questions: Array<{ id: number; clientId: number; client: string; text: string; draft: string; status: string }> };

export type TrainerRequests = { requests: Array<{ id: number; clientId: number; name: string; note: string }> };

export type TrainerTemplates = { templates: Array<{ id: number; name: string }> };

export type ClientSummary = NonNullable<Dashboard["trainer"]>["clients"][number];

export type TrainerProfilePayload = { role: string; trainer: TrainerProfile | null };

export type OwnerReport = { html: string };

export function Panel({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "accent" | "muted" }) {
  return <section className={`card card-${tone}`}>{children}</section>;
}

export function WorkspaceError({ lang, onRetry }: { lang: Lang; onRetry: () => void }) {
  return <Panel tone="muted"><div className="error-state"><strong>{t(lang, "workspace_unavailable")}</strong><button className="button button-ghost" onClick={onRetry}>{t(lang, "retry")}</button></div></Panel>;
}

export function ProgressBar({ value }: { value: number }) {
  return <div className="progress-track" aria-label={`${Math.round(value)}%`}><span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

export function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

/** Same "the webview needs a query fallback for /api/v2/photo outside real Telegram" helper as
 * ProfileView's own photoQuery -- duplicated rather than shared, matching this app's convention
 * of no cross-file context/helpers for small view-local concerns. */
export function photoQuery(): string {
  const tma = window.Telegram?.WebApp?.initData;
  if (tma) return `&tma=${encodeURIComponent(tma)}`;
  return window.location.search.replace(/^\?/, "&");
}
