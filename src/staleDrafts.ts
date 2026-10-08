// Trainer clients who are stuck on a plan draft. A trainer client's first plan is saved as a DRAFT
// for the trainer to review (bot/plan.ts finalizeOnboardingPlan / generateClientDraft) and stays
// invisible to the client until the trainer taps ✅ Assign. A trainer who never does leaves the
// client finished with onboarding, told "your trainer is reviewing", and with nothing to train --
// the "draft" rows in the owner roster. So, from the hourly global pass:
//  - after REMIND_H the trainer gets one reminder with the review button;
//  - WARN_BEFORE_H before the draft would go live they get one final warning, and the client card
//    offers a single "wait 3 more days" (postponeAutoActivation) that moves the deadline to
//    POSTPONED_ACTIVATE_H, so a client is never left without a plan for more than six days;
//  - at the deadline the draft is activated (the trainer can still edit it later) and both sides
//    are told;
//  - a client with no trainer any more (relationship ended, trainer deleted) gets the draft at once.
// The clock runs from the draft's creation, not its last edit: a trainer who is still working on it
// is exactly who the final warning and the postpone are for.
// Only clients with NO active plan are touched: a draft next to an active plan is a weekly
// progression proposal, which stays the trainer's call.
import type { Lang } from "./types";
import { assignDraftPlan, getOrphanDraft, listOrphanDrafts } from "./adapters/d1/v2Plans";
import { getUser } from "./adapters/d1/v2Users";
import { getSetting, setSetting } from "./adapters/d1/v2Admin";
import { escapeHtml, t } from "./locales/i18n";

export const REMIND_H = 24;
export const WARN_BEFORE_H = 6;
export const ACTIVATE_H = 72;
export const POSTPONED_ACTIVATE_H = 2 * ACTIVATE_H;
const STATE_KEY = "stale_draft_reminders";
const H = 3_600_000;

/** What the sweep remembers per draft (keyed by plan id). Older rows stored a bare ISO string, which
 * meant "reminded"; readState() upgrades them. */
export interface DraftState {
  reminded?: string;
  warned?: string;
  postponed?: string;
}

export type DraftStep = "remind" | "warn" | "activate" | null;

export function activateAfterHours(state: DraftState): number {
  return state.postponed ? POSTPONED_ACTIVATE_H : ACTIVATE_H;
}

/** What to do with a draft of this age. Pure; test/stale-drafts.test.ts. */
export function staleDraftStep(ageHours: number, hasTrainer: boolean, state: DraftState): DraftStep {
  if (!hasTrainer) return "activate";
  if (ageHours >= activateAfterHours(state)) return "activate";
  const warnAt = activateAfterHours(state) - WARN_BEFORE_H;
  // After a postponement the trainer already knows; the next message they get is the activation.
  if (!state.postponed && !state.warned && ageHours >= warnAt) return "warn";
  if (!state.reminded && !state.warned && ageHours >= REMIND_H && ageHours < warnAt) return "remind";
  return null;
}

async function readState(db: D1Database): Promise<Record<string, DraftState>> {
  const raw = await getSetting(db, STATE_KEY).catch(() => null);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, DraftState> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") out[k] = { reminded: v };
      else if (v && typeof v === "object") out[k] = v as DraftState;
    }
    return out;
  } catch {
    return {};
  }
}

async function writeState(db: D1Database, state: Record<string, DraftState>): Promise<void> {
  await setSetting(db, STATE_KEY, JSON.stringify(state)).catch(() => {});
}

/** What the client card shows for a first-plan draft that is waiting for its trainer: when it goes
 * live, and whether the one postponement is already spent. Null when there is no such draft. */
export async function autoActivationFor(db: D1Database, accountId: number): Promise<{ activatesAt: string; postponed: boolean } | null> {
  const draft = await getOrphanDraft(db, accountId);
  if (!draft) return null;
  const state = (await readState(db))[String(draft.planId)] ?? {};
  return { activatesAt: new Date(Date.parse(draft.createdAt) + activateAfterHours(state) * H).toISOString(), postponed: !!state.postponed };
}

/** The trainer's one "wait 3 more days". `no_draft` when this client has no waiting draft,
 * `already_used` when the postponement was spent. */
export async function postponeAutoActivation(db: D1Database, accountId: number, now = Date.now()): Promise<"ok" | "no_draft" | "already_used"> {
  const draft = await getOrphanDraft(db, accountId);
  if (!draft) return "no_draft";
  const state = await readState(db);
  const key = String(draft.planId);
  if (state[key]?.postponed) return "already_used";
  state[key] = { ...state[key], postponed: new Date(now).toISOString() };
  await writeState(db, state);
  return "ok";
}

/** Delivers one message and says whether it is safe: delivered, or durably queued for retry (notify.ts
 * isDurable). The sweep marks a reminder as sent only when this resolves true. */
export type Deliver = (m: { userId: number; chatId: number; kind: string; key: string; text: string; extra?: Record<string, unknown> }) => Promise<boolean>;

/** Builds the reply_markup for "open this client" (app button, or the old callback without the app). */
type ClientButton = (lang: Lang, clientId: number, fallback: string) => Record<string, unknown>;
const callbackButton: ClientButton = (lang, clientId, fallback) => ({ inline_keyboard: [[{ text: t(lang, "cc_plan"), callback_data: fallback.replace("{id}", String(clientId)) }]] });

export async function sweepStaleDrafts(
  db: D1Database, deliver: Deliver, now = Date.now(), clientButton: ClientButton = callbackButton, todayButton?: (lang: Lang) => Record<string, unknown> | undefined,
): Promise<{ reminded: number; warned: number; activated: number }> {
  const drafts = await listOrphanDrafts(db);
  const state = await readState(db);
  const next: Record<string, DraftState> = {};
  let reminded = 0, warned = 0, activated = 0;
  // A message that did not go out must not be recorded as sent: the next hourly pass tries again.
  const delivered = (p: Promise<boolean>) => p.catch(() => false);
  for (const d of drafts) {
    const key = String(d.planId);
    const mine = state[key] ?? {};
    const client = await getUser(db, d.accountId);
    if (!client || client.blocked) continue;
    const trainer = client.trainerId ? await getUser(db, client.trainerId) : null;
    const ageHours = (now - Date.parse(d.createdAt)) / H;
    const step = staleDraftStep(ageHours, !!trainer, mine);
    const who = escapeHtml(client.profile.name ?? `id ${client._id}`);
    const stamp = new Date(now).toISOString();
    const reply_markup = trainer ? clientButton(trainer.lang, client._id, "cl:{id}:plan") : undefined;
    if (step === "remind" && trainer) {
      const ok = await delivered(deliver({ userId: trainer._id, chatId: trainer.chatId, kind: "draft_remind", key: `draft_remind:${d.planId}`, text: t(trainer.lang, "draft_stale_trainer", { name: who, days: Math.round(ACTIVATE_H / 24) }), extra: { parse_mode: "HTML", reply_markup } }));
      if (ok) { next[key] = { ...mine, reminded: stamp }; reminded++; } else if (state[key]) next[key] = mine;
    } else if (step === "warn" && trainer) {
      const hours = Math.max(1, Math.round(activateAfterHours(mine) - ageHours));
      const ok = await delivered(deliver({ userId: trainer._id, chatId: trainer.chatId, kind: "draft_warn", key: `draft_warn:${d.planId}`, text: t(trainer.lang, "draft_final_trainer", { name: who, hours }), extra: { parse_mode: "HTML", reply_markup } }));
      if (ok) { next[key] = { ...mine, warned: stamp, reminded: mine.reminded ?? stamp }; warned++; } else if (state[key]) next[key] = mine;
    } else if (step === "activate") {
      if (!(await assignDraftPlan(db, client._id))) continue;
      activated++;
      await delivered(deliver({ userId: client._id, chatId: client.chatId, kind: "draft_auto_client", key: `draft_auto_client:${d.planId}`, text: t(client.lang, "draft_auto_client"), extra: { parse_mode: "HTML", ...(todayButton ? { reply_markup: todayButton(client.lang) } : {}) } }));
      if (trainer) await delivered(deliver({ userId: trainer._id, chatId: trainer.chatId, kind: "draft_auto_trainer", key: `draft_auto_trainer:${d.planId}`, text: t(trainer.lang, "draft_auto_trainer", { name: who }), extra: { parse_mode: "HTML", reply_markup } }));
    } else if (state[key]) {
      next[key] = mine; // keep the marks until the draft is gone
    }
  }
  if (JSON.stringify(next) !== JSON.stringify(state)) await writeState(db, next);
  return { reminded, warned, activated };
}
