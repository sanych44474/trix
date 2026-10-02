// Trainer clients who are stuck on a plan draft. A trainer client's first plan is saved as a DRAFT
// for the trainer to review (bot/plan.ts finalizeOnboardingPlan / generateClientDraft) and stays
// invisible to the client until the trainer taps ✅ Assign. A trainer who never does leaves the
// client finished with onboarding, told "your trainer is reviewing", and with nothing to train —
// the "draft" rows in the owner roster. So, from the hourly global pass:
//  - after REMIND_H the trainer gets one reminder with the assign/review buttons;
//  - after ACTIVATE_H of silence the draft is activated (the trainer can still edit it later) and
//    both sides are told;
//  - a client with no trainer any more (relationship ended, trainer deleted) gets the draft at once.
// Only clients with NO active plan are touched: a draft next to an active plan is a weekly
// progression proposal, which stays the trainer's call.
import { assignDraftPlan } from "./adapters/d1/v2Plans";
import { getUser } from "./adapters/d1/v2Users";
import { getSetting, setSetting } from "./adapters/d1/v2Admin";
import { escapeHtml, t } from "./locales/i18n";

export const REMIND_H = 24;
export const ACTIVATE_H = 72;
const STATE_KEY = "stale_draft_reminders";

export type DraftStep = "remind" | "activate" | null;

/** What to do with a draft of this age. Pure; test/stale-drafts.test.ts. */
export function staleDraftStep(ageHours: number, hasTrainer: boolean, reminded: boolean): DraftStep {
  if (!hasTrainer) return "activate";
  if (ageHours >= ACTIVATE_H) return "activate";
  if (ageHours >= REMIND_H && !reminded) return "remind";
  return null;
}

/** Drafts of accounts that have no active plan (oldest first, bounded). */
export async function listOrphanDrafts(db: D1Database, limit = 50): Promise<Array<{ planId: number; accountId: number; createdAt: string }>> {
  const r = await db.prepare(`
    SELECT p.id AS planId, p.accountId AS accountId, p.createdAt AS createdAt FROM v2_plans p
    WHERE p.status = 'draft'
      AND NOT EXISTS (SELECT 1 FROM v2_plans a WHERE a.accountId = p.accountId AND a.active = 1)
    ORDER BY p.createdAt LIMIT ?`).bind(limit).all<{ planId: number; accountId: number; createdAt: string }>();
  return r.results ?? [];
}

type Send = (chatId: number, text: string, extra?: Record<string, unknown>) => Promise<unknown>;

export async function sweepStaleDrafts(db: D1Database, send: Send, now = Date.now()): Promise<{ reminded: number; activated: number }> {
  const drafts = await listOrphanDrafts(db);
  const raw = await getSetting(db, STATE_KEY).catch(() => null);
  let state: Record<string, string> = {};
  try { state = raw ? JSON.parse(raw) as Record<string, string> : {}; } catch { state = {}; }
  const next: Record<string, string> = {};
  let reminded = 0, activated = 0;
  for (const d of drafts) {
    const key = String(d.planId);
    const client = await getUser(db, d.accountId);
    if (!client || client.blocked) continue;
    const trainer = client.trainerId ? await getUser(db, client.trainerId) : null;
    const ageHours = (now - Date.parse(d.createdAt)) / 3_600_000;
    const step = staleDraftStep(ageHours, !!trainer, !!state[key]);
    const who = escapeHtml(client.profile.name ?? `id ${client._id}`);
    if (step === "remind" && trainer) {
      const reply_markup = {
        inline_keyboard: [[
          { text: t(trainer.lang, "cc_plan"), callback_data: `cl:${client._id}:plan` },
          { text: t(trainer.lang, "cc_assign"), callback_data: `cl:${client._id}:assign` },
        ]],
      };
      await send(trainer.chatId, t(trainer.lang, "draft_stale_trainer", { name: who, days: Math.round(ACTIVATE_H / 24) }), { parse_mode: "HTML", reply_markup }).catch(() => {});
      next[key] = new Date(now).toISOString();
      reminded++;
    } else if (step === "activate") {
      if (!(await assignDraftPlan(db, client._id))) continue;
      activated++;
      await send(client.chatId, t(client.lang, "draft_auto_client"), { parse_mode: "HTML" }).catch(() => {});
      if (trainer) {
        const reply_markup = { inline_keyboard: [[{ text: t(trainer.lang, "cc_plan"), callback_data: `cl:${client._id}:plan` }]] };
        await send(trainer.chatId, t(trainer.lang, "draft_auto_trainer", { name: who }), { parse_mode: "HTML", reply_markup }).catch(() => {});
      }
    } else if (state[key]) {
      next[key] = state[key]!; // keep the "reminded" mark until the draft is gone
    }
  }
  if (JSON.stringify(next) !== JSON.stringify(state)) await setSetting(db, STATE_KEY, JSON.stringify(next)).catch(() => {});
  return { reminded, activated };
}
