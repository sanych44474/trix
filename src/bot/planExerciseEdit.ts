// Plan exercise editing: the swap family (pick-from-3 alternatives, type-your-own, on-the-fly
// non-mutating single/bulk swap for a logging session), direct weight/sets edit, difficulty
// up/down, and the self-edit-day hub every one of these re-shows when done. Extracted from
// bot.ts (god-file split; same barrel seam via bot.ts's `export * from "./bot/planExerciseEdit"`)
// as ONE file rather than one-per-banner: these functions were spread across four small,
// misleadingly-named bot.ts banners (plan-day management / on-the-fly swap / "not my gym today"
// / reorder) but call into each other and share the same handful of kernel helpers
// (getActivePlanOrReply, planOwnerId, isEditingOther, reRenderEditDay, endSelfEdit) throughout —
// splitting them further would just recreate the same web of cross-file calls under different
// file names. cmdLog/logPickExercise/logExerciseKeyboard/persistLogDraft (the guided per-exercise
// logging flow these hand off to) stayed in bot.ts; imported from there like everything else.
import { InlineKeyboard } from "grammy";
import type { CatalogExercise, Lang, Weekday } from "../types";
import { getActivePlan, getCatalogExercise, listCandidatesByMuscles, listExercisesByMusclesAnyLevel, updateActivePlanSplit, updateUser } from "../db/repos";
import { pickDifficultySwaps } from "../domain/difficultySwap";
import { fitsEquipmentPreset, pickGymSwaps, profileEquipmentToPreset, type EquipmentPreset, type GymSwapCandidate, type GymSwapSlot } from "../domain/gymSwap";
import { getPlanDay, localParts } from "../domain/progression";
import { switchMode } from "../domain/session";
import { cleanAi, t } from "../locales/i18n";
import { renderToday } from "../render";
import { weekdayName } from "../render";
import { translatePlanExercises } from "./plan";
import {
  type LogDraft, type MyContext,
  cmdLog, cmdToday, createExerciseCatalogEntry, decodePlanRef, difficultyLabel, encodePlanRef,
  exerciseInfoEntry, getActivePlanOrReply, isEditingOther, logExerciseKeyboard, logPickExercise,
  menuBtn, muscleGroupToEnum, onError, persistLogDraft, planOwnerId, planOwnerLang, reRenderEditDay,
  reply, searchExerciseCatalog, setMode, swapTuneKb, translateExerciseQueryToEnglish, videosForDays,
  extractExerciseQuery, promptExerciseConfirmation,
} from "../bot";

// Show exercises of a day as buttons to pick one to replace.
export async function swapMenu(ctx: MyContext, weekday: Weekday) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  if (!day) {
    await reply(ctx, t(lang, "no_plan"));
    return;
  }
  const kb = new InlineKeyboard();
  day.exercises.forEach((e, i) => {
    kb.text(`${i + 1}. ${e.name}`.slice(0, 60), `sw:${weekday}:${i}`).row();
  });
  // Self-edits loop back to this picker after each swap — give them an explicit exit.
  if (!isEditingOther(ctx)) kb.text(t(lang, "edit_done"), `eds:done:${weekday}`);
  await reply(ctx, t(lang, "swap_pick"), kb);
}

// User picked which exercise to swap → show 3 catalog alternatives + "type your own".
export async function showSwapAlternatives(ctx: MyContext, weekday: Weekday, index: number) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  const current = day?.exercises[index];
  if (!current) { await reply(ctx, t(lang, "error_generic")); return; }

  let candidates: CatalogExercise[] = [];

  if (current.exerciseId) {
    // 1) Best case: grounded exercise — find alternatives by same muscle.
    const cur = await getCatalogExercise(ctx.db, current.exerciseId);
    if (cur) {
      candidates = (await listCandidatesByMuscles(ctx.db, [cur.muscle], { level: ctx.user.profile.level, perMuscle: 20, total: 20 }))
        .filter((c) => c.id !== current.exerciseId);
    }
  }

  if (!candidates.length) {
    // 2) Fallback: search catalog by English canonical name or current name.
    const searchName = current.canonicalName ?? current.name;
    const nameMatch = await searchExerciseCatalog(ctx, searchName, 1);
    if (nameMatch.length) {
      candidates = (await listCandidatesByMuscles(ctx.db, [nameMatch[0].muscle], { level: ctx.user.profile.level, perMuscle: 20, total: 20 }))
        .filter((c) => c.id !== nameMatch[0].id);
    }
  }

  if (!candidates.length) {
    // 3) Last resort: map muscleGroup display name to catalog muscle enum.
    const muscle = muscleGroupToEnum(day!.muscleGroup);
    if (muscle) {
      candidates = await listCandidatesByMuscles(ctx.db, [muscle], { level: ctx.user.profile.level, perMuscle: 20, total: 20 });
    }
  }

  // Respect the equipment the user actually has (onboarding profile.equipment) — see gymSwap.ts.
  const preset = profileEquipmentToPreset(ctx.user.profile.equipment);
  if (preset) candidates = candidates.filter((c) => fitsEquipmentPreset(c.equipments, preset));

  // Pick 3 random alternatives from candidates.
  const shuffled = candidates.sort(() => Math.random() - 0.5).slice(0, 3);
  const kb = new InlineKeyboard();
  for (const c of shuffled) {
    // Translating each label is best-effort — a translate failure must not crash the menu.
    let translatedName = c.name;
    if (lang !== "en") {
      try {
        translatedName = (await exerciseInfoEntry(ctx, c.id, lang))?.name ?? c.name;
      } catch {
        /* keep English name */
      }
    }
    const diff = difficultyLabel(lang, c.difficulty);
    const label = `${cleanAi(translatedName)}${diff ? ` (${diff})` : ""}`.slice(0, 60);
    kb.text(label, `swc:${weekday}:${index}:${c.id}`).row();
  }
  kb.text(t(lang, "swap_custom_btn"), `sw:custom:${weekday}:${index}`);
  await reply(ctx, t(lang, "swap_pick_alt", { name: current.name }), kb);
}

// User chose a catalog alternative — apply immediately.
export async function swapFromCatalog(ctx: MyContext, weekday: Weekday, index: number, catalogId: string) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  if (!plan) { await reply(ctx, t(lang, "no_plan")); return; }
  const day = getPlanDay(plan, weekday);
  const current = day?.exercises[index];
  if (!current) { await reply(ctx, t(lang, "error_generic")); return; }
  const alt = await getCatalogExercise(ctx.db, catalogId);
  if (!alt) { await reply(ctx, t(lang, "error_generic")); return; }
  const fromName = current.name;
  day.exercises[index] = {
    exerciseId: alt.id,
    canonicalName: alt.name,
    name: alt.name,
    sets: current.sets,
    startWeight: current.startWeight || "—",
    technique: alt.instructions ?? current.technique,
    isKeyLift: current.isKeyLift,
    muscles: alt.muscle,
  };
  // Translate if needed.
  let split = plan.split;
  const oLang = await planOwnerLang(ctx);
  if (oLang !== "en") split = await translatePlanExercises(ctx.env, oLang, split, ctx.db, planOwnerId(ctx));
  await updateActivePlanSplit(ctx.db, planOwnerId(ctx), split);
  const swapped = split.find((d) => d.weekday === weekday)?.exercises[index];
  await reply(ctx, t(lang, "swap_done", { from: fromName, to: swapped?.name ?? alt.name }), swapTuneKb(lang, weekday, index));
  // Re-show the full edit-day menu automatically (both surfaces).
  if (isEditingOther(ctx)) await reRenderEditDay(ctx, weekday);
  else await endSelfEdit(ctx, String(weekday));
}

// ============ On-the-fly swap DURING a logging session (equipment busy, etc.) ============
// Different from plan-time swap above: does NOT mutate the active plan (tomorrow's session keeps
// the original exercise). Just stores a per-slot name override on the current logDraft so all
// prompts, the checklist and the eventual saved entry use the alternative name.

export async function showLogSwapAlternatives(ctx: MyContext, index: number) {
  const lang = ctx.user.lang;
  const draft = ctx.user.session.logDraft;
  if (!draft) { await cmdLog(ctx); return; }
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const day = plan ? getPlanDay(plan, draft.weekday) : undefined;
  const current = day?.exercises[index];
  if (!current) { await reply(ctx, t(lang, "error_generic")); return; }

  let candidates: CatalogExercise[] = [];
  if (current.exerciseId) {
    const cur = await getCatalogExercise(ctx.db, current.exerciseId);
    if (cur) {
      candidates = (await listCandidatesByMuscles(ctx.db, [cur.muscle], { level: ctx.user.profile.level, perMuscle: 20, total: 20 }))
        .filter((c) => c.id !== current.exerciseId);
    }
  }
  if (!candidates.length) {
    const searchName = current.canonicalName ?? current.name;
    const nameMatch = await searchExerciseCatalog(ctx, searchName, 1);
    if (nameMatch.length) {
      candidates = (await listCandidatesByMuscles(ctx.db, [nameMatch[0].muscle], { level: ctx.user.profile.level, perMuscle: 20, total: 20 }))
        .filter((c) => c.id !== nameMatch[0].id);
    }
  }
  if (!candidates.length && day) {
    const muscle = muscleGroupToEnum(day.muscleGroup);
    if (muscle) {
      candidates = await listCandidatesByMuscles(ctx.db, [muscle], { level: ctx.user.profile.level, perMuscle: 20, total: 20 });
    }
  }

  // Respect the equipment the user actually has (onboarding profile.equipment) — see gymSwap.ts.
  const preset = profileEquipmentToPreset(ctx.user.profile.equipment);
  if (preset) candidates = candidates.filter((c) => fitsEquipmentPreset(c.equipments, preset));

  const shuffled = candidates.sort(() => Math.random() - 0.5).slice(0, 3);
  const kb = new InlineKeyboard();
  for (const c of shuffled) {
    let translatedName = c.name;
    if (lang !== "en") {
      try { translatedName = (await exerciseInfoEntry(ctx, c.id, lang))?.name ?? c.name; } catch { /* keep English */ }
    }
    const diff = difficultyLabel(lang, c.difficulty);
    const label = `${cleanAi(translatedName)}${diff ? ` (${diff})` : ""}`.slice(0, 60);
    kb.text(label, `lswc:${index}:${c.id}`).row();
  }
  // Fall back to the plan's swap flow (mutates plan) if the user wants a permanent change.
  if (!shuffled.length) kb.text(t(lang, "log_swap_none"), `sw:custom:${draft.weekday}:${index}`).row();
  kb.text(t(lang, "back"), "log:back");
  await reply(ctx, t(lang, "log_swap_pick", { name: draft.swaps?.[index]?.name ?? current.name }), kb);
}

// ============ "Not my gym today" — one tap re-fits the WHOLE session, not one exercise ============
// Same non-mutating mechanism as the on-the-fly swap above (logDraft.swaps), just computed for
// every slot at once from a chosen equipment preset instead of picked one at a time by hand.

export async function showGymSwapPicker(ctx: MyContext) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const { weekday } = localParts(ctx.user.profile.timezone);
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  if (!day || !day.exercises.length) { await reply(ctx, t(lang, "gym_swap_none"), menuBtn(lang)); return; }
  const kb = new InlineKeyboard()
    .text(t(lang, "gym_swap_bodyweight"), "gymswap:bodyweight")
    .row()
    .text(t(lang, "gym_swap_dumbbells"), "gymswap:dumbbells")
    .row()
    .text(t(lang, "gym_swap_band"), "gymswap:band")
    .row()
    .text(t(lang, "back"), "menu:today");
  await reply(ctx, t(lang, "gym_swap_prompt"), kb);
}

export async function applyGymSwap(ctx: MyContext, preset: EquipmentPreset) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const { weekday } = localParts(ctx.user.profile.timezone);
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  if (!day || !day.exercises.length) { await cmdToday(ctx); return; }

  // Resolve each exercise's catalog muscle the same way the single-exercise on-the-fly swap
  // above does: grounded exerciseId first, else a name search, else the day's own muscle group.
  const slots: GymSwapSlot[] = [];
  const musclesNeeded = new Set<string>();
  for (let i = 0; i < day.exercises.length; i++) {
    const ex = day.exercises[i];
    let muscle: string | null = null;
    if (ex.exerciseId) {
      const cat = await getCatalogExercise(ctx.db, ex.exerciseId);
      muscle = cat?.muscle ?? null;
    }
    if (!muscle) {
      const nameMatch = await searchExerciseCatalog(ctx, ex.canonicalName ?? ex.name, 1);
      muscle = nameMatch[0]?.muscle ?? null;
    }
    if (!muscle) muscle = muscleGroupToEnum(day.muscleGroup);
    if (!muscle) continue;
    musclesNeeded.add(muscle);
    slots.push({ index: i, exerciseId: ex.exerciseId, muscle });
  }

  const candidatesByMuscle = new Map<string, GymSwapCandidate[]>();
  if (musclesNeeded.size) {
    const pool = await listCandidatesByMuscles(ctx.db, [...musclesNeeded], {
      level: ctx.user.profile.level, perMuscle: 20, total: 20 * musclesNeeded.size,
    });
    for (const c of pool) {
      const bucket = candidatesByMuscle.get(c.muscle) ?? [];
      bucket.push({ id: c.id, name: c.name, canonicalName: c.name, equipments: c.equipments });
      candidatesByMuscle.set(c.muscle, bucket);
    }
  }

  const picked = pickGymSwaps(slots, candidatesByMuscle, preset);
  if (!picked.size) { await reply(ctx, t(lang, "gym_swap_empty"), menuBtn(lang)); return; }

  // Translate the picked names before they land in the swap map, same as a manual single-slot
  // swap does — logDraft display and prompts read straight from swaps[i].name.
  const swaps: LogDraft["swaps"] = {};
  for (const [index, pick] of picked) {
    let name = pick.name;
    if (lang !== "en") {
      try { name = (await exerciseInfoEntry(ctx, pick.id, lang))?.name ?? pick.name; } catch { /* keep English */ }
    }
    swaps[index] = { name, canonicalName: pick.name };
  }
  await reply(ctx, t(lang, "gym_swap_applied", { n: picked.size }));
  await cmdLog(ctx, swaps);
}

export async function logSwapFromCatalog(ctx: MyContext, index: number, catalogId: string) {
  const lang = ctx.user.lang;
  const draft = ctx.user.session.logDraft;
  if (!draft) { await cmdLog(ctx); return; }
  const alt = await getCatalogExercise(ctx.db, catalogId);
  if (!alt) { await reply(ctx, t(lang, "error_generic")); return; }
  let altName = alt.name;
  if (lang !== "en") {
    try { altName = (await exerciseInfoEntry(ctx, alt.id, lang))?.name ?? alt.name; } catch { /* keep English */ }
  }
  draft.swaps = { ...(draft.swaps ?? {}), [index]: { name: altName, canonicalName: alt.name } };
  await persistLogDraft(ctx, draft);
  await reply(ctx, t(lang, "log_swap_done", { to: altName }));
  await logPickExercise(ctx, index);
}

// Return to the exercise picker (used as "back" from the log-swap sub-menu).
export async function logBackToPick(ctx: MyContext) {
  const lang = ctx.user.lang;
  const draft = ctx.user.session.logDraft;
  if (!draft) { await cmdLog(ctx); return; }
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const day = plan ? getPlanDay(plan, draft.weekday) : undefined;
  if (!day) { await cmdLog(ctx); return; }
  await reply(ctx, t(lang, "log_pick_exercise"), logExerciseKeyboard(lang, day, draft));
}

// User wants to type their own exercise name.
export async function startSwapCustom(ctx: MyContext, weekday: Weekday, index: number) {
  const lang = ctx.user.lang;
  const ref = encodePlanRef(weekday, index);
  const session = switchMode(ctx.user.session, "swap_custom", { targetId: ref });
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
  await reply(ctx, t(lang, "swap_custom_ask"));
}

// Resolve a replacement exercise by name (catalog match, else AI-author) and confirm before
// swapping exercise #index of `weekday`. Shared by the typed swap flow and the coach chat.
export async function swapExerciseByName(ctx: MyContext, weekday: Weekday, index: number, query: string) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  const current = day?.exercises[index];
  if (!current || !plan) { await reply(ctx, t(lang, "error_generic")); return; }
  try {
    const englishQuery = await translateExerciseQueryToEnglish(ctx, query);
    const matches = await searchExerciseCatalog(ctx, query, 5);
    await ctx.replyWithChatAction("typing").catch(() => {});
    const catalog = matches[0] ?? (await createExerciseCatalogEntry(ctx, query, day, "swap", current, englishQuery));
    await promptExerciseConfirmation(ctx, { action: "swap", weekday, index, query, englishQuery, catalog });
  } catch (err) {
    await onError(ctx, err, "swap_custom");
  }
}

// Text handler for swap_custom mode.
export async function handleSwapCustom(ctx: MyContext, text: string) {
  const { weekday, index } = decodePlanRef(ctx.user.session.targetId ?? 0);
  await setMode(ctx, "idle");
  await swapExerciseByName(ctx, weekday as Weekday, index, extractExerciseQuery(text));
}

// Set a specific exercise's weight (coach chat). Mirrors handleWeightEdit's normalization.
export async function setExerciseWeight(ctx: MyContext, weekday: Weekday, index: number, value: string) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  const ex = day?.exercises[index];
  if (!plan || !ex) { await reply(ctx, t(lang, "error_generic"), menuBtn(lang)); return; }
  const num = parseFloat(value.replace(",", ".").replace(/[^\d.]/g, ""));
  if (Number.isFinite(num) && num > 0) ex.startWeight = `${Math.round(num * 2) / 2} kg`;
  else ex.startWeight = value.trim() || ex.startWeight;
  await updateActivePlanSplit(ctx.db, planOwnerId(ctx), plan.split);
  await reply(ctx, t(lang, "plan_diff_weight_saved", { name: ex.name, weight: ex.startWeight }), menuBtn(lang));
}

// Set a specific exercise's sets/reps (coach chat).
export async function setExerciseSets(ctx: MyContext, weekday: Weekday, index: number, value: string) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  const ex = day?.exercises[index];
  if (!plan || !ex) { await reply(ctx, t(lang, "error_generic"), menuBtn(lang)); return; }
  ex.sets = cleanAi(value).replace(/x/i, "×").trim() || ex.sets;
  await updateActivePlanSplit(ctx.db, planOwnerId(ctx), plan.split);
  await reply(ctx, t(lang, "plan_diff_sets_saved", { name: ex.name, sets: ex.sets }), menuBtn(lang));
}

export async function adjustDifficulty(ctx: MyContext, direction: "ok" | "up" | "down", weekday?: number) {
  const lang = ctx.user.lang;
  if (direction === "ok") {
    await reply(ctx, t(lang, "plan_diff_ok_ack"), menuBtn(lang));
    return;
  }
  const plan = await getActivePlanOrReply(ctx);
  if (!plan) return;
  const wd = weekday ?? 0;
  const targetDay = plan.split.find((d) => d.weekday === wd);
  if (!targetDay) { await reply(ctx, t(lang, "no_plan"), menuBtn(lang)); return; }

  const usedIds = (targetDay.exercises ?? []).map((e) => e.exerciseId).filter(Boolean) as string[];

  // One catalog lookup per exercise (cheap PK reads) to know each one's own muscle/tier, then
  // ONE bulk candidate fetch across every distinct muscle in the day — replacing what used to be
  // up to 4 sequential RANDOM()-ordered bucket scans PER exercise (one per difficulty tier tried).
  const catalogByExerciseId = new Map<string, CatalogExercise>();
  for (const ex of targetDay.exercises ?? []) {
    if (!ex.exerciseId) continue;
    const catalog = await getCatalogExercise(ctx.db, ex.exerciseId);
    if (catalog) catalogByExerciseId.set(ex.exerciseId, catalog);
  }
  const muscles = [...new Set([...catalogByExerciseId.values()].map((c) => c.muscle))];
  const pool = await listExercisesByMusclesAnyLevel(ctx.db, muscles);
  const candidatesByMuscle = new Map<string, CatalogExercise[]>();
  for (const c of pool) {
    const bucket = candidatesByMuscle.get(c.muscle) ?? [];
    bucket.push(c);
    candidatesByMuscle.set(c.muscle, bucket);
  }

  const { exercises: updatedExercises, swappedCount } = pickDifficultySwaps(
    targetDay.exercises ?? [],
    direction,
    catalogByExerciseId,
    candidatesByMuscle,
    usedIds,
  );

  const newSplit = plan.split.map((day) =>
    day.weekday === wd ? { ...day, exercises: updatedExercises } : day
  );
  let finalSplit = newSplit;
  if (swappedCount > 0 && lang !== "en") {
    finalSplit = await translatePlanExercises(ctx.env, lang, newSplit, ctx.db, ctx.user._id);
  }
  await updateActivePlanSplit(ctx.db, planOwnerId(ctx), finalSplit);

  if (swappedCount === 0) {
    await reply(ctx, t(lang, "plan_diff_no_swap"), menuBtn(lang));
  } else {
    const base = direction === "up" ? t(lang, "plan_diff_adjusted_up") : t(lang, "plan_diff_adjusted_down");
    await reply(ctx, `${base}\n${t(lang, "plan_diff_upgraded", { n: String(swappedCount) })}`, menuBtn(lang));
  }
}

// Show exercises only for the specified weekday as buttons.
export async function openWeightEditor(ctx: MyContext, weekday?: number) {
  const lang = ctx.user.lang;
  const plan = await getActivePlanOrReply(ctx);
  if (!plan) return;
  const kb = new InlineKeyboard();
  const days = weekday !== undefined
    ? plan.split.filter((d) => d.weekday === weekday)
    : plan.split;
  for (const day of days) {
    for (let i = 0; i < (day.exercises ?? []).length; i++) {
      const ex = day.exercises[i];
      const label = `${ex.name} — ${ex.startWeight || "—"}`.slice(0, 64);
      kb.text(label, `wt:${day.weekday}:${i}`).row();
    }
  }
  // Self-edits loop back to this picker after each save — give them an explicit exit.
  if (!isEditingOther(ctx)) kb.text(t(lang, "edit_done"), `eds:done:${weekday ?? "x"}`);
  await reply(ctx, t(lang, "plan_diff_pick_exercise"), kb);
}

export async function openSetsEditor(ctx: MyContext, weekday?: number) {
  const lang = ctx.user.lang;
  const plan = await getActivePlanOrReply(ctx);
  if (!plan) return;
  const kb = new InlineKeyboard();
  const days = weekday !== undefined
    ? plan.split.filter((d) => d.weekday === weekday)
    : plan.split;
  for (const day of days) {
    for (let i = 0; i < (day.exercises ?? []).length; i++) {
      const ex = day.exercises[i];
      const label = `${ex.name} — ${ex.sets || "—"}`.slice(0, 64);
      kb.text(label, `st:${day.weekday}:${i}`).row();
    }
  }
  // Self-edits loop back to this picker after each save — give them an explicit exit.
  if (!isEditingOther(ctx)) kb.text(t(lang, "edit_done"), `eds:done:${weekday ?? "x"}`);
  await reply(ctx, t(lang, "plan_diff_pick_sets"), kb);
}

// Self plan-edit day menu — the editing hub for one's OWN plan (mirrors the trainer's editDayKb,
// but with self callbacks and no logging buttons). After every self edit we re-show THIS, so the
// full edit menu is always one glance away — tap another action or ✅ Done to finish.
export function selfEditDayKb(lang: Lang, weekday: number): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, "swap_btn"), `swap:${weekday}`)
    .text(t(lang, "workout_add_btn"), `workout:add:${weekday}`)
    .row()
    .text(t(lang, "workout_delete_btn"), `workout:delete:${weekday}`)
    .text(t(lang, "reorder_btn"), `ord:open:${weekday}`)
    .row()
    .text(t(lang, "plan_diff_edit_weight"), `wt:open:${weekday}`)
    .text(t(lang, "plan_diff_edit_sets"), `st:open:${weekday}`)
    .row()
    .text(t(lang, "warmup_edit_btn"), `wu:open:${weekday}`)
    .text(t(lang, "video_btn"), `vid:pick:${weekday}`)
    .row()
    .text(t(lang, "edit_done"), "menu:plan");
}

// Re-show the self edit-day hub (day + full edit menu). Called after each self edit and when the
// user opens a day from the day manager or taps ✅ Done in a picker.
export async function endSelfEdit(ctx: MyContext, arg: string) {
  const lang = ctx.user.lang;
  if (arg === "x") {
    await reply(ctx, t(lang, "edit_done"), menuBtn(lang));
    return;
  }
  const weekday = Number(arg) as Weekday;
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const day = plan ? getPlanDay(plan, weekday) : undefined;
  if (!day) {
    await reply(ctx, t(lang, "no_plan"), menuBtn(lang));
    return;
  }
  await reply(
    ctx,
    renderToday(lang, day, weekdayName(lang, weekday as Weekday), undefined, await videosForDays(ctx, [day]), { noCta: true }),
    selfEditDayKb(lang, weekday),
  );
}

// ============ Reorder exercises within a day (drag-free ⬆️/⬇️) — self and trainer/owner ============
// Operates on the plan being edited (planOwnerId), so it serves both a user editing their own
// program and a trainer/owner editing a client's. After each move the list re-renders in place.
export async function showReorder(ctx: MyContext, weekday: Weekday) {
  const lang = ctx.user.lang;
  const plan = await getActivePlanOrReply(ctx);
  if (!plan) return;
  const day = getPlanDay(plan, weekday);
  if (!day || !day.exercises.length) { await reply(ctx, t(lang, "error_generic")); return; }
  const kb = new InlineKeyboard();
  day.exercises.forEach((ex, i) => {
    kb.text(`${i + 1}. ${ex.name}`.slice(0, 40), "ord:noop");
    kb.text(i > 0 ? "⬆️" : " ", i > 0 ? `ord:up:${weekday}:${i}` : "ord:noop");
    kb.text(i < day.exercises.length - 1 ? "⬇️" : " ", i < day.exercises.length - 1 ? `ord:down:${weekday}:${i}` : "ord:noop");
    kb.row();
  });
  kb.text(t(lang, "back"), `ord:back:${weekday}`);
  await reply(ctx, t(lang, "reorder_title"), kb);
}

export async function moveExercise(ctx: MyContext, weekday: Weekday, index: number, dir: "up" | "down") {
  const plan = await getActivePlanOrReply(ctx);
  if (!plan) return;
  const day = getPlanDay(plan, weekday);
  if (!day) return;
  const j = dir === "up" ? index - 1 : index + 1;
  if (index < 0 || j < 0 || index >= day.exercises.length || j >= day.exercises.length) {
    await showReorder(ctx, weekday);
    return;
  }
  [day.exercises[index], day.exercises[j]] = [day.exercises[j], day.exercises[index]];
  await updateActivePlanSplit(ctx.db, planOwnerId(ctx), plan.split);
  await showReorder(ctx, weekday);
}

// Back from the reorder view → the edit-day menu of whichever context we're in.
export async function endReorder(ctx: MyContext, weekday: Weekday) {
  if (isEditingOther(ctx)) await reRenderEditDay(ctx, weekday);
  else await endSelfEdit(ctx, String(weekday));
}

// User tapped a specific exercise — ask for the new weight.
export async function selectExerciseWeight(ctx: MyContext, ref: string) {
  const lang = ctx.user.lang;
  const [wdStr, idxStr] = ref.split(":");
  const weekday = parseInt(wdStr, 10);
  const idx = parseInt(idxStr, 10);
  // Read the plan being edited (managed client or self) so a trainer/owner edit targets the
  // same plan that handleWeightEdit/handleSetsEdit save back to.
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const ex = plan?.split.find((d) => d.weekday === weekday)?.exercises[idx];
  if (!ex) { await reply(ctx, t(lang, "exercise_info_unavailable")); return; }
  const ref2 = encodePlanRef(weekday, idx);
  const session = switchMode(ctx.user.session, "weight_edit", { targetId: ref2 });
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
  await reply(
    ctx,
    t(lang, "plan_diff_enter_weight", { name: ex.name, current: ex.startWeight || "—" }),
  );
}

export async function selectExerciseSets(ctx: MyContext, ref: string) {
  const lang = ctx.user.lang;
  const [wdStr, idxStr] = ref.split(":");
  const weekday = parseInt(wdStr, 10);
  const idx = parseInt(idxStr, 10);
  // Read the plan being edited (managed client or self) so a trainer/owner edit targets the
  // same plan that handleWeightEdit/handleSetsEdit save back to.
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const ex = plan?.split.find((d) => d.weekday === weekday)?.exercises[idx];
  if (!ex) { await reply(ctx, t(lang, "exercise_info_unavailable")); return; }
  const ref2 = encodePlanRef(weekday, idx);
  const session = switchMode(ctx.user.session, "sets_edit", { targetId: ref2 });
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
  await reply(
    ctx,
    t(lang, "plan_diff_enter_sets", { name: ex.name, current: ex.sets || "—" }),
  );
}

// User typed the new weight for the previously selected exercise.
export async function handleWeightEdit(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const { weekday, index: idx } = decodePlanRef(ctx.user.session.targetId ?? 0);
  await setMode(ctx, "idle");
  const plan = await getActivePlanOrReply(ctx);
  if (!plan) return;
  const day = plan.split.find((d) => d.weekday === weekday);
  const ex = day?.exercises[idx];
  if (!ex) { await reply(ctx, t(lang, "exercise_info_unavailable")); return; }
  // Accept "80", "80kg", "80 kg"
  const raw = text.trim().replace(",", ".").replace(/[^\d.]/g, "");
  const kg = parseFloat(raw);
  if (!kg || kg <= 0 || kg > 1000) {
    await reply(ctx, t(lang, "plan_diff_invalid_kg"));
    return;
  }
  const rounded = Math.max(2.5, Math.round(kg / 2.5) * 2.5);
  ex.startWeight = `${rounded} kg`;
  await updateActivePlanSplit(ctx.db, planOwnerId(ctx), plan.split);
  await reply(ctx, t(lang, "plan_diff_weight_saved", { name: ex.name, weight: ex.startWeight }));
  // Re-show the full edit-day menu automatically (both surfaces), so the next action is a glance
  // away — trainer/owner get the client's edit-day view, a self-edit gets its own edit hub.
  if (isEditingOther(ctx)) await reRenderEditDay(ctx, weekday as Weekday);
  else await endSelfEdit(ctx, String(weekday));
}

export async function handleSetsEdit(ctx: MyContext, text: string) {
  const lang = ctx.user.lang;
  const { weekday, index: idx } = decodePlanRef(ctx.user.session.targetId ?? 0);
  await setMode(ctx, "idle");
  const plan = await getActivePlanOrReply(ctx);
  if (!plan) return;
  const day = plan.split.find((d) => d.weekday === weekday);
  const ex = day?.exercises[idx];
  if (!ex) { await reply(ctx, t(lang, "exercise_info_unavailable")); return; }
  const normalized = text.trim().replace(/\s+/g, " ").replace(/[xх•·]/gi, "×");
  if (!/^\d+\s*×\s*\d+(?:\s*[-–]\s*\d+)?$/.test(normalized)) {
    await reply(ctx, t(lang, "plan_diff_invalid_sets"));
    return;
  }
  ex.sets = normalized.replace(/\s*×\s*/g, " × ");
  await updateActivePlanSplit(ctx.db, planOwnerId(ctx), plan.split);
  await reply(ctx, t(lang, "plan_diff_sets_saved", { name: ex.name, sets: ex.sets }));
  // Re-show the full edit-day menu automatically — same continuity as handleWeightEdit above.
  if (isEditingOther(ctx)) await reRenderEditDay(ctx, weekday as Weekday);
  else await endSelfEdit(ctx, String(weekday));
}
