// Editing today's workout in the bot: add an exercise by name, delete one, undo the delete.
import { InlineKeyboard } from "grammy";
import type { Weekday } from "../types";
import { getActivePlan, updateActivePlanSplit } from "../adapters/d1/v2Plans";
import { updateUser } from "../adapters/d1/v2Users";
import { t } from "../locales/i18n";
import { getPlanDay } from "../domain/progression";
import { renderToday } from "../render";
import { menuBtn, todayWorkoutKeyboard } from "./keyboards";
import { onError } from "./aiDefer";
import { switchMode } from "../domain/session";
import { isEditingOther, planOwnerId, reply, setMode, type MyContext } from "../adapters/telegram/context";
import { reRenderEditDay, videosForDays } from "./planView";
import { extractExerciseQuery } from "../domain/exerciseDefaults";
import { translateExerciseQueryToEnglish, searchExerciseCatalog, promptExerciseConfirmation, createExerciseCatalogEntry } from "./exerciseCatalog";

export async function startAddExercise(ctx: MyContext, weekday: Weekday) {
  const lang = ctx.user.lang;
  const session = switchMode(ctx.user.session, "add_exercise", { targetId: weekday });
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
  await reply(ctx, t(lang, "add_exercise_prompt"));
}

export async function showDeleteExerciseMenu(ctx: MyContext, weekday: Weekday) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  if (!day || !day.exercises.length) {
    await reply(ctx, t(lang, "exercise_info_unavailable"), menuBtn(lang));
    return;
  }
  const kb = new InlineKeyboard();
  day.exercises.forEach((e, i) => {
    const label = `${i + 1}. ${e.name}`.slice(0, 60);
    kb.text(label, `workout:delete:${weekday}:${i}`).row();
  });
  await reply(ctx, t(lang, "delete_pick"), kb);
}

export async function deleteExerciseFromToday(ctx: MyContext, weekday: Weekday, index: number) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  const current = day?.exercises[index];
  if (!plan || !day || !current) {
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
    return;
  }
  const owner = planOwnerId(ctx);
  day.exercises.splice(index, 1);
  await updateActivePlanSplit(ctx.db, owner, plan.split);
  // Stash for one-tap undo.
  const session = { ...ctx.user.session, lastDeleted: { ownerId: owner, weekday, index, exercise: current } };
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
  const updatedDay = plan.split.find((d) => d.weekday === weekday);
  await reply(ctx, t(lang, "delete_done", { name: current.name }), new InlineKeyboard().text(t(lang, "undo_delete"), "undo:del"));
  // Editing a client/user → return to their edit-day view; editing own today → self log view.
  if (isEditingOther(ctx)) {
    await reRenderEditDay(ctx, weekday);
  } else if (updatedDay) {
    await reply(ctx, renderToday(lang, updatedDay, undefined, undefined, await videosForDays(ctx, [updatedDay])), todayWorkoutKeyboard(lang, weekday));
  }
}

// Restore the most recently deleted exercise to its original position.
export async function undoDelete(ctx: MyContext) {
  const lang = ctx.user.lang;
  const d = ctx.user.session.lastDeleted;
  if (!d) {
    await reply(ctx, t(lang, "nothing_to_undo"), menuBtn(lang));
    return;
  }
  const plan = await getActivePlan(ctx.db, d.ownerId);
  const day = plan ? getPlanDay(plan, d.weekday as Weekday) : undefined;
  if (!plan || !day) {
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
    return;
  }
  day.exercises.splice(Math.min(d.index, day.exercises.length), 0, d.exercise);
  await updateActivePlanSplit(ctx.db, d.ownerId, plan.split);
  const session = { ...ctx.user.session };
  delete session.lastDeleted;
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
  await reply(ctx, t(lang, "undo_done", { name: d.exercise.name }), menuBtn(lang));
}

// Resolve an exercise by name (catalog match, else AI-author) and ask the user to confirm
// before adding it to `weekday`. Shared by the typed add flow and the coach chat.
export async function addExerciseByName(ctx: MyContext, weekday: Weekday, query: string, source: "ai_coach" | "manual" = "manual") {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  if (!plan || !day) {
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
    return;
  }
  try {
    const englishQuery = await translateExerciseQueryToEnglish(ctx, query);
    const matches = await searchExerciseCatalog(ctx, query, 5);
    await ctx.replyWithChatAction("typing").catch(() => {});
    const catalog = matches[0] ?? (await createExerciseCatalogEntry(ctx, query, day, "add", undefined, englishQuery));
    await promptExerciseConfirmation(ctx, { action: "add", weekday, query, englishQuery, catalog, source });
  } catch (err) {
    await onError(ctx, err, "add_exercise");
  }
}

export async function handleAddExercise(ctx: MyContext, text: string) {
  const weekday = (ctx.user.session.targetId ?? 0) as Weekday;
  await setMode(ctx, "idle");
  await addExerciseByName(ctx, weekday, extractExerciseQuery(text));
}
