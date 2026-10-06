// Exercises in the chat: looking one up, confirming a catalog match, AI-authored entries, localized
// names, descriptions, and adding/deleting exercises on a plan day. Split out of bot.ts (god-file
// split); bot.ts re-exports everything here.
import { InlineKeyboard } from "grammy";
import type { CatalogExercise, Lang, PlanDay, PlanDoc, PlanExercise, Weekday } from "../types";
import { getActivePlan, recordPlanChange, saveDraftPlan, updateActivePlanSplit } from "../adapters/d1/v2Plans";
import { listActiveInjuries } from "../adapters/d1/v2Tracking";
import { getCatalogExercise, getExerciseTranslation, upsertExerciseTranslation, searchExercisesByName, upsertExercise } from "../adapters/d1/v2Catalog";
import { updateUser } from "../adapters/d1/v2Users";
import { checkExerciseAgainstInjuries } from "../domain/safety";
import { cleanAi, escapeHtml, t } from "../locales/i18n";
import { aiJSON, aiText } from "../ai";
import * as P from "../ai/prompts";
import { getPlanDay } from "../domain/progression";
import { exerciseMetric } from "../domain/setFormat";
import { menuBtn } from "./keyboards";
import { onError } from "./aiDefer";
import { endSelfEdit, swapExerciseByName } from "./planExerciseEdit";
import { switchMode } from "../domain/session";
import { isEditingOther, planOwnerId, planOwnerLang, reply, setMode, type MyContext } from "../adapters/telegram/context";
import { reRenderEditDay, PendingExercise } from "./planView";
import { extractExerciseQuery, stripEquipmentWords, defaultStartWeightForExercise, defaultSetsForMetric, muscleGroupToEnum } from "../domain/exerciseDefaults";
import { addExerciseByName } from "./todayEdit";
export * from "../domain/exerciseDefaults";

// Instructions + safety for an exercise in the user's language. English is served straight
// from the catalog; other languages are translated on first use and cached so /today is
// instant afterwards. Falls back to the English original if translation fails.
export async function exerciseInfoEntry(
  ctx: MyContext,
  exerciseId: string,
  lang: Lang,
): Promise<{ name: string; instructions: string; safety: string } | null> {
  const catalog = await getCatalogExercise(ctx.db, exerciseId);
  if (!catalog) return null;
  if (lang === "en") return { name: catalog.name, instructions: catalog.instructions, safety: catalog.safetyInfo };
  const cached = await getExerciseTranslation(ctx.db, exerciseId, lang);
  // A name-only seed (curated names, empty instructions) is a partial cache: keep the curated
  // name but still translate the technique/safety on first view, then store the full row.
  if (cached && cached.instructions) return { name: cached.name, instructions: cached.instructions, safety: cached.safetyInfo };
  try {
    const tr = await aiJSON<P.ExerciseInfoResult>(ctx.env, {
      system: P.exerciseInfoSystem(lang),
      user: P.exerciseInfoUser(catalog.name, catalog.instructions, catalog.safetyInfo),
      schema: P.EXERCISE_INFO_SCHEMA,
      temperature: 0.2,
      kind: "translate",
      db: ctx.db,
      userId: ctx.user._id,
    });
    const out = {
      // Prefer a curated seeded name over the AI's; only fall back to AI/English when unseeded.
      name: (cached?.name && cleanAi(cached.name)) || cleanAi(tr.name) || catalog.name,
      instructions: cleanAi(tr.instructions),
      safety: cleanAi(tr.safety),
    };
    await upsertExerciseTranslation(ctx.db, exerciseId, lang, {
      name: out.name,
      instructions: out.instructions,
      safetyInfo: out.safety,
    });
    return out;
  } catch {
    return { name: catalog.name, instructions: catalog.instructions, safety: catalog.safetyInfo };
  }
}

export async function translateExerciseQueryToEnglish(ctx: MyContext, query: string): Promise<string> {
  if (ctx.user.lang === "en") return query.trim();
  try {
    const translated = await aiText(ctx.env, {
      system:
        "Translate exercise names and movement names to canonical English gym terminology only. Return only the English exercise name, with no explanation, punctuation, or quotes.",
      user: query,
      temperature: 0.2,
      kind: "translate",
      db: ctx.db,
      userId: ctx.user._id,
    });
    return cleanAi(translated) || query.trim();
  } catch {
    return query.trim();
  }
}

export async function searchExerciseCatalog(ctx: MyContext, query: string, limit = 5): Promise<CatalogExercise[]> {
  const cleaned = extractExerciseQuery(query);
  const english = await translateExerciseQueryToEnglish(ctx, cleaned);
  // Specific phrasings first; the equipment-stripped forms are last-resort so exact matches win
  // and we still find the movement (not a near-duplicate) when only the implement differs.
  const variants = [...new Set(
    [english, cleaned, query, stripEquipmentWords(english), stripEquipmentWords(cleaned)]
      .map((q) => q.trim())
      .filter(Boolean),
  )];
  for (const q of variants) {
    const found = await searchExercisesByName(ctx.db, q, limit, ctx.user.lang);
    if (found.length) return found;
  }
  return [];
}

export async function promptExerciseConfirmation(
  ctx: MyContext,
  payload: {
    action: "swap" | "add";
    weekday: Weekday;
    query: string;
    englishQuery: string;
    catalog: CatalogExercise;
    index?: number;
    source?: "ai_coach" | "manual";
  },
) {
  const lang = ctx.user.lang;
  const localized = lang === "en" ? payload.catalog.name : (await exerciseInfoEntry(ctx, payload.catalog.id, lang))?.name ?? payload.catalog.name;
  const session = switchMode(ctx.user.session, "exercise_confirm", {
    pendingExercise: {
      action: payload.action,
      weekday: payload.weekday,
      index: payload.index,
      query: payload.query,
      englishQuery: payload.englishQuery,
      catalogId: payload.catalog.id,
      source: payload.source,
    },
  });
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;
  const kb = new InlineKeyboard()
    .text(t(lang, "confirm_yes"), "ex:yes")
    .text(t(lang, "confirm_no"), "ex:no");
  await reply(ctx, t(lang, "exercise_confirm_question", { name: localized }), kb);
}

// After a swap/add, offer the new exercise's weight & sets right away — the replacement
// almost always needs different numbers, and these are the same wt:/st: flows the day editor uses.
export function swapTuneKb(lang: Lang, weekday: Weekday, index: number): InlineKeyboard {
  return new InlineKeyboard()
    .text(t(lang, "plan_diff_edit_weight"), `wt:${weekday}:${index}`)
    .text(t(lang, "plan_diff_edit_sets"), `st:${weekday}:${index}`);
}

export async function applyCatalogExerciseChoice(
  ctx: MyContext,
  payload: NonNullable<MyContext["user"]["session"]["pendingExercise"]>,
  catalog: CatalogExercise,
) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  if (!plan) {
    await reply(ctx, t(lang, "no_plan"), menuBtn(lang));
    return;
  }
  const day = getPlanDay(plan, payload.weekday);
  if (!day) {
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
    return;
  }
  // AI-coach and manual add/swap both land here — the single place that actually writes the new
  // exercise into the plan, so it's the right gate for "AI proposes, domain logic decides": a
  // DIRECT conflict with an active injury (same rule the injury-report auto-swap already uses)
  // blocks the write instead of silently applying it. Related-only conflicts still go through.
  const activeInjuries = await listActiveInjuries(ctx.db, planOwnerId(ctx));
  if (activeInjuries.length) {
    const conflict = checkExerciseAgainstInjuries({ name: catalog.name, muscles: catalog.muscle }, activeInjuries);
    if (conflict.blocked && conflict.area) {
      const areaLabel = t(lang, `inj_area_${conflict.area}` as Parameters<typeof t>[1]);
      await reply(ctx, t(lang, "safety_exercise_blocked_injury", { name: catalog.name, area: areaLabel }), menuBtn(lang));
      return;
    }
  }
  // Localize the single new exercise directly from the (cached) catalog translation — the same
  // entry the confirmation showed. This is deterministic and avoids running the whole split
  // through the bulk AI translator, which could fail and leave the exercise in English.
  const oLang = await planOwnerLang(ctx);
  const info = oLang === "en" ? null : await exerciseInfoEntry(ctx, catalog.id, oLang).catch(() => null);
  const exName = info?.name || catalog.name;
  const exTech = info?.instructions || catalog.instructions;
  // Classify the NEW exercise by its canonical name so a plank/cardio swapped or added via the
  // catalog gets the right metric + sensible default sets — not the reps scheme it replaced.
  const metric = exerciseMetric({ name: catalog.name });
  const timed = metric !== "reps";
  let fromName = "";
  if (payload.action === "swap") {
    const current = payload.index !== undefined ? day.exercises[payload.index] : undefined;
    if (!current) {
      await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
      return;
    }
    fromName = current.name;
    day.exercises[payload.index!] = {
      exerciseId: catalog.id,
      canonicalName: catalog.name,
      name: exName,
      // Keep the rep scheme for a like-for-like reps swap, but never carry the old absolute load
      // (e.g. a 100 kg back squat → goblet squat). Timed/cardio get their own default sets.
      sets: timed ? defaultSetsForMetric(metric, catalog) : current.sets,
      startWeight: timed ? "Bodyweight" : defaultStartWeightForExercise(catalog),
      technique: exTech || current.technique,
      isKeyLift: timed ? false : current.isKeyLift,
      muscles: catalog.muscle,
      ...(timed ? { metric } : {}),
    };
  } else {
    day.exercises.push({
      exerciseId: catalog.id,
      canonicalName: catalog.name,
      name: exName,
      sets: defaultSetsForMetric(metric, catalog),
      startWeight: timed ? "Bodyweight" : defaultStartWeightForExercise(catalog),
      technique: exTech,
      isKeyLift: false,
      muscles: catalog.muscle,
      ...(timed ? { metric } : {}),
    });
  }

  await updateActivePlanSplit(ctx.db, planOwnerId(ctx), plan.split);

  const updatedDay = plan.split.find((d) => d.weekday === payload.weekday);
  if (payload.action === "swap") {
    const swapped = updatedDay?.exercises[payload.index ?? 0];
    await recordPlanChange(ctx.db, planOwnerId(ctx), payload.source ?? "manual", `swap: ${fromName} -> ${swapped?.name ?? catalog.name}`).catch(() => {});
    await reply(
      ctx,
      t(lang, "swap_done", { from: fromName, to: swapped?.name ?? catalog.name }),
      swapTuneKb(lang, payload.weekday, payload.index ?? 0),
    );
  } else {
    await recordPlanChange(ctx.db, planOwnerId(ctx), payload.source ?? "manual", `add: ${updatedDay?.exercises.at(-1)?.name ?? catalog.name}`).catch(() => {});
    await reply(
      ctx,
      t(lang, "add_exercise_done", { name: updatedDay?.exercises.at(-1)?.name ?? catalog.name }),
      updatedDay ? swapTuneKb(lang, payload.weekday, updatedDay.exercises.length - 1) : undefined,
    );
  }
  // Re-show the full edit-day menu automatically after an add / custom swap (both surfaces).
  if (isEditingOther(ctx)) await reRenderEditDay(ctx, payload.weekday);
  else await endSelfEdit(ctx, String(payload.weekday));
}

export async function handleExerciseConfirmation(ctx: MyContext, accept: boolean) {
  const lang = ctx.user.lang;
  const pending = ctx.user.session.pendingExercise;
  if (!pending) {
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
    return;
  }
  // "✅ Так" → add the resolved catalog exercise.
  if (accept) {
    await setMode(ctx, "idle");
    if (pending.catalogId) {
      const catalog = await getCatalogExercise(ctx.db, pending.catalogId);
      if (catalog) {
        await applyCatalogExerciseChoice(ctx, pending, catalog);
        return;
      }
    }
    // Accepted, but the suggestion had no stored catalog entry (rare) — author it.
    await aiAuthorAndAdd(ctx, pending);
    return;
  }
  // "✏️ Ні, інша вправа" → don't guess: offer real catalog alternatives for the user's query,
  // plus "type another name" and an explicit "let the bot create it" fallback. Nothing is
  // added until the user picks.
  await showExerciseConfirmAlternatives(ctx, pending);
}

// AI-author one exercise from the user's free-text query and add it. Used only when the user
// explicitly asks the bot to create it (no catalog match they liked).
export async function aiAuthorAndAdd(ctx: MyContext, pending: PendingExercise) {
  const lang = ctx.user.lang;
  const plan = await getActivePlan(ctx.db, planOwnerId(ctx));
  const day = plan ? getPlanDay(plan, pending.weekday) : undefined;
  if (!plan || !day) {
    await reply(ctx, t(lang, "error_generic"), menuBtn(lang));
    return;
  }
  const current = pending.action === "swap" && pending.index !== undefined ? day.exercises[pending.index] : undefined;
  try {
    await ctx.replyWithChatAction("typing").catch(() => {});
    const catalog = await createExerciseCatalogEntry(ctx, pending.query, day, pending.action, current, pending.englishQuery, pending.catalogId);
    await applyCatalogExerciseChoice(ctx, pending, catalog);
  } catch (err) {
    await onError(ctx, err, "exercise_confirm");
  }
}

// Show other library matches for the user's query (the rejected suggestion excluded). Keeps the
// pending request in the session and switches to "exercise_alt" mode so a typed reply re-searches.
export async function showExerciseConfirmAlternatives(ctx: MyContext, pending: PendingExercise) {
  const lang = ctx.user.lang;
  const session = switchMode(ctx.user.session, "exercise_alt", { pendingExercise: pending });
  await updateUser(ctx.db, ctx.user._id, { session });
  ctx.user.session = session;

  // Re-use the already-resolved English query / original query — no extra AI translate call.
  const variants = [...new Set([pending.englishQuery, pending.query].map((q) => q.trim()).filter(Boolean))];
  let matches: CatalogExercise[] = [];
  for (const q of variants) {
    const found = await searchExercisesByName(ctx.db, q, 6, lang);
    if (found.length) { matches = found; break; }
  }
  const alts = matches.filter((m) => m.id !== pending.catalogId).slice(0, 4);

  if (!alts.length) {
    const kb = new InlineKeyboard()
      .text(t(lang, "exercise_alt_type_btn"), "exa:type")
      .row()
      .text(t(lang, "exercise_alt_ai_btn"), "exa:ai");
    await reply(ctx, t(lang, "exercise_alt_none"), kb);
    return;
  }

  const kb = new InlineKeyboard();
  for (const c of alts) {
    // Localizing each label is best-effort — a translate failure must not crash the menu.
    let name = c.name;
    if (lang !== "en") {
      try { name = (await exerciseInfoEntry(ctx, c.id, lang))?.name ?? c.name; } catch { /* keep English */ }
    }
    kb.text(cleanAi(name).slice(0, 60), `exa:pick:${c.id}`).row();
  }
  kb.text(t(lang, "exercise_alt_type_btn"), "exa:type").row();
  kb.text(t(lang, "exercise_alt_ai_btn"), "exa:ai");
  await reply(ctx, t(lang, "exercise_alt_pick"), kb);
}

// Text handler for "exercise_alt": a typed reply is a fresh exercise name → re-run the
// add/swap-by-name flow (which prompts confirmation again).
export async function handleExerciseAltText(ctx: MyContext, text: string) {
  const pending = ctx.user.session.pendingExercise;
  await setMode(ctx, "idle");
  if (!pending) {
    await reply(ctx, t(ctx.user.lang, "error_generic"), menuBtn(ctx.user.lang));
    return;
  }
  const query = extractExerciseQuery(text);
  if (pending.action === "swap" && pending.index !== undefined) {
    await swapExerciseByName(ctx, pending.weekday, pending.index, query);
  } else {
    await addExerciseByName(ctx, pending.weekday, query);
  }
}

// ---------------- warm-up editing (user + trainer/owner) ----------------
// showWarmupEditor/saveWarmup/suggestWarmup/handleWarmupEdit moved to bot/warmup.ts (god-file
// split). The rest of this section (below) is core plan/exercise infrastructure most other
// bot/*.ts files depend on — stayed in the kernel.

// Resolve a catalog id + canonical name for one (ungrounded) plan exercise: match the
// catalog by its name (UA/EN), else AI-author a catalog entry (coach). No mutation here.
export async function groundExercise(
  ctx: MyContext,
  day: PlanDay,
  ex: PlanExercise,
): Promise<{ id: string; name: string } | null> {
  try {
    const matches = await searchExerciseCatalog(ctx, ex.name, 1);
    if (matches.length) return { id: matches[0].id, name: matches[0].name };
    const cat = await createExerciseCatalogEntry(
      ctx,
      ex.name,
      day,
      "add",
      undefined,
      await translateExerciseQueryToEnglish(ctx, ex.name),
    );
    return { id: cat.id, name: cat.name };
  } catch {
    return null;
  }
}

// Localize a plan's exercise DISPLAY names into `lang`, preserving the English canonicalName for
// matching/PRs/videos. adaptPlan (bank/template/shared-program snapshots) copies exercise names
// verbatim, so a uk client assigned an English-authored template sees "Dumbbell Bench Press"
// instead of "Жим гантелей лежачи". This grounds any ungrounded exercise (so the catalog holds a
// translation), then swaps in the cached/seeded/AI-translated name. English plans and
// already-Cyrillic names are skipped, so a healthy plan costs only a scan — no AI, no writes.
// Mutates `plan` in place; returns whether anything changed. Call right after adaptPlan().
export async function localizePlanNames(ctx: MyContext, plan: PlanDoc, lang: Lang): Promise<boolean> {
  if (lang === "en") return false;
  const CYR = /[Ѐ-ӿ]/;
  let changed = false;
  for (const day of plan.split) {
    for (const ex of day.exercises ?? []) {
      if (CYR.test(ex.name)) continue; // already localized
      let id = ex.exerciseId;
      if (!id) {
        const g = await groundExercise(ctx, day, ex);
        if (g) { id = ex.exerciseId = g.id; ex.canonicalName = g.name; changed = true; }
      }
      if (!id) continue;
      const info = await exerciseInfoEntry(ctx, id, lang).catch(() => null);
      const localized = info?.name ? cleanAi(info.name) : "";
      if (localized && CYR.test(localized) && localized !== ex.name) {
        if (!ex.canonicalName) ex.canonicalName = ex.name; // keep the English name for matching
        ex.name = localized;
        changed = true;
      }
    }
  }
  return changed;
}

// Render-time self-heal: localize a plan's exercise names on display and persist the result once,
// so a plan that stored English names (a pre-localization template/shared assign, or an ungrounded
// draft) is corrected the first time anyone views it — not only when it's next (re)assigned. A
// healthy (already-Cyrillic) plan costs a scan and no write. `lang` is the plan OWNER's language
// (not the viewer's), so a trainer opening a client's plan persists names in the client's language.
export async function healPlanNamesForDisplay(ctx: MyContext, plan: PlanDoc, lang: Lang): Promise<PlanDoc> {
  const changed = await localizePlanNames(ctx, plan, lang);
  if (changed) {
    if (plan.status === "draft") await saveDraftPlan(ctx.db, plan).catch(() => {});
    else await updateActivePlanSplit(ctx.db, plan.userId, plan.split).catch(() => {});
  }
  return plan;
}

// Send full 📖 instructions + ⚠️ safety for EVERY exercise of a day as a separate message.
// Exercises that aren't catalog-grounded yet are grounded on demand (match or AI-author) and
// the new ids are persisted so info works for all of them. Each block is a single-line
// <b>name</b> header + plain escaped text → sendLong can chunk safely (no entity spans a chunk).
export async function sendExerciseDescriptions(ctx: MyContext, dayArg: PlanDay, lang: Lang) {
  const plan = await getActivePlan(ctx.db, ctx.user._id);
  const day = plan?.split.find((d) => d.weekday === dayArg.weekday) ?? dayArg;
  if (!day.exercises.length) return;

  // Ground any ungrounded exercises (in parallel), then persist if anything changed.
  const ungrounded = day.exercises.filter((e) => !e.exerciseId);
  if (ungrounded.length) {
    const grounds = await Promise.all(ungrounded.map((e) => groundExercise(ctx, day, e)));
    let changed = false;
    ungrounded.forEach((e, i) => {
      const g = grounds[i];
      if (g) {
        e.exerciseId = g.id;
        e.canonicalName = g.name;
        changed = true;
      }
    });
    if (changed && plan) await updateActivePlanSplit(ctx.db, ctx.user._id, plan.split);
  }

  const results = await Promise.all(
    day.exercises.map((e) => (e.exerciseId ? exerciseInfoEntry(ctx, e.exerciseId, lang) : null)),
  );
  const blocks: string[] = [];
  day.exercises.forEach((e, i) => {
    const r = results[i];
    const instr = (r?.instructions ?? "").replace(/\s+/g, " ").trim();
    const safety = (r?.safety ?? "").replace(/\s+/g, " ").trim();
    let b = `📖 <b>${escapeHtml(cleanAi(r?.name || e.name))}</b>`;
    if (instr) b += `\n${escapeHtml(instr)}`;
    if (safety) b += `\n⚠️ ${escapeHtml(safety)}`;
    blocks.push(b);
  });
  if (blocks.length) await reply(ctx, blocks.join("\n\n"));
}

export async function exerciseIdForName(name: string): Promise<string> {
  const bytes = new TextEncoder().encode(name.toLowerCase().trim());
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

export async function createExerciseCatalogEntry(
  ctx: MyContext,
  query: string,
  day: PlanDay,
  mode: "swap" | "add",
  current?: PlanExercise,
  normalizedQuery?: string,
  excludeId?: string,
): Promise<CatalogExercise> {
  const currentCatalog = current?.exerciseId ? await getCatalogExercise(ctx.db, current.exerciseId) : null;
  // When the user rejected a suggestion ("Ні, інша вправа"), tell the AI to pick a different one.
  const excluded = excludeId ? await getCatalogExercise(ctx.db, excludeId) : null;
  const hint = excluded
    ? `${normalizedQuery ?? ""} — IMPORTANT: do NOT return "${excluded.name}"; the user said that is a different exercise, so author the exercise they actually mean.`
    : normalizedQuery;
  const result = await aiJSON<P.ExerciseCatalogResult>(ctx.env, {
    system: P.exerciseCatalogSystem(ctx.user.lang),
    user: P.exerciseCatalogUser(
      query,
      hint,
      current?.name ?? "",
      day.muscleGroup,
      ctx.user.profile.equipment ?? "n/a",
      ctx.user.profile.level ?? "beginner",
      mode,
      ctx.user.profile.limitations,
      ctx.user.profile.dislikedExercises,
    ),
    schema: P.EXERCISE_CATALOG_SCHEMA,
    temperature: 0.3,
    kind: "plan",
    db: ctx.db,
    userId: ctx.user._id,
  });
  const name = cleanAi(result.name) || cleanAi(query);
  const muscle = cleanAi(result.muscle) || currentCatalog?.muscle || muscleGroupToEnum(day.muscleGroup) || "middle back";
  const difficulty = cleanAi(result.difficulty) || currentCatalog?.difficulty || ctx.user.profile.level || "beginner";
  const equipment = (result.equipments ?? []).map((e) => cleanAi(e)).filter(Boolean);
  const catalog: CatalogExercise = {
    id: await exerciseIdForName(name),
    name,
    type: cleanAi(result.type) || undefined,
    muscle,
    difficulty,
    equipments: equipment,
    instructions: cleanAi(result.instructions),
    safetyInfo: cleanAi(result.safetyInfo),
  };
  await upsertExercise(ctx.db, catalog);
  return catalog;
}
