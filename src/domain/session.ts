// Session state model — the single source of truth for what survives a mode change.
//
// A session is a `mode` (which screen/flow the user is in) plus two kinds of fields:
//   • CONTEXT — long-lived "who/what am I acting on" state that must persist ACROSS mode
//     changes (a trainer editing a client, a pending photo request). Listed once here.
//   • FLOW — transient state tied to the current mode (a half-entered log draft, a meal
//     awaiting confirmation, an edit target). Cleared on every mode change so no
//     half-finished flow or stale draft can leak into the next screen.
//
// Every mode switch goes through `switchMode`, so adding a new context field is a one-line
// change in ONE place — it can never again be silently dropped or silently leaked (the bug
// class behind photoReviewFor, logDraft, and editPlanPrefix loss).
import type { UserSession, SessionMode } from "../types";

// The ONLY fields that outlive a mode change. Keep this list tiny and deliberate.
export const SESSION_CONTEXT_KEYS = ["editPlanOwner", "editPlanPrefix", "photoReviewFor", "photoSelf"] as const;

/** Build the session for a new `mode`: carry the context fields, drop all flow state, then
 * apply any `extra` flow fields the new mode needs (e.g. targetId, pendingExercise). */
export function switchMode(session: UserSession, mode: SessionMode, extra?: Partial<UserSession>): UserSession {
  const next: UserSession = { mode };
  if (session.editPlanOwner !== undefined) next.editPlanOwner = session.editPlanOwner;
  if (session.editPlanPrefix !== undefined) next.editPlanPrefix = session.editPlanPrefix;
  if (session.photoReviewFor !== undefined) next.photoReviewFor = session.photoReviewFor;
  if (session.photoSelf !== undefined) next.photoSelf = session.photoSelf;
  // The evening survey checklist spans multiple sub-flows (food → steps → …); keep it alive
  // across their setMode calls so the remaining-items menu re-appears after each one.
  if (session.survey !== undefined) next.survey = session.survey;
  return extra ? { ...next, ...extra } : next;
}

/** Number of exercises in an unsaved guided-log draft, or null when there's nothing at risk.
 * The one flow whose transient state is real user data worth guarding before an exit. */
export function unsavedLogCount(session: UserSession): number | null {
  const d = session.logDraft;
  return session.mode === "log" && d && d.entries.length > 0 ? d.entries.length : null;
}
