// Building a plan document: the AI split, exercise and methodology translation, technique
// validation, and swaps for exercises the user dislikes. No Telegram context in here.
import { computeTargets, restDayTargets } from "../domain/mealplan";
import { autoBalanceSplit } from "../domain/planAutoBalance";
import type { CatalogExercise, Env, Lang, PlanDay, PlanExercise, PlanDoc, UserDoc, Weekday } from "../types";
import type { AiPlanResponse as AiPlan } from "../domain/plan-schema";
import type { MyContext } from "../adapters/telegram/context";
import { logInfo } from "../log";
import { countExercises, getCatalogExercise, getExerciseTranslation, listCandidatesByMuscles } from "../adapters/d1/v2Catalog";
import { finishGeneratedSplit } from "../domain/planAdapt";
import { fitsKit, kitFromEquipment } from "../domain/equipmentFit";
import { fitsEquipmentPreset } from "../domain/gymSwap";
import { PLAN_SCHEMA_VERSION, parseAiPlanResponse } from "../domain/plan-schema";
import { exerciseCountLimits } from "../domain/plan-lint";
import { API_MUSCLES } from "../domain/exerciseClass";
import { reconcileGrounding } from "../domain/progression";
import { localParts } from "../domain/localTime";
import { computeCyclePhase, phaseHint, phaseLabel } from "../domain/cycle";
import { cleanAi } from "../locales/i18n";
import { aiJSON } from "../ai/index";
import * as P from "../ai/prompts";

// AI-build a PlanDoc for `forUserId` from a profile (not saved). Reused by solo plans,
// client onboarding drafts, and trainer-generated drafts.
// Guard: reject technique strings that look like truncated/broken output (e.g. "1.", "1. ").
export function isValidTechnique(s?: string): boolean {
  if (!s) return false;
  const t = s.trim();
  return t.length > 15 && !/^\d+\.?\s*$/.test(t);
}

// Translate exercise-level fields (name, technique, muscles, muscleGroup) from English
// to the user's language via a dedicated translator prompt. Called after plan generation
// for non-English users so the AI picks exercises from the catalog in English first
// (best for ID matching) and then the translation runs as a fast, cheap second step.
export async function translatePlanExercises(
  env: Env,
  lang: Lang,
  split: PlanDay[],
  db: D1Database,
  userId: number,
): Promise<PlanDay[]> {
  if (lang === "en") return split;
  const inputDays = split.map((d) => ({
    muscleGroup: d.muscleGroup,
    ...(d.warmUp?.length ? { warmUp: d.warmUp } : {}),
    ...(d.coolDown?.length ? { coolDown: d.coolDown } : {}),
    exercises: d.exercises.map((e) => ({
      ...(e.canonicalName ? { canonicalName: e.canonicalName } : {}),
      name: e.name,
      technique: e.technique,
      muscles: e.muscles ?? "",
      ...(e.warmupScheme ? { warmupScheme: e.warmupScheme } : {}),
    })),
  }));
  try {
    const result = await aiJSON<P.TranslateExercisesResult>(env, {
      system: P.translateExercisesSystem(lang),
      user: P.translateExercisesUser(inputDays),
      schema: P.TRANSLATE_EXERCISES_SCHEMA,
      temperature: 0.2,
      kind: "translate",
      db,
      userId,
    });
    return split.map((day, i) => {
      const td = result.days?.[i];
      if (!td) return day;
      return {
        ...day,
        muscleGroup: cleanAi(td.muscleGroup) || day.muscleGroup,
        warmUp: td.warmUp?.length ? td.warmUp.map(cleanAi) : day.warmUp,
        coolDown: td.coolDown?.length ? td.coolDown.map(cleanAi) : day.coolDown,
        exercises: day.exercises.map((e, j) => {
          const te = td.exercises?.[j];
          if (!te) return e;
          // Translate "Bodyweight" placeholder; append "kg" if unit was dropped by AI.
          const rawWeight = e.startWeight;
          const startWeight =
            rawWeight === "Bodyweight"
              ? "Власна вага"
              : /^\d+(\.\d+)?$/.test(rawWeight.trim())
                ? `${rawWeight.trim()} kg`
                : rawWeight;
          return {
            ...e,
            name: cleanAi(te.name) || e.name,
            technique: isValidTechnique(te.technique) ? cleanAi(te.technique) : e.technique,
            muscles: cleanAi(te.muscles) || e.muscles,
            startWeight,
            warmupScheme: te.warmupScheme ? cleanAi(te.warmupScheme) : e.warmupScheme,
          };
        }),
      };
    });
  } catch {
    // Translation is best-effort — fall back to English if it fails.
    return split;
  }
}

// Translate methodology + nutrition.notes from English to the user's language.
// Best-effort: falls back to the original English strings on any AI/parse error.
export async function translatePlanMeta(
  env: Env,
  lang: Lang,
  methodology: string,
  nutritionNotes: string | undefined,
  db: D1Database,
  userId: number,
): Promise<{ methodology: string; nutritionNotes: string | undefined }> {
  if (lang === "en" || (!methodology && !nutritionNotes)) return { methodology, nutritionNotes };
  try {
    const result = await aiJSON<P.TranslateMetaResult>(env, {
      system: P.translateMetaSystem(lang),
      user: P.translateMetaUser(methodology, nutritionNotes ?? ""),
      schema: P.TRANSLATE_META_SCHEMA,
      temperature: 0.2,
      kind: "translate",
      db,
      userId,
    });
    return {
      methodology: cleanAi(result.methodology) || methodology,
      nutritionNotes: nutritionNotes !== undefined ? (cleanAi(result.nutritionNotes) || nutritionNotes) : undefined,
    };
  } catch {
    return { methodology, nutritionNotes };
  }
}

export async function buildPlanDoc(
  ctx: MyContext,
  lang: Lang,
  profile: UserDoc["profile"],
  forUserId: number,
  opts: { prs?: string; authoredBy?: number; trainerStyle?: string } = {},
): Promise<PlanDoc> {
  return buildPlanDocRaw(ctx.env, ctx.db, lang, profile, forUserId, opts);
}

// Transform a validated AI plan's split into clean PlanDays: sanitize every text field, clamp
// weekdays, and re-anchor each exercise to a real catalog id (dropping hallucinated ids and
// fixing name/id mismatches via reconcileGrounding). Pure — no I/O.
export function aiSplitToPlanDays(
  aiSplit: AiPlan["split"],
  candidates: CatalogExercise[],
  candidateIds: Set<string>,
): PlanDay[] {
  const clean = (v?: string) => (v ? cleanAi(v) : undefined);
  const cleanList = (arr?: string[]) =>
    (arr ?? []).map((s) => cleanAi(s)).filter((s) => s.trim().length > 0);
  return aiSplit.map((d) => {
    const warmUp = cleanList(d.warmUp);
    const coolDown = cleanList(d.coolDown);
    return {
    weekday: Math.min(7, Math.max(1, Math.round(d.weekday))) as Weekday,
    muscleGroup: d.muscleGroup,
    ...(d.sessionType ? { sessionType: cleanAi(d.sessionType) } : {}),
    ...(typeof d.durationMin === "number" ? { durationMin: d.durationMin } : {}),
    ...(warmUp.length ? { warmUp } : {}),
    ...(coolDown.length ? { coolDown } : {}),
    exercises: (d.exercises ?? []).map((e) => {
      // Keep the catalog link only if the AI copied a real id (drop hallucinated ids), then
      // re-anchor by name: the model sometimes links a well-described movement to an
      // unrelated-but-valid id (e.g. a lateral raise grounded to a shrug). reconcileGrounding
      // switches to the best name match or drops the grounding so no wrong video/info attaches.
      const validId = e.exerciseId && candidateIds.has(e.exerciseId) ? e.exerciseId : undefined;
      const link = reconcileGrounding(cleanAi(e.name), validId, candidates);
      const ss = clean(e.supersetGroup);
      const role = clean(e.role);
      return {
        name: cleanAi(e.name),
        sets: cleanAi(e.sets),
        startWeight: cleanAi(e.startWeight),
        technique: cleanAi(e.technique),
        muscles: cleanAi(e.muscles),
        isKeyLift: !!e.isKeyLift,
        ...(e.metric === "time" || e.metric === "distance" ? { metric: e.metric } : {}),
        ...(clean(e.rpe) ? { rpe: clean(e.rpe) } : {}),
        ...(clean(e.rir) ? { rir: clean(e.rir) } : {}),
        ...(clean(e.rest) ? { rest: clean(e.rest) } : {}),
        ...(clean(e.tempo) ? { tempo: clean(e.tempo) } : {}),
        ...(clean(e.heartRateZone) ? { heartRateZone: clean(e.heartRateZone) } : {}),
        ...(clean(e.movementPattern) ? { movementPattern: clean(e.movementPattern) } : {}),
        ...(role === "primary" || role === "accessory" ? { role } : {}),
        ...(clean(e.warmupScheme) ? { warmupScheme: clean(e.warmupScheme) } : {}),
        ...(ss ? { supersetGroup: ss.slice(0, 1).toUpperCase() } : {}),
        ...(link ? { exerciseId: link.id, canonicalName: link.name } : {}),
      };
    }),
    };
  });
}

export async function buildPlanDocRaw(
  env: Env,
  db: D1Database,
  lang: Lang,
  profile: UserDoc["profile"],
  forUserId: number,
  opts: { prs?: string; authoredBy?: number; trainerStyle?: string } = {},
): Promise<PlanDoc> {
  // Ground the plan in real catalog exercises when the catalog is seeded; otherwise the
  // candidate list is empty and the prompt is identical to the legacy AI-invent behavior.
  // Only exercises the person can do with their equipment are offered to the model.
  const kit = kitFromEquipment(profile.equipment);
  const candidates = (await countExercises(db))
    ? (await listCandidatesByMuscles(db, [...API_MUSCLES], { level: profile.level, perMuscle: 20, total: 320 }))
        .filter((c) => kit === "gym" || (fitsKit({ name: c.name }, kit) && (kit === "bodyweight"
          ? fitsEquipmentPreset(c.equipments, "bodyweight")
          : fitsEquipmentPreset(c.equipments, "dumbbells") || (kit === "home" && fitsEquipmentPreset(c.equipments, "band")))))
    : [];
  const candidateIds = new Set(candidates.map((c) => c.id));
  // Same phase computation coachContext() already uses for the chat coach — give the initial
  // plan generation the same ready-made instruction instead of just the raw JSON fields, which
  // planSystem's checklist never actually told the model what to do with.
  const cyclePhase = computeCyclePhase(profile, localParts(profile.timezone).date);
  const cycleHint = cyclePhase
    ? `${phaseLabel(cyclePhase.phase)} (day ${cyclePhase.day}/${cyclePhase.cycleLength}) — ${phaseHint(cyclePhase.phase)}`
    : undefined;
  const limits = exerciseCountLimits(profile);
  const aiRaw = await aiJSON<AiPlan>(env, {
    system: P.planSystem(lang),
    user: P.planUser(profile, opts.prs, candidates, opts.trainerStyle, cycleHint),
    schema: P.PLAN_SCHEMA,
    temperature: 0.35,
    kind: "plan",
    db,
    userId: forUserId,
    attemptsPerKey: 2, // give each key 2 generations before rotating
    // Reject degenerate plans (the bug where a model returns 1 exercise/day): every
    // training day must carry a full session. A rejected result is retried/rotated.
    validate: (parsed) => {
      const p = parsed as AiPlan;
      if (!Array.isArray(p.split) || p.split.length === 0) throw new Error("plan: empty split");
      // Expected training days = the user's chosen weekdays (or daysPerWeek). Reject a plan with
      // fewer days than requested (the "one-day draft" bug where the model collapses the split).
      const expectedDays = Math.min(7, Math.max(1, profile.trainingWeekdays?.length || profile.daysPerWeek || 3));
      if (p.split.length < expectedDays) {
        throw new Error(`plan: ${p.split.length} day(s) < expected ${expectedDays}`);
      }
      for (const d of p.split) {
        const n = Array.isArray(d.exercises) ? d.exercises.length : 0;
        if (n < limits.min || n > limits.max) {
          throw new Error(`plan: weekday ${d.weekday} has ${n} exercises (expected ${limits.min}-${limits.max})`);
        }
      }
    },
  });
  // Guard against a parseable-but-wrong-shape AI response (e.g. a weak fallback model): fail
  // clearly here so the caller shows a retry instead of crashing on undefined further down, or
  // silently saving a plan built from missing/malformed fields. PLAN_SCHEMA requires both
  // `split` and `nutrition`, but that's only Gemini-enforced — a fallback provider (Groq/
  // OpenRouter) only guarantees valid JSON syntax, not these keys being present or well-typed.
  const ai = parseAiPlanResponse(aiRaw);
  const split = aiSplitToPlanDays(ai.split, candidates, candidateIds);
  // Translate exercise fields (name/technique/muscles/muscleGroup) from English to the
  // user's language. The plan prompt always outputs these in English for best catalog
  // ID matching; translation runs as a fast second step.
  const translatedSplitRaw = await translatePlanExercises(env, lang, split, db, forUserId);
  // A lopsided plan (no back work, hamstrings far behind the quads...) is fixed here, before it
  // is saved, rather than only warned about under the plan (domain/planAutoBalance.ts).
  const balanced = autoBalanceSplit(translatedSplitRaw, lang, limits.max);
  if (balanced.added.length) logInfo("plan_autobalanced", { added: balanced.added.map((a) => `${a.issue}:${a.slug}`).join(",") });
  // Then keep it inside their equipment and set starting weights from their level and stated
  // lifts — the model is told both, but doesn't reliably obey (domain/planAdapt.ts).
  const translatedSplit = finishGeneratedSplit(balanced.split, profile, lang === "en" ? "en" : "uk");
  // Translate plan-level text fields (methodology and nutrition notes) — they come from the AI
  // in English and are not covered by the exercise-translation pass.
  const { methodology: translatedMethodology, nutritionNotes: translatedNutNotes } =
    await translatePlanMeta(env, lang, ai.methodology, ai.nutrition.notes, db, forUserId);
  // NOTE: the technique-video cache is intentionally NOT warmed here. Plan generation already
  // spends a heavy subrequest budget (catalog read + plan AI with fallbacks + translation AI +
  // exercise-translation caching); adding a per-exercise YouTube lookup loop pushed the whole
  // invocation past the Workers subrequest cap ("Too many subrequests" on plan/ai). Videos are
  // populated lazily instead: videosForDays() backfills any cache miss in a waitUntil() when the
  // user first opens the plan/today, and the owner /refreshvideos + backfill cover the rest.
  const formulaNutrition = profile.weightKg && profile.heightCm ? computeTargets(profile) : null;
  return {
    userId: forUserId,
    active: false,
    status: "active",
    authoredBy: opts.authoredBy,
    split: translatedSplit,
    // The model is given the formula targets (planUser) but doesn't reliably copy them — pin them.
    nutrition: {
      ...ai.nutrition,
      ...(formulaNutrition ?? {}),
      ...(translatedNutNotes !== undefined ? { notes: translatedNutNotes } : {}),
    },
    // Rest day follows the pinned training-day numbers (fewer carbs, same protein/fat).
    ...(formulaNutrition
      ? { restDayNutrition: restDayTargets(formulaNutrition) }
      : ai.restDayNutrition && typeof ai.restDayNutrition.calories === "number"
        ? { restDayNutrition: ai.restDayNutrition }
        : {}),
    supplements: [],
    methodology: translatedMethodology,
    ...(ai.movementAudit ? { movementAudit: cleanAi(ai.movementAudit) } : {}),
    generatedAt: new Date(),
    schemaVersion: PLAN_SCHEMA_VERSION,
    ...(typeof ai.stepsTarget === "number" ? { stepsTarget: ai.stepsTarget } : {}),
  };
}

// Resolve disliked / contraindicated exercises in a bank plan to same-muscle catalog
// alternatives (EN+UK attached). Best-effort: any lookup failure just leaves the original.
// Returns a map keyed by the original exercise name AND canonicalName → movement-only override.
export async function resolveDislikedSwaps(
  db: D1Database,
  lang: Lang,
  split: PlanDay[],
  profile: UserDoc["profile"],
): Promise<Map<string, Partial<PlanExercise>>> {
  const out = new Map<string, Partial<PlanExercise>>();
  const raw = `${profile.dislikedExercises ?? ""} ${profile.limitations ?? ""}`.toLowerCase();
  const tokens = raw
    .split(/[,;]+|\band\b|\bor\b/)
    .map((s) => s.replace(/[^a-z\s-]/g, " ").trim())
    .filter((w) => w.length >= 4 && w !== "none");
  if (!tokens.length) return out;
  const usedIds = new Set(split.flatMap((d) => d.exercises.map((e) => e.exerciseId).filter(Boolean) as string[]));
  // The exercises that actually need a swap (disliked/contraindicated and present in the catalog).
  const matched = split
    .flatMap((d) => d.exercises)
    .filter((ex) => ex.exerciseId && tokens.some((tok) => `${ex.name} ${ex.canonicalName ?? ""}`.toLowerCase().includes(tok)));
  if (!matched.length) return out;
  try {
    // Prefetch the independent reads in parallel: catalog rows by id, then candidate pools by muscle.
    const catIds = [...new Set(matched.map((ex) => ex.exerciseId as string))];
    const cats = new Map<string, Awaited<ReturnType<typeof getCatalogExercise>>>(
      await Promise.all(catIds.map(async (id) => [id, await getCatalogExercise(db, id)] as const)),
    );
    const muscles = [...new Set([...cats.values()].filter(Boolean).map((c) => c!.muscle))];
    const candsByMuscle = new Map<string, CatalogExercise[]>(
      await Promise.all(
        muscles.map(
          async (m) => [m, await listCandidatesByMuscles(db, [m], { level: profile.level, perMuscle: 20, total: 20 })] as const,
        ),
      ),
    );
    // Pick sequentially so usedIds dedups picks across exercises (order-dependent — keep in-memory).
    const picks: { ex: PlanExercise; pick: CatalogExercise }[] = [];
    for (const ex of matched) {
      const cat = cats.get(ex.exerciseId as string);
      if (!cat) continue;
      const cands = candsByMuscle.get(cat.muscle) ?? [];
      const pick = cands.find((c) => !usedIds.has(c.id) && !tokens.some((tok) => c.name.toLowerCase().includes(tok)));
      if (!pick) continue;
      usedIds.add(pick.id);
      picks.push({ ex, pick });
    }
    // Batch the UK translations for the chosen replacements.
    const trById =
      lang !== "en"
        ? new Map(
            await Promise.all(
              [...new Set(picks.map((p) => p.pick.id))].map(
                async (id) => [id, await getExerciseTranslation(db, id, "uk")] as const,
              ),
            ),
          )
        : new Map();
    for (const { ex, pick } of picks) {
      let name = pick.name;
      let technique = cleanAi(pick.instructions || "");
      const tr = trById.get(pick.id);
      if (tr) { name = tr.name; technique = cleanAi(tr.instructions); }
      const repl: Partial<PlanExercise> = { name, technique, exerciseId: pick.id, canonicalName: pick.name };
      out.set((ex.canonicalName ?? ex.name).toLowerCase(), repl);
      out.set(ex.name.toLowerCase(), repl);
    }
  } catch {
    /* best-effort — keep originals */
  }
  return out;
}
