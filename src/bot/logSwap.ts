// Swapping exercises DURING a logging session: one exercise (equipment busy, etc.) or the whole
// session re-fitted to the gym the athlete is in today.
import { InlineKeyboard } from "grammy";
import type { CatalogExercise } from "../types";
import { getActivePlan } from "../adapters/d1/v2Plans";
import { getCatalogExercise, listCandidatesByMuscles } from "../adapters/d1/v2Catalog";
import { fitsEquipmentPreset, pickGymSwaps, profileEquipmentToPreset, type EquipmentPreset, type GymSwapCandidate, type GymSwapSlot } from "../domain/gymSwap";
import { getPlanDay } from "../domain/progression";
import { localParts } from "../domain/localTime";
import { cleanAi, t } from "../locales/i18n";
import { type MyContext, reply } from "../adapters/telegram/context";
import { type LogDraft, cmdLog, logExerciseKeyboard, logPickExercise, persistLogDraft } from "./guidedLog";
import { cmdToday } from "./planView";
import { exerciseInfoEntry, searchExerciseCatalog } from "../features/exercise/catalog";
import { muscleGroupToEnum } from "../domain/exerciseDefaults";
import { difficultyLabel, menuBtn } from "../adapters/telegram/keyboards";

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
