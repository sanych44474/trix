// Free-text AI coach: builds the data-grounded context (plan + last 14 days + cycle phase),
// answers questions, and can propose plan edits as tap-to-apply buttons — which dispatch into
// bot.ts's plan-editing functions (addExerciseByName, swapExerciseByName, setExerciseWeight,
// adjustDifficulty, ...), the same ones the manual edit flows use. A client's question instead
// routes to their human trainer with an AI-drafted reply for the trainer to send/edit/skip.
// Extracted from bot.ts (god-file split; same barrel seam via bot.ts's
// `export * from "./bot/coach"`).
import { InlineKeyboard } from "grammy";
import type { UserDoc, Weekday } from "../types";
import { aiJSON, aiText } from "../ai";
import * as P from "../ai/prompts";
import { getRecentContext } from "../adapters/d1/v2Admin";
import { workoutLogsSince } from "../adapters/d1/v2Workouts";
import { getActivePlan, recentAdjustments } from "../adapters/d1/v2Plans";
import { createQuestion, getTrainer, setQuestionDraft } from "../adapters/d1/v2Trainer";
import { getUser, updateUser } from "../adapters/d1/v2Users";
import { computeCyclePhase, phaseHint, phaseLabel } from "../domain/cycle";
import { phaseGuidance } from "../domain/mesocycle";
import { bestSetForMetric, formatSetEntry, localParts, metricOfSets } from "../domain/progression";
import { CONDITIONING_LANDMARK, conditioningWeek } from "../domain/conditioning";
import { recentCoachingReasons } from "../domain/coachMemory";
import { validateCoachActionForApply, validateCoachEditResult } from "../domain/coachActions";
import { cleanAi, escapeHtml, t } from "../locales/i18n";
import { upcomingSessions, weekdayName } from "../render";
import { deferAi } from "./router";
import { localCutoff } from "./report";
import { trainerStyleBlock } from "../features/trainer/trainer";
import { type MyContext, HTML, planOwnerId, reply, setMode } from "../adapters/telegram/context";
import { addExerciseByName, adjustDifficulty, deleteExerciseFromToday, menuBtn, setExerciseSets, setExerciseWeight, showSwapAlternatives, swapExerciseByName } from "../bot";

// `owner` is whose plan/history the coach reasons about — the operator themselves when
// self-coaching, or the managed client when a trainer is editing that client's plan (see
// handleCoach, which resolves it via planOwnerId). Everything here reads from `owner`, not
// `ctx.user`, so a trainer coaching a client gets THAT client's data, not their own.
export async function coachContext(ctx: MyContext, owner: UserDoc): Promise<string> {
  // Plan and recent logs are independent reads — fetch them together.
  const [plan, recent] = await Promise.all([
    getActivePlan(ctx.db, owner._id),
    // Last 14 days of real logs so the coach grounds advice in actual numbers (not generic tips).
    getRecentContext(ctx.db, owner._id, 14),
  ]);
  const { date } = localParts(owner.profile.timezone);
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
              // Cardio has no top *weight* — reduced by weight it printed as "Rowing BW×0", which
              // told the coach nothing. Render each exercise on the axis it was actually logged on.
              const metric = metricOfSets(e.setsDone);
              if (metric !== "reps") {
                const best = bestSetForMetric(e.setsDone, metric) ?? e.setsDone[0];
                return `${e.name} ${formatSetEntry(best)}${e.rpe ? `@${e.rpe}` : ""}`;
              }
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
  const target = owner.nutrition ? `${owner.nutrition.calories}kcal` : "n/a";
  const injuries = owner.profile.limitations?.trim();
  // Cycle-phase awareness (opt-in only). Injected as a compact English hint so the coach can
  // adjust load / carbs advice around the phase without needing a separate prompt.
  const cy = computeCyclePhase(owner.profile, date);
  const cycleLine = cy ? `Cycle phase: ${phaseLabel(cy.phase)} (day ${cy.day}/${cy.cycleLength}) — ${phaseHint(cy.phase)}.\n` : "";
  // Same block-periodization state the scheduler advances weekly (domain/mesocycle.ts) — lets
  // the coach explain "why is my plan built this way" grounded in the actual phase driving it,
  // instead of guessing a rationale disconnected from what the plan generator actually did.
  // Conditioning load for the week — the coach used to see only barbell work and would happily
  // suggest "add a couple of runs" to someone already 5 sessions deep.
  const cond = conditioningWeek(workouts, localCutoff(owner.profile.timezone, 7));
  const condLine = `Conditioning last 7d: ${cond.sessions} session(s)${cond.minutes ? `, ~${cond.minutes} min` : ""}${cond.meters ? `, ${Math.round(cond.meters / 100) / 10} km` : ""} (zone: ${cond.zone}; aerobic baseline ${CONDITIONING_LANDMARK.targetMin} min/wk, high ${CONDITIONING_LANDMARK.highMin} min/wk).\n`;
  const meso = plan?.mesocycle;
  const mesoLine = meso
    ? `Mesocycle: ${meso.phase} phase, week ${meso.weekInBlock}/${meso.blockLength} (target ${phaseGuidance(meso.phase).reps} reps @ ${phaseGuidance(meso.phase).intensity}).\n`
    : "";
  // Long-term memory: the recent, deduplicated "why" behind past plan adjustments (see
  // domain/coachMemory.ts) -- lets the coach say "still building back up after that light week"
  // instead of re-deriving a rationale from scratch on every question, or contradicting a
  // decision it already made. Capped and deduplicated on purpose: a full adjustment history
  // dump would bury the actually-relevant recent reasons in noise.
  const pastReasons = recentCoachingReasons(await recentAdjustments(ctx.db, owner._id, 5).catch(() => []));
  const memoryLine = pastReasons.length ? `Recent coaching decisions: ${pastReasons.join("; ")}.\n` : "";
  return (
    `PLAN (weekday in parens, exercise index before colon):\n${planText}\n` +
    `Nutrition target: ${target}. Last 14d nutrition: ${nutDays} day(s) logged${nutDays ? `, avg ${avgKcal}kcal` : ""}.\n` +
    `Last 14d workouts (top set per lift): ${workoutText}.\n` +
    `${injuries ? `Injuries/limitations: ${injuries}.\n` : ""}` +
    cycleLine +
    condLine +
    mesoLine +
    memoryLine +
    `Training pace: ${owner.progressionRate ?? "normal"}. Today: ${date}.`
  );
}

export async function handleCoach(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  // A client's question goes to their human trainer (with an AI-suggested reply).
  if (ctx.user.role === "client" && ctx.user.trainerId) {
    await routeClientQuestion(ctx, text);
    return;
  }
  // A trainer chatting while editing a client's plan (isEditingOther, see router.ts) coaches
  // THAT client: the AI needs the client's plan/history/profile to ground advice in, not the
  // trainer's own. Actions the trainer taps still route through the same planOwnerId-aware
  // apply functions (applyCatalogExerciseChoice, setExerciseWeight/Sets), which already write to
  // the client's plan and run the item-7 injury-conflict gate — only the CONTEXT the AI reasons
  // from was wrong before this. Reply stays in the trainer's own language: they're the reader.
  const ownerId = planOwnerId(ctx);
  const owner = ownerId === ctx.user._id ? ctx.user : await getUser(ctx.db, ownerId);
  if (!owner) {
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
    return;
  }
  await ctx.replyWithChatAction("typing").catch(() => {});
  // The coach can also propose plan edits (add/cardio, harder/easier, swap) as buttons.
  // Deferred past the webhook response — the AI chain must not block the update.
  deferAi(ctx, "coach", async () => {
    const result = await aiJSON<P.CoachEditResult>(ctx.env, {
      system: P.coachEditSystem(lang, owner.profile, await coachContext(ctx, owner)),
      user: text,
      schema: P.COACH_EDIT_SCHEMA,
      temperature: 0.35,
      kind: "coach",
      db: ctx.db,
      userId: ctx.user._id,
      validate: (parsed) => validateCoachEditResult(parsed),
    });
    const actions = (result.actions ?? []).filter((a) => a.kind !== "none").slice(0, 4);
    let kb = menuBtn(lang);
    if (actions.length) {
      // Each coach turn gets its own token so a button from an older turn can't fire against
      // whatever coachActions a newer, still-pending AI reply has since overwritten.
      const turnId = Date.now() % 100000;
      kb = new InlineKeyboard();
      actions.forEach((a, i) => {
        // Stash the arg in the session (callback data is length-limited); button carries the index.
        kb.text(a.label.slice(0, 60), `cact:${a.kind}:${turnId}:${i}`).row();
      });
      // This runs up to ~26 s after the webhook — re-read the CURRENT session so we don't
      // clobber a mode/draft the user started while the AI was thinking.
      const fresh = await getUser(ctx.db, ctx.user._id).catch(() => null);
      const session = { ...(fresh?.session ?? ctx.user.session), coachActions: actions, coachTurnId: turnId };
      await updateUser(ctx.db, ctx.user._id, { session });
      ctx.user.session = session;
    }
    await reply(ctx, escapeHtml(cleanAi(result.reply)), kb);
  });
}

// The plan day a coach edit targets: today's session if it's a training day, else the
// earliest upcoming session, else the first plan day. Resolves the same trainer-editing-a-
// client target as handleCoach (planOwnerId) — "today" must be the CLIENT's local today, not
// the trainer's, when the two are in different timezones.
export async function coachEditWeekday(ctx: MyContext): Promise<Weekday | null> {
  const ownerId = planOwnerId(ctx);
  const owner = ownerId === ctx.user._id ? ctx.user : await getUser(ctx.db, ownerId);
  if (!owner) return null;
  const plan = await getActivePlan(ctx.db, ownerId);
  if (!plan || !plan.split.length) return null;
  const tz = owner.profile.timezone;
  const logs = (await workoutLogsSince(ctx.db, ownerId, localCutoff(tz, 14))).map((l) => ({ date: l.date, completed: l.completed }));
  const sessions = upcomingSessions(owner.lang, plan, tz, logs, 7);
  const today = localParts(tz).date;
  const todays = sessions.find((s) => s.date === today && s.status === "pending");
  const next = todays ?? sessions.find((s) => s.isNext);
  return (next?.weekday ?? [...plan.split].sort((a, b) => a.weekday - b.weekday)[0].weekday) as Weekday;
}

// Apply a coach-proposed plan edit when the user taps one of the action buttons.
export async function handleCoachAction(ctx: MyContext, kind: string, turnId: number, idx: number) {
  const lang = ctx.user.lang;
  // Reject a button from a coach turn the session has since moved past (see handleCoach) —
  // without this, a stale button could apply a newer, unrelated action at the same index.
  const stale = ctx.user.session.coachTurnId !== turnId;
  const a = stale ? undefined : (ctx.user.session.coachActions ?? [])[idx];
  await setMode(ctx, "idle");
  if (!a) {
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
    return;
  }
  let action: ReturnType<typeof validateCoachActionForApply>;
  try {
    action = validateCoachActionForApply(a, kind);
  } catch {
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
    return;
  }
  // Use the action's explicit weekday when given, else default to today's/next session.
  const weekday = (action.weekday as Weekday) || (await coachEditWeekday(ctx));
  if (!weekday) {
    await reply(ctx, t(lang, "no_plan"), menuBtn(lang));
    return;
  }
  const index = action.index ?? 0;
  if (kind === "add" && action.exercise) {
    await addExerciseByName(ctx, weekday, action.exercise, "ai_coach");
  } else if (kind === "delete") {
    await deleteExerciseFromToday(ctx, weekday, index);
  } else if (kind === "swap") {
    if (action.exercise) await swapExerciseByName(ctx, weekday, index, action.exercise, "ai_coach");
    else await showSwapAlternatives(ctx, weekday, index);
  } else if (kind === "weight" && action.value) {
    await setExerciseWeight(ctx, weekday, index, action.value);
  } else if (kind === "sets" && action.value) {
    await setExerciseSets(ctx, weekday, index, action.value);
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
        system: P.coachSystem(trainer.lang, ctx.user.profile, await coachContext(ctx, ctx.user), trainerDoc ? trainerStyleBlock(trainerDoc) : undefined),
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
