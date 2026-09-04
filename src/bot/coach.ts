// Free-text AI coach: builds the data-grounded context (plan + last 14 days + cycle phase),
// answers questions, and can propose plan edits as tap-to-apply buttons — which dispatch into
// bot.ts's plan-editing functions (addExerciseByName, swapExerciseByName, setExerciseWeight,
// adjustDifficulty, ...), the same ones the manual edit flows use. A client's question instead
// routes to their human trainer with an AI-drafted reply for the trainer to send/edit/skip.
// Extracted from bot.ts (god-file split; same barrel seam via bot.ts's
// `export * from "./bot/coach"`).
import { InlineKeyboard } from "grammy";
import type { Weekday } from "../types";
import { aiJSON, aiText } from "../ai";
import * as P from "../ai/prompts";
import { createQuestion, getActivePlan, getRecentContext, getTrainer, getUser, setQuestionDraft, updateUser, workoutLogsSince } from "../db/repos";
import { computeCyclePhase, phaseHint, phaseLabel } from "../domain/cycle";
import { localParts } from "../domain/progression";
import { cleanAi, escapeHtml, t } from "../locales/i18n";
import { upcomingSessions, weekdayName } from "../render";
import { deferAi } from "./router";
import { localCutoff } from "./report";
import { trainerStyleBlock } from "./trainer";
import {
  type MyContext, HTML,
  addExerciseByName, adjustDifficulty, deleteExerciseFromToday, menuBtn, reply, setExerciseSets, setExerciseWeight,
  setMode, showSwapAlternatives, swapExerciseByName,
} from "../bot";

export async function coachContext(ctx: MyContext): Promise<string> {
  // Plan and recent logs are independent reads — fetch them together.
  const [plan, recent] = await Promise.all([
    getActivePlan(ctx.db, ctx.user._id),
    // Last 14 days of real logs so the coach grounds advice in actual numbers (not generic tips).
    getRecentContext(ctx.db, ctx.user._id, 14),
  ]);
  const { date } = localParts(ctx.user.profile.timezone);
  // Full plan with ISO weekday + 0-based exercise indices, so the coach can target any exercise.
  const planText = plan?.split.length
    ? plan.split
        .map(
          (d) =>
            `${weekdayName("en", d.weekday)}(${d.weekday}): ` +
            d.exercises.map((e, i) => `${i}:${e.name} ${e.sets} ${e.startWeight}`).join(" | "),
        )
        .join("\n")
    : "no active plan";
  const { workouts, nutrition } = recent;
  const workoutText = workouts.length
    ? workouts
        .map((w) => {
          const lifts = w.exercises
            .filter((e) => !e.skipped && e.setsDone.length)
            .map((e) => {
              const top = e.setsDone.reduce((a, b) => (b.weight >= a.weight ? b : a), e.setsDone[0]);
              return `${e.name} ${top.weight || "BW"}×${top.reps}${e.rpe ? `@${e.rpe}` : ""}`;
            })
            .join(", ");
          return `${w.date}(${w.completed ? "done" : "skip"}${lifts ? `: ${lifts}` : ""})`;
        })
        .join(" | ")
    : "none";
  const nutDays = nutrition.length;
  const avgKcal = nutDays
    ? Math.round(
        nutrition.reduce((s, n) => s + n.meals.reduce((m, x) => m + (x.kcal || 0), 0), 0) / nutDays,
      )
    : 0;
  const target = ctx.user.nutrition ? `${ctx.user.nutrition.calories}kcal` : "n/a";
  const injuries = ctx.user.profile.limitations?.trim();
  // Cycle-phase awareness (opt-in only). Injected as a compact English hint so the coach can
  // adjust load / carbs advice around the phase without needing a separate prompt.
  const cy = computeCyclePhase(ctx.user.profile, date);
  const cycleLine = cy ? `Cycle phase: ${phaseLabel(cy.phase)} (day ${cy.day}/${cy.cycleLength}) — ${phaseHint(cy.phase)}.\n` : "";
  return (
    `PLAN (weekday in parens, exercise index before colon):\n${planText}\n` +
    `Nutrition target: ${target}. Last 14d nutrition: ${nutDays} day(s) logged${nutDays ? `, avg ${avgKcal}kcal` : ""}.\n` +
    `Last 14d workouts (top set per lift): ${workoutText}.\n` +
    `${injuries ? `Injuries/limitations: ${injuries}.\n` : ""}` +
    cycleLine +
    `Training pace: ${ctx.user.progressionRate ?? "normal"}. Today: ${date}.`
  );
}

export async function handleCoach(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  // A client's question goes to their human trainer (with an AI-suggested reply).
  if (ctx.user.role === "client" && ctx.user.trainerId) {
    await routeClientQuestion(ctx, text);
    return;
  }
  await ctx.replyWithChatAction("typing").catch(() => {});
  // The coach can also propose plan edits (add/cardio, harder/easier, swap) as buttons.
  // Deferred past the webhook response — the AI chain must not block the update.
  deferAi(ctx, "coach", async () => {
    const result = await aiJSON<P.CoachEditResult>(ctx.env, {
      system: P.coachEditSystem(lang, ctx.user.profile, await coachContext(ctx)),
      user: text,
      temperature: 0.7,
      kind: "coach",
      db: ctx.db,
      userId: ctx.user._id,
    });
    const actions = (result.actions ?? []).filter((a) => a.kind !== "none").slice(0, 4);
    let kb = menuBtn(lang);
    if (actions.length) {
      kb = new InlineKeyboard();
      actions.forEach((a, i) => {
        // Stash the arg in the session (callback data is length-limited); button carries the index.
        kb.text(a.label.slice(0, 60), `cact:${a.kind}:${i}`).row();
      });
      // This runs up to ~26 s after the webhook — re-read the CURRENT session so we don't
      // clobber a mode/draft the user started while the AI was thinking.
      const fresh = await getUser(ctx.db, ctx.user._id).catch(() => null);
      const session = { ...(fresh?.session ?? ctx.user.session), coachActions: actions };
      await updateUser(ctx.db, ctx.user._id, { session });
      ctx.user.session = session;
    }
    await reply(ctx, escapeHtml(cleanAi(result.reply)), kb);
  });
}

// The plan day a coach edit targets: today's session if it's a training day, else the
// earliest upcoming session, else the first plan day.
export async function coachEditWeekday(ctx: MyContext): Promise<Weekday | null> {
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  if (!plan || !plan.split.length) return null;
  const tz = ctx.user.profile.timezone;
  const logs = (await workoutLogsSince(ctx.db, ctx.user._id, localCutoff(tz, 14))).map((l) => ({ date: l.date, completed: l.completed }));
  const sessions = upcomingSessions(ctx.user.lang, plan, tz, logs, 7);
  const today = localParts(tz).date;
  const todays = sessions.find((s) => s.date === today && s.status === "pending");
  const next = todays ?? sessions.find((s) => s.isNext);
  return (next?.weekday ?? [...plan.split].sort((a, b) => a.weekday - b.weekday)[0].weekday) as Weekday;
}

// Apply a coach-proposed plan edit when the user taps one of the action buttons.
export async function handleCoachAction(ctx: MyContext, kind: string, idx: number) {
  const lang = ctx.user.lang;
  const a = (ctx.user.session.coachActions ?? [])[idx];
  await setMode(ctx, "idle");
  if (!a) {
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
    return;
  }
  // Use the action's explicit weekday when given, else default to today's/next session.
  const weekday = (a.weekday as Weekday) || (await coachEditWeekday(ctx));
  if (!weekday) {
    await reply(ctx, t(lang, "no_plan"), menuBtn(lang));
    return;
  }
  const index = a.index ?? 0;
  if (kind === "add" && a.exercise) {
    await addExerciseByName(ctx, weekday, a.exercise);
  } else if (kind === "delete") {
    await deleteExerciseFromToday(ctx, weekday, index);
  } else if (kind === "swap") {
    if (a.exercise) await swapExerciseByName(ctx, weekday, index, a.exercise);
    else await showSwapAlternatives(ctx, weekday, index);
  } else if (kind === "weight" && a.value) {
    await setExerciseWeight(ctx, weekday, index, a.value);
  } else if (kind === "sets" && a.value) {
    await setExerciseSets(ctx, weekday, index, a.value);
  } else if (kind === "harder") {
    await adjustDifficulty(ctx, "up", weekday);
  } else if (kind === "easier") {
    await adjustDifficulty(ctx, "down", weekday);
  }
}

// Client → trainer question: store it, draft an AI answer, and ask the trainer to
// send the draft / write their own / ignore.
export async function routeClientQuestion(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const trainerId = ctx.user.trainerId!;
  const trainer = await getUser(ctx.db, trainerId);
  if (!trainer) {
    await reply(ctx, t(lang, "error_generic"));
    return;
  }
  // Persist the question FIRST (fast DB write) — the client's "sent ✅" must never outrun
  // the write; a dead isolate mid-AI must not lose the question. Only the optional AI draft
  // and the trainer notification run past the response.
  const qid = await createQuestion(ctx.db, ctx.user._id, trainerId, text, undefined);
  await reply(ctx, t(lang, "client_q_sent"), menuBtn(lang));
  deferAi(ctx, "coach", async () => {
    let draft = "";
    try {
      // Draft the suggested answer in the TRAINER's voice (their stated style/philosophy).
      const trainerDoc = await getTrainer(ctx.db, trainerId).catch(() => null);
      draft = await aiText(ctx.env, {
        system: P.coachSystem(trainer.lang, ctx.user.profile, await coachContext(ctx), trainerDoc ? trainerStyleBlock(trainerDoc) : undefined),
        user: text,
        temperature: 0.7,
        kind: "coach",
        db: ctx.db,
        userId: ctx.user._id,
      });
      if (draft) await setQuestionDraft(ctx.db, qid, draft).catch(() => {});
    } catch {
      /* AI draft is optional */
    }
    const who = escapeHtml(ctx.user.profile.name ?? `id ${ctx.user._id}`);
    const kb = new InlineKeyboard()
      .text(t(trainer.lang, "q_send"), `q:send:${qid}`)
      .text(t(trainer.lang, "q_own"), `q:own:${qid}`)
      .row()
      .text(t(trainer.lang, "q_skip"), `q:skip:${qid}`);
    const body =
      t(trainer.lang, "trainer_question", { name: who, q: escapeHtml(text) }) +
      (draft ? `\n\n🤖 <i>${escapeHtml(draft)}</i>` : "");
    await ctx.api.sendMessage(trainer.chatId, body, { ...HTML, reply_markup: kb }).catch(() => {});
  });
}
