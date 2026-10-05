// Muscles for exercises the body map's rules don't know (domain/exerciseMuscles.ts). A name is
// classified once -- the exercise catalog first (exact English or Ukrainian name), then a short
// AI call constrained to the body map's muscle list -- and stored in v2_exercise_muscles. Every
// request and scheduler pass registers the stored rows (cached per isolate), so all callers of
// musclesForExercise count the exercise. New names are picked up by an hourly sweep over recent
// workouts and active plans, and immediately when someone adds their own exercise.
import type { Env } from "./types";
import { aiJSON } from "./ai/index";
import { ALL_SLUGS, cleanSlugs, knownByRules, musclesForExercise, normalizeExerciseName, registerLearnedMuscles, slugForCatalogMuscle, type ExerciseMuscles } from "./domain/exerciseMuscles";

const CACHE_MS = 10 * 60_000;
let loadedAt = 0;

/** Register the stored rows into the shared lookup (at most every 10 minutes per isolate). */
export async function loadLearnedMuscles(db: D1Database, force = false): Promise<void> {
  if (!force && Date.now() - loadedAt < CACHE_MS) return;
  loadedAt = Date.now();
  const r = await db.prepare("SELECT name, primaryMuscles, secondaryMuscles FROM v2_exercise_muscles WHERE primaryMuscles != '[]'").all<{ name: string; primaryMuscles: string; secondaryMuscles: string }>();
  registerLearnedMuscles((r.results ?? []).map((row) => ({ name: row.name, primary: parseList(row.primaryMuscles), secondary: parseList(row.secondaryMuscles) })));
}

function parseList(s: string): string[] {
  try { const v = JSON.parse(s) as unknown; return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; }
}

async function fromCatalog(db: D1Database, name: string): Promise<ExerciseMuscles | null> {
  // SQLite's lower() only folds ASCII, so a Ukrainian name is matched as typed (trimmed) and the
  // English one case-insensitively.
  const row = await db.prepare(`
    SELECT e.name AS name, e.muscle AS muscle FROM v2_exercises e
    WHERE e.name = ?1 COLLATE NOCASE
       OR e.id IN (SELECT exerciseId FROM v2_exercise_translations WHERE name = ?1)
    LIMIT 1`).bind(name.trim().replace(/\s+/g, " ")).first<{ name: string; muscle: string }>();
  if (!row) return null;
  // The catalog's English name usually is something the rules know (with secondary muscles);
  // otherwise its single primary muscle.
  const byRules = knownByRules(row.name) ? musclesForExercise(row.name) : null;
  if (byRules) return byRules;
  const slug = slugForCatalogMuscle(row.muscle);
  return slug ? { primary: [slug], secondary: [] } : null;
}

async function fromAi(env: Env, name: string): Promise<ExerciseMuscles | null> {
  const out = await aiJSON<{ primary?: unknown; secondary?: unknown }>(env, {
    kind: "translate",
    db: env.DB,
    temperature: 0,
    system: `You classify gym exercises by the muscles they train. Answer ONLY JSON {"primary":[...],"secondary":[...]} using these ids: ${ALL_SLUGS.join(", ")}. primary = the 1-2 main movers, secondary = assisting muscles (0-3). If the text is not a physical exercise, answer {"primary":[],"secondary":[]}.`,
    user: name,
  });
  const primary = cleanSlugs(out?.primary).slice(0, 2);
  if (!primary.length) return null;
  return { primary, secondary: cleanSlugs(out?.secondary).filter((s) => !primary.includes(s)).slice(0, 3) };
}

/** Classify one name and store the result (or a "couldn't classify" marker). Already-known
 *  names are skipped. Returns the muscles when there are any. */
export async function learnExerciseMuscles(env: Env, name: string): Promise<ExerciseMuscles | null> {
  const clean = name.trim().slice(0, 120);
  if (clean.length < 2) return null;
  if (knownByRules(clean)) return musclesForExercise(clean);
  const key = normalizeExerciseName(clean);
  const existing = await env.DB.prepare("SELECT primaryMuscles, secondaryMuscles FROM v2_exercise_muscles WHERE normalizedName = ?").bind(key).first<{ primaryMuscles: string; secondaryMuscles: string }>();
  if (existing) {
    const primary = cleanSlugs(parseList(existing.primaryMuscles));
    return primary.length ? { primary, secondary: cleanSlugs(parseList(existing.secondaryMuscles)) } : null;
  }
  let source = "catalog";
  let muscles = await fromCatalog(env.DB, clean).catch(() => null);
  if (!muscles) {
    source = "ai";
    muscles = await fromAi(env, clean).catch(() => null);
  }
  await env.DB.prepare("INSERT OR IGNORE INTO v2_exercise_muscles (normalizedName, name, primaryMuscles, secondaryMuscles, source, createdAt) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(key, clean, JSON.stringify(muscles?.primary ?? []), JSON.stringify(muscles?.secondary ?? []), muscles ? source : "none", new Date().toISOString()).run();
  if (muscles) registerLearnedMuscles([{ name: clean, primary: muscles.primary, secondary: muscles.secondary }]);
  return muscles;
}

/** Hourly: classify up to `limit` unknown names from the last 30 days of workouts and from
 *  active plans. Bounded so one pass never spends more than a few AI calls. */
export async function learnUnknownExercises(env: Env, limit = 8): Promise<number> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const [logged, planned, done] = await env.DB.batch([
    env.DB.prepare(`SELECT DISTINCT e.name AS name FROM v2_workout_exercises e JOIN v2_workout_sessions s ON s.id = e.sessionId
      WHERE s.date >= ? LIMIT 2000`).bind(since),
    env.DB.prepare(`SELECT DISTINCT e.name AS name FROM v2_plan_exercises e JOIN v2_plan_days d ON d.id = e.dayId JOIN v2_plans p ON p.id = d.planId
      WHERE p.active = 1 LIMIT 2000`),
    env.DB.prepare("SELECT normalizedName FROM v2_exercise_muscles"),
  ]);
  // Compared in JS: SQLite's lower() wouldn't fold Cyrillic.
  const seen = new Set((done?.results ?? []).map((r) => String((r as { normalizedName: string }).normalizedName)));
  const names = [...new Set([...(logged?.results ?? []), ...(planned?.results ?? [])].map((r) => String((r as { name: string }).name)))]
    .filter((n) => !knownByRules(n) && !seen.has(normalizeExerciseName(n)))
    .slice(0, limit);
  let learned = 0;
  for (const n of names) if (await learnExerciseMuscles(env, n).catch(() => null)) learned++;
  return learned;
}
