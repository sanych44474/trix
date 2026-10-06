// Pure helpers behind the Workspace tab (trainer schedule, owner reports, the space switcher),
// kept out of the components so they are unit-testable.
import type { Key } from "../i18n";

export const statusKey = (status: string): Key =>
  status === "done" ? "session_status_done" : status === "cancelled" ? "session_status_cancelled" : status === "no_show" ? "session_status_no_show" : "session_status_planned";

/** `datetime-local` hands back a naive local string; the API stores a real instant. */
export const toInstant = (local: string) => new Date(local).toISOString();
export const showWhen = (iso: string) => iso.slice(0, 16).replace("T", " ");

// The backend already renders each section as Telegram-HTML (<b>/<i>/<pre>/<code> + newlines);
// stripped to plain text and dropped into a monospace <pre>, alignment/tables survive untouched
// (same approach the existing overview panel used before this got split into tabs).
export const plainReport = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");

/** Note-history rows store raw field keys (v2_client_note_history) -- map them to the same
 * labels the corresponding editable field already uses elsewhere in the client card. Unknown
 * fields show as-is (null here). */
export function noteFieldKey(field: string): Key | null {
  if (field === "healthNotes") return "field_health_notes";
  if (field === "personalNotes") return "field_personal_notes";
  if (field === "note") return "coach_note_title";
  return null;
}

export type Space = "social" | "trainer" | "owner";

/**
 * This tab used to return exactly ONE workspace, first match wins: owner, else trainer, else
 * social. So a trainer lost every athlete/social surface (buddy, challenges, records, board,
 * quick log, injury reporting) and an owner lost those AND the whole trainer workspace -- even
 * though a trainer trains too, and an owner is usually both. Every role now keeps every surface
 * it qualifies for; the switcher only appears when there is more than one.
 */
export function workspaceSpaces(role: string, isOwner: boolean): Array<{ id: Space; label: Key }> {
  return [
    ...(isOwner ? [{ id: "owner" as Space, label: "workspace_switch_owner" as Key }] : []),
    ...(role === "trainer" ? [{ id: "trainer" as Space, label: "workspace_switch_trainer" as Key }] : []),
    { id: "social", label: "workspace_switch_social" },
  ];
}

export type OwnerSection = "overview" | "roster" | "feedback" | "retention" | "ai" | "trainers" | "onboarding" | "errors" | "events";

export const OWNER_REPORT_SECTIONS: Array<{ id: Exclude<OwnerSection, "roster" | "feedback">; tab: Key; eyebrow: Key; title: Key }> = [
  { id: "overview", tab: "owner_tab_overview", eyebrow: "overview_eyebrow", title: "live_report_title" },
  { id: "retention", tab: "owner_tab_retention", eyebrow: "retention_report_eyebrow", title: "retention_report_title" },
  { id: "ai", tab: "owner_tab_ai", eyebrow: "ai_stats_eyebrow", title: "ai_stats_title" },
  { id: "trainers", tab: "owner_tab_trainers", eyebrow: "trainers_report_eyebrow", title: "trainers_report_title" },
  { id: "onboarding", tab: "owner_tab_onboarding", eyebrow: "onboarding_funnel_eyebrow", title: "onboarding_funnel_title" },
  { id: "errors", tab: "owner_tab_errors", eyebrow: "errors_report_eyebrow", title: "errors_report_title" },
  { id: "events", tab: "owner_tab_events", eyebrow: "events_report_eyebrow", title: "events_report_title" },
];

// Tab strip order and icons: the roster (people) first, then the reports.
export const OWNER_TABS: Array<{ id: OwnerSection; tab: Key; icon: string }> = [
  { id: "overview", tab: "owner_tab_overview", icon: "📊" },
  { id: "roster", tab: "owner_tab_roster", icon: "👥" },
  { id: "feedback", tab: "owner_tab_feedback", icon: "✍️" },
  { id: "retention", tab: "owner_tab_retention", icon: "🧲" },
  { id: "ai", tab: "owner_tab_ai", icon: "🤖" },
  { id: "trainers", tab: "owner_tab_trainers", icon: "🧑‍🏫" },
  { id: "onboarding", tab: "owner_tab_onboarding", icon: "🚪" },
  { id: "errors", tab: "owner_tab_errors", icon: "⚠️" },
  { id: "events", tab: "owner_tab_events", icon: "📈" },
];
