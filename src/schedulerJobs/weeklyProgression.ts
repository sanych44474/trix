// The Monday progression: double progression from the last 3 weeks of logs and check-ins,
// plateau and maxed-bodyweight swaps, and the conditioning hold. A solo plan is updated and the
// person told; a client's changes go to their trainer as a draft. Called by processUser.
import { recordInbox } from "../adapters/d1/v2Inbox";
import { InlineKeyboard } from "grammy";
import { type DeliveryResult } from "../schedulerOutbox";
import type { BodyLogDoc, Lang, PlanDoc, UserDoc, WorkoutLogDoc } from "../types";
import { recordPlanSource } from "../adapters/d1/v2Admin";
import { countAdjustmentWeeksSince, recordAdjustment, saveDraftPlan, setActivePlan } from "../adapters/d1/v2Plans";
import { dailyCheckinsSince } from "../adapters/d1/v2Tracking";
import { getUser } from "../adapters/d1/v2Users";
import { applyProgression, computePlanProgression, evaluateProgressionRate, fatLossGoalReached, gainGoalReached, shouldLevelUp, weeksSincePlan } from "../domain/progression";
import { conditioningOverload, conditioningWeek } from "../domain/conditioning";
import { daysBetween } from "../domain/reminderTiming";
import { escapeHtml, t } from "../locales/i18n";
import { conditioningLoadLabel } from "../render";
import { applySwaps } from "./plateauSwaps";
import { HTML, isoDaysAgo } from "./shared";
import type { Sender } from "./shared";

export interface WeeklyProgressionCtx {
  db: D1Database;
  user: UserDoc;
  lang: Lang;
  date: string;
  activePlan: PlanDoc | null;
  workouts21: () => Promise<WorkoutLogDoc[]>;
  send: (text: string, extra?: Parameters<Sender["api"]["sendMessage"]>[2]) => Promise<DeliveryResult>;
  sendTo: (target: { _id: number; chatId: number }, kind: string, text: string, extra?: Parameters<Sender["api"]["sendMessage"]>[2]) => Promise<DeliveryResult>;
  markSent: (key: string) => void;
  sent: Record<string, string>;
  sendAndMark: (key: string, text: string, extra?: Parameters<Sender["api"]["sendMessage"]>[2]) => Promise<unknown>;
  bodyAll: () => Promise<BodyLogDoc[]>;
}

export async function weeklyProgression(p: WeeklyProgressionCtx): Promise<void> {
  const { db, user, lang, date, activePlan, workouts21, send, sendTo, markSent, sent, sendAndMark, bodyAll } = p;
  markSent("progression");
  const plan = activePlan;
  if (plan && plan.split.length) {
    const [logs, checkins] = await Promise.all([
      workouts21(),
      dailyCheckinsSince(db, user._id, isoDaysAgo(7)),
    ]);
    // Conditioning counts as training load: a week deep past the aerobic high landmark holds
    // the strength increases, exactly like poor wellbeing does.
    const cond = conditioningWeek(logs, isoDaysAgo(7));
    const prog = computePlanProgression(plan, logs, checkins, { conditioningOverload: conditioningOverload(cond) });
    const week = weeksSincePlan(plan.generatedAt.toISOString().slice(0, 10), date);
    const isClient = user.role === "client" && !!user.trainerId;
    const updated = applyProgression(plan, prog.changes);
    // Act on the dynamics: plateaued lifts → fresh same-muscle variation at −10%; maxed
    // bodyweight lifts → a harder variation. Applied to the (solo) plan or the client draft.
    const swapTargets = [
      ...prog.plateau.map((n) => ({ name: n, harder: false })),
      ...prog.maxedBodyweight.map((n) => ({ name: n, harder: true })),
    ];
    const swapLines = swapTargets.length ? await applySwaps(db, lang, updated, swapTargets) : [];
    if (swapLines.length) await recordPlanSource(db, user._id, "plateau_swap", "bank").catch(() => {});
    const changed = prog.changes.length > 0 || swapLines.length > 0;
    if (changed) {
      const lineFor = (l: typeof lang) =>
        prog.changes.map((c) => t(l, "progression_line", { exercise: c.exercise, from: c.from, to: c.to }));
      if (isClient) {
        updated.authoredBy = user.trainerId;
        await saveDraftPlan(db, updated);
        await recordAdjustment(db, user._id, week, JSON.stringify(prog.changes));
        const trainer = await getUser(db, user.trainerId!);
        if (trainer) {
          const who = escapeHtml(user.profile.name ?? `id ${user._id}`);
          const text = [t(trainer.lang, "progression_trainer_header", { name: who }), ...lineFor(trainer.lang), t(trainer.lang, "progression_trainer_hint")].join("\n");
          const kb = new InlineKeyboard()
            .text(t(trainer.lang, "cc_assign"), `cl:${user._id}:assign`)
            .text(t(trainer.lang, "cc_edit"), `cl:${user._id}:edit`)
            .row()
            .text(t(trainer.lang, "cc_discard"), `cl:${user._id}:discard`);
          await sendTo(trainer, "progression_trainer", text, { ...HTML, reply_markup: kb });
        }
      } else {
        await setActivePlan(db, updated);
        await recordInbox(db, user._id, "progression", { n: prog.changes.length + swapLines.length });
        await recordAdjustment(db, user._id, week, JSON.stringify(prog.changes));
        const text = [t(lang, "progression_solo_header"), ...lineFor(lang), ...swapLines].join("\n");
        await send(text);
      }
    } else if (prog.heldForConditioning && !isClient) {
      // Say WHY nothing moved. A silent hold reads as the bot losing interest; naming the
      // cardio week that caused it is the whole point of tracking conditioning at all. Recorded
      // to plan_adjustments too (a reason-only entry -- see cmdPlanChanges), in the user's own
      // language: it's stored for THIS user's later /planchanges read, not a shared audit log.
      const heldText = t(lang, "progression_held_conditioning", { load: conditioningLoadLabel(lang, cond) });
      await recordAdjustment(db, user._id, week, JSON.stringify([{ reason: heldText }])).catch(() => {});
      await send(heldText);
    } else if (prog.heldForWellbeing && !isClient) {
      // Same idea as the conditioning hold above, for the OTHER hold reason -- this one was
      // computed every week already (poorWellbeing gates all increases) but never surfaced:
      // a silent week reads as the bot forgetting about you, not as a deliberate call.
      const heldText = t(lang, "progression_held_wellbeing");
      await recordAdjustment(db, user._id, week, JSON.stringify([{ reason: heldText }])).catch(() => {});
      await send(heldText);
    }

    // Level-up offer (solo/trainer-own only, ≤ once / 30 days): the trainee has outgrown the
    // plan (fast pace + consistent weekly progressions) → button to regenerate one tier harder.
    if (user.role !== "client" && daysBetween(sent["levelup"], date) >= 30) {
      const rate = evaluateProgressionRate(logs);
      const progWeeks = await countAdjustmentWeeksSince(db, user._id, isoDaysAgo(42));
      if (shouldLevelUp(user.profile.level ?? "beginner", rate, progWeeks)) {
        const kb = new InlineKeyboard().text(t(lang, "levelup_yes"), "levelup:yes").text(t(lang, "levelup_no"), "levelup:no");
        // The key gates this offer for the next 30 DAYS — writing it for a send that never
        // landed costs the user a month of the prompt they earned.
        await sendAndMark("levelup", t(lang, "levelup_prompt"), { ...HTML, reply_markup: kb });
      }
    }

    // Goal-reached offer (solo/trainer-own only, ≤ once / 30 days): a fat-loss cut has hit its
    // plateau → button to switch to maintenance/recomp and recompute calories.
    if (user.role !== "client" && daysBetween(sent["goalreached"], date) >= 30) {
      const weights = (await bodyAll())
        .filter((b) => typeof b.weight === "number")
        .map((b) => ({ date: b.date, weight: b.weight as number }));
      if (fatLossGoalReached(user.profile.goal, weights) || gainGoalReached(user.profile.goal, weights)) {
        const kb = new InlineKeyboard().text(t(lang, "goal_switch_yes"), "goal:maintain").text(t(lang, "levelup_no"), "goal:keep");
        // Same 30-day gate as the level-up offer above.
        await sendAndMark("goalreached", t(lang, "goal_reached_prompt"), { ...HTML, reply_markup: kb });
      }
    }
  }
}
