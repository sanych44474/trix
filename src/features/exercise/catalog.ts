// Exercise catalog use cases: search (with query translation), grounding plan exercises to catalog
// entries (matching or AI-authoring one), localized info, and localizing a plan's display names.
import type { CatalogExercise, Lang, PlanDay, PlanDoc, PlanExercise } from "../../types";
import { saveDraftPlan, updateActivePlanSplit } from "../../adapters/d1/v2Plans";
import { getCatalogExercise, getExerciseTranslation, upsertExerciseTranslation, searchExercisesByName, upsertExercise } from "../../adapters/d1/v2Catalog";
import { cleanAi } from "../../locales/i18n";
import { aiJSON, aiText } from "../../ai";
import * as P from "../../ai/prompts";
import type { MyContext } from "../../adapters/telegram/context";

// What the AI-backed catalog helpers read; the webapp passes a plain object, the bot its grammY context.
type AiCtx = Pick<MyContext, "db" | "env" | "user">;
import { extractExerciseQuery, stripEquipmentWords, muscleGroupToEnum } from "../../domain/exerciseDefaults";

// Instructions + safety for an exercise in the user's language. English is served straight
// from the catalog; other languages are translated on first use and cached so /today is
// instant afterwards. Falls back to the English original if translation fails.
export async function exerciseInfoEntry(
  ctx: AiCtx,
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

export async function translateExerciseQueryToEnglish(ctx: AiCtx, query: string): Promise<string> {
  if (ctx.user.lang === "en") return query.trim();
  try {
    const translated = await aiText(ctx.env, {
      system:
        "Translate exercise names and movement names to canonical English gym terminology only. Return only the English exercise name, with no explanation, punctuation, or quotes.",
      user: query,
      temperature: 0.2,
      kind: "translate",
      // The fixed prompt makes the answer depend on the query alone, and every catalog search by a
      // non-English user asks for it: cache it like nutrition estimates.
      cacheTtlMs: 30 * 86_400_000,
      db: ctx.db,
      userId: ctx.user._id,
    });
    return cleanAi(translated) || query.trim();
  } catch {
    return query.trim();
  }
}

export async function searchExerciseCatalog(ctx: AiCtx, query: string, limit = 5): Promise<CatalogExercise[]> {
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

// Resolve a catalog id + canonical name for one (ungrounded) plan exercise: match the
// catalog by its name (UA/EN), else AI-author a catalog entry (coach). No mutation here.
export async function groundExercise(
  ctx: AiCtx,
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
/** What localizePlanNames resolved for one English exercise name, reusable across plans. */
export type LocalizedName = { id: string; canonicalName?: string; name: string };

/** `memo` (optional) carries results between calls -- a trainer assigning one template to many
 *  clients localizes the same exercises once, not once per client. Keyed by language and name. */
export async function localizePlanNames(ctx: AiCtx, plan: PlanDoc, lang: Lang, memo?: Map<string, LocalizedName>): Promise<boolean> {
  if (lang === "en") return false;
  const CYR = /[Ѐ-ӿ]/;
  let changed = false;
  for (const day of plan.split) {
    for (const ex of day.exercises ?? []) {
      if (CYR.test(ex.name)) continue; // already localized
      const key = `${lang}|${ex.exerciseId ?? ""}|${ex.name}`;
      const known = memo?.get(key);
      if (known) {
        if (ex.exerciseId !== known.id || ex.name !== known.name) changed = true;
        ex.exerciseId = known.id;
        if (known.canonicalName) ex.canonicalName = known.canonicalName;
        if (known.name !== ex.name) {
          if (!ex.canonicalName) ex.canonicalName = ex.name;
          ex.name = known.name;
        }
        continue;
      }
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
      memo?.set(key, { id, ...(ex.canonicalName ? { canonicalName: ex.canonicalName } : {}), name: ex.name });
    }
  }
  return changed;
}

// Render-time self-heal: localize a plan's exercise names on display and persist the result once,
// so a plan that stored English names (a pre-localization template/shared assign, or an ungrounded
// draft) is corrected the first time anyone views it — not only when it's next (re)assigned. A
// healthy (already-Cyrillic) plan costs a scan and no write. `lang` is the plan OWNER's language
// (not the viewer's), so a trainer opening a client's plan persists names in the client's language.
export async function healPlanNamesForDisplay(ctx: AiCtx, plan: PlanDoc, lang: Lang): Promise<PlanDoc> {
  const changed = await localizePlanNames(ctx, plan, lang);
  if (changed) {
    if (plan.status === "draft") await saveDraftPlan(ctx.db, plan).catch(() => {});
    else await updateActivePlanSplit(ctx.db, plan.userId, plan.split).catch(() => {});
  }
  return plan;
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
  ctx: AiCtx,
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
