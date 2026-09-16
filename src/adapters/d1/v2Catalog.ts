// v2-native exercise/library catalog repo (Domain 2 of the v2 cutover — see
// docs/adr/0001-v2-seams-and-staged-cutover.md). Faithful port of src/db/repos/catalog.ts: same
// exported names/signatures (so a call site switches by changing one import), same filters, same
// ordering, same edge cases — but reads/writes ONLY v2_exercises/v2_exercise_translations/
// v2_exercise_videos/v2_user_exercise_videos (migrations/0074_v2_catalog.sql). This domain had no
// prior v2_* schema at all (unlike Domain 1), so 0074 creates it from scratch; see that file's
// header comment for why the legacy 4-table split was kept as-is rather than denormalized.
import type { CatalogExercise, ExerciseTranslation, ExerciseVideo } from "../../types";
import { nowIso, safeJsonParse, type DB } from "../../db/repos/shared";

interface ExerciseRow {
  id: string;
  name: string;
  type: string | null;
  muscle: string;
  difficulty: string | null;
  equipments: string;
  instructions: string;
  safetyInfo: string;
}

function toCatalogExercise(r: ExerciseRow): CatalogExercise {
  return {
    id: r.id,
    name: r.name,
    type: r.type ?? undefined,
    muscle: r.muscle,
    difficulty: r.difficulty ?? undefined,
    equipments: r.equipments ? safeJsonParse<string[]>(r.equipments, []) : [],
    instructions: r.instructions,
    safetyInfo: r.safetyInfo,
  };
}

export async function countExercises(db: DB): Promise<number> {
  const r = await db.prepare("SELECT COUNT(*) AS c FROM v2_exercises").first<{ c: number }>();
  return r?.c ?? 0;
}

export async function getCatalogExercise(db: DB, id: string): Promise<CatalogExercise | null> {
  const r = await db.prepare("SELECT * FROM v2_exercises WHERE id = ?").bind(id).first<ExerciseRow>();
  return r ? toCatalogExercise(r) : null;
}

/** Which of `ids` actually exist in the catalog — for plan_lint's "exercise grounded in a real
 * catalog id" check, without an N-query per exercise in the plan being saved. */
export async function existingCatalogIds(db: DB, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const unique = [...new Set(ids)];
  const placeholders = unique.map(() => "?").join(",");
  const r = await db.prepare(`SELECT id FROM v2_exercises WHERE id IN (${placeholders})`).bind(...unique).all<{ id: string }>();
  return new Set((r.results ?? []).map((row) => row.id));
}

// Returns a random exercise of higher difficulty for the given muscle, excluding excluded ids.
// beginner → intermediate → advanced → expert (tries each level in order, returns first match).
export async function findHarderExercise(
  db: DB,
  muscle: string,
  currentDifficulty: string,
  excludeIds: string[],
): Promise<CatalogExercise | null> {
  const order = ["beginner", "intermediate", "advanced", "expert"];
  const currentIdx = order.indexOf(currentDifficulty);
  // Try each difficulty level above the current one.
  for (let i = Math.max(currentIdx + 1, 1); i < order.length; i++) {
    const pick = await randomExerciseAt(db, muscle, order[i], excludeIds);
    if (pick) return pick;
  }
  return null;
}

// Pick a random exercise from the (small, index-bounded) muscle+difficulty bucket. The
// RANDOM() sort touches only that bucket's rows; without it SQLite returns the same
// deterministic first rows and most of the catalog becomes unreachable for swaps.
async function randomExerciseAt(
  db: DB,
  muscle: string,
  level: string,
  excludeIds: string[],
): Promise<CatalogExercise | null> {
  const notIn = excludeIds.length ? `AND id NOT IN (${excludeIds.map(() => "?").join(",")})` : "";
  const sql = `SELECT * FROM v2_exercises WHERE muscle = ?
    AND name NOT LIKE '%Russian%'
    AND difficulty = ?
    ${notIn}
    ORDER BY RANDOM() LIMIT 16`;
  const r = await db.prepare(sql).bind(muscle, level, ...excludeIds).all<ExerciseRow>();
  const rows = r.results ?? [];
  if (!rows.length) return null;
  return toCatalogExercise(rows[Math.floor(Math.random() * rows.length)]);
}

/** Every catalog exercise for the given muscles, any difficulty — one round-trip so a caller
 * that needs to consider ALL difficulty tiers at once (e.g. picking same-muscle swaps at a
 * specific tier in JS) doesn't run a separate RANDOM()-ordered query per tier per exercise.
 * Capped generously (not per-tier like listCandidatesByMuscles, which would under-represent
 * higher tiers since it caps before the difficulty-ordered rows reach them). */
export async function listExercisesByMusclesAnyLevel(db: DB, muscles: string[]): Promise<CatalogExercise[]> {
  if (!muscles.length) return [];
  const placeholders = muscles.map(() => "?").join(",");
  const r = await db
    .prepare(`SELECT * FROM v2_exercises WHERE muscle IN (${placeholders}) AND name NOT LIKE '%Russian%' LIMIT 300`)
    .bind(...muscles)
    .all<ExerciseRow>();
  return (r.results ?? []).map(toCatalogExercise);
}

// Returns a random exercise of lower difficulty for the given muscle, excluding excluded ids.
export async function findEasierExercise(
  db: DB,
  muscle: string,
  currentDifficulty: string,
  excludeIds: string[],
): Promise<CatalogExercise | null> {
  const order = ["beginner", "intermediate", "advanced", "expert"];
  const currentIdx = order.indexOf(currentDifficulty);
  for (let i = Math.max(currentIdx - 1, 0); i >= 0; i--) {
    const pick = await randomExerciseAt(db, muscle, order[i], excludeIds);
    if (pick) return pick;
  }
  return null;
}

// Search by name, matching on ALL significant query WORDS (token-AND), so an imperfect
// translation ("rear delt fly") still matches a fuller catalog name ("Rear Delt Machine
// Fly"). When `lang` is given, each word may match the English name OR the cached
// translation. Falls back to a whole-phrase LIKE when there are no usable tokens.
export async function searchExercisesByName(
  db: DB,
  query: string,
  limit = 5,
  lang?: string,
): Promise<CatalogExercise[]> {
  const tokens = query
    .toLowerCase()
    .replace(/[%_]/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3)
    .slice(0, 5);
  const conds: string[] = [];
  const binds: unknown[] = [];
  if (lang) binds.push(lang); // JOIN param comes first
  const terms = tokens.length ? tokens : [query.replace(/[%_]/g, "").trim()];
  for (const term of terms) {
    const like = `%${term}%`;
    if (lang) {
      conds.push("(e.name LIKE ? OR t.name LIKE ?)");
      binds.push(like, like);
    } else {
      conds.push("e.name LIKE ?");
      binds.push(like);
    }
  }
  conds.push("e.name NOT LIKE '%Russian%'");
  binds.push(limit);
  const order =
    "ORDER BY CASE e.difficulty WHEN 'beginner' THEN 0 WHEN 'intermediate' THEN 1 ELSE 2 END LIMIT ?";
  const sql = lang
    ? `SELECT DISTINCT e.* FROM v2_exercises e LEFT JOIN v2_exercise_translations t ON t.exerciseId = e.id AND t.lang = ? WHERE ${conds.join(" AND ")} ${order}`
    : `SELECT e.* FROM v2_exercises e WHERE ${conds.join(" AND ")} ${order}`;
  const r = await db.prepare(sql).bind(...binds).all<ExerciseRow>();
  return (r.results ?? []).map(toCatalogExercise);
}

// Candidate exercises for the given API muscle enums, up to `perMuscle` each (compounds/
// beginner-friendly first), capped at `total`. Beginners exclude `expert` difficulty.
export async function listCandidatesByMuscles(
  db: DB,
  muscles: string[],
  opts: { level?: string; perMuscle?: number; total?: number } = {},
): Promise<CatalogExercise[]> {
  if (!muscles.length) return [];
  const perMuscle = opts.perMuscle ?? 8;
  const total = opts.total ?? 40;
  const allowExpert = opts.level === "advanced" || opts.level === "intermediate";
  // One round-trip for all muscles (ordered by difficulty), then bucket per-muscle in JS to keep
  // the original per-muscle cap and input muscle ordering.
  const placeholders = muscles.map(() => "?").join(", ");
  const sql = `SELECT * FROM v2_exercises WHERE muscle IN (${placeholders})
     AND name NOT LIKE '%Russian%'
     ${allowExpert ? "" : "AND (difficulty IS NULL OR difficulty != 'expert')"}
     ORDER BY CASE difficulty WHEN 'beginner' THEN 0 WHEN 'intermediate' THEN 1 ELSE 2 END`;
  const r = await db.prepare(sql).bind(...muscles).all<ExerciseRow>();
  const byMuscle = new Map<string, CatalogExercise[]>();
  for (const row of r.results ?? []) {
    const ex = toCatalogExercise(row);
    const bucket = byMuscle.get(ex.muscle) ?? [];
    if (bucket.length < perMuscle) {
      bucket.push(ex);
      byMuscle.set(ex.muscle, bucket);
    }
  }
  const out: CatalogExercise[] = [];
  for (const m of muscles) {
    for (const ex of byMuscle.get(m) ?? []) {
      out.push(ex);
      if (out.length >= total) return out;
    }
  }
  return out;
}

export async function upsertExercise(db: DB, e: CatalogExercise): Promise<void> {
  await db
    .prepare(
      `INSERT INTO v2_exercises (id, name, type, muscle, difficulty, equipments, instructions, safetyInfo, fetchedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, type = excluded.type, muscle = excluded.muscle,
         difficulty = excluded.difficulty, equipments = excluded.equipments,
         instructions = excluded.instructions, safetyInfo = excluded.safetyInfo,
         fetchedAt = excluded.fetchedAt`,
    )
    .bind(e.id, e.name, e.type ?? null, e.muscle, e.difficulty ?? null, JSON.stringify(e.equipments), e.instructions, e.safetyInfo, nowIso())
    .run();
}

export async function getExerciseTranslation(
  db: DB,
  exerciseId: string,
  lang: string,
): Promise<ExerciseTranslation | null> {
  const r = await db
    .prepare("SELECT name, instructions, safetyInfo FROM v2_exercise_translations WHERE exerciseId = ? AND lang = ?")
    .bind(exerciseId, lang)
    .first<{ name: string; instructions: string; safetyInfo: string }>();
  return r ? { name: r.name, instructions: r.instructions, safetyInfo: r.safetyInfo } : null;
}

/** Batch fetch UK (or other lang) translations for many exercise ids in one query. */
export async function getExerciseTranslations(
  db: DB,
  exerciseIds: string[],
  lang: string,
): Promise<Map<string, ExerciseTranslation>> {
  const out = new Map<string, ExerciseTranslation>();
  if (!exerciseIds.length) return out;
  const placeholders = exerciseIds.map(() => "?").join(",");
  const r = await db
    .prepare(
      `SELECT exerciseId, name, instructions, safetyInfo FROM v2_exercise_translations
       WHERE lang = ? AND exerciseId IN (${placeholders})`,
    )
    .bind(lang, ...exerciseIds)
    .all<{ exerciseId: string; name: string; instructions: string; safetyInfo: string }>();
  for (const row of r.results ?? []) {
    out.set(row.exerciseId, { name: row.name, instructions: row.instructions, safetyInfo: row.safetyInfo });
  }
  return out;
}

// Batched localized-name lookup by exerciseId — for render-time fallback so a plan that stored an
// English name still displays in the user's language when a translation exists.
export async function getExerciseTranslationNames(db: DB, ids: string[], lang: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return out;
  const placeholders = uniq.map(() => "?").join(",");
  const r = await db
    .prepare(`SELECT exerciseId, name FROM v2_exercise_translations WHERE lang = ? AND name <> '' AND exerciseId IN (${placeholders})`)
    .bind(lang, ...uniq)
    .all<{ exerciseId: string; name: string }>();
  for (const row of r.results ?? []) out.set(row.exerciseId, row.name);
  return out;
}

export async function upsertExerciseTranslation(
  db: DB,
  exerciseId: string,
  lang: string,
  tr: ExerciseTranslation,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO v2_exercise_translations (exerciseId, lang, name, instructions, safetyInfo, createdAt)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(exerciseId, lang) DO UPDATE SET
         name = excluded.name, instructions = excluded.instructions, safetyInfo = excluded.safetyInfo`,
    )
    .bind(exerciseId, lang, tr.name, tr.instructions, tr.safetyInfo, nowIso())
    .run();
}

// ---------- exercise technique videos (YouTube shorts cache) ----------

interface ExerciseVideoRow {
  normalizedName: string;
  exerciseName: string;
  youtubeVideoId: string | null;
  youtubeUrl: string | null;
  youtubeTitle: string | null;
  channelName: string | null;
  thumbnailUrl: string | null;
  locked: number;
}

function toExerciseVideo(r: ExerciseVideoRow): ExerciseVideo {
  return {
    normalizedName: r.normalizedName,
    exerciseName: r.exerciseName,
    videoId: r.youtubeVideoId,
    url: r.youtubeUrl,
    title: r.youtubeTitle,
    channelName: r.channelName,
    thumbnailUrl: r.thumbnailUrl,
    locked: !!r.locked,
  };
}

// Single lookup. Returns the row (incl. negative-cache entries where url is null) or undefined
// when the exercise has never been searched — the caller uses that to decide whether to search.
export async function getExerciseVideo(db: DB, key: string): Promise<ExerciseVideo | undefined> {
  const r = await db
    .prepare("SELECT * FROM v2_exercise_videos WHERE normalizedName = ?")
    .bind(key.trim().toLowerCase())
    .first<ExerciseVideoRow>();
  return r ? toExerciseVideo(r) : undefined;
}

// Batched lookup for render prefetch. Keys present in the result Map have a row (value may be a
// negative-cache entry with url=null); keys absent from the Map have never been searched.
export async function getExerciseVideos(db: DB, keys: string[]): Promise<Map<string, ExerciseVideo>> {
  const out = new Map<string, ExerciseVideo>();
  const norm = [...new Set(keys.map((k) => k.trim().toLowerCase()).filter(Boolean))];
  if (!norm.length) return out;
  const placeholders = norm.map(() => "?").join(",");
  const r = await db
    .prepare(`SELECT * FROM v2_exercise_videos WHERE normalizedName IN (${placeholders})`)
    .bind(...norm)
    .all<ExerciseVideoRow>();
  for (const row of r.results ?? []) out.set(row.normalizedName, toExerciseVideo(row));
  return out;
}

// Auto upsert (from search / backfill / refresh). A locked manual override is never overwritten:
// ON CONFLICT only updates when the existing row has locked = 0.
export async function upsertExerciseVideo(db: DB, v: ExerciseVideo): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO v2_exercise_videos
         (normalizedName, exerciseName, youtubeVideoId, youtubeUrl, youtubeTitle, channelName, thumbnailUrl, locked, setBy, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
       ON CONFLICT(normalizedName) DO UPDATE SET
         exerciseName = excluded.exerciseName,
         youtubeVideoId = excluded.youtubeVideoId,
         youtubeUrl = excluded.youtubeUrl,
         youtubeTitle = excluded.youtubeTitle,
         channelName = excluded.channelName,
         thumbnailUrl = excluded.thumbnailUrl,
         updatedAt = excluded.updatedAt
       WHERE v2_exercise_videos.locked = 0`,
    )
    .bind(
      v.normalizedName.trim().toLowerCase(),
      v.exerciseName,
      v.videoId,
      v.url,
      v.title,
      v.channelName,
      v.thumbnailUrl,
      now,
      now,
    )
    .run();
}

// Manual override by a trainer/owner — unconditional upsert that locks the row so refresh and
// background backfill leave it alone.
export async function setManualVideo(
  db: DB,
  key: string,
  exerciseName: string,
  video: { videoId: string; url: string },
  setBy: number,
): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO v2_exercise_videos
         (normalizedName, exerciseName, youtubeVideoId, youtubeUrl, youtubeTitle, channelName, thumbnailUrl, locked, setBy, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL, 1, ?, ?, ?)
       ON CONFLICT(normalizedName) DO UPDATE SET
         exerciseName = excluded.exerciseName,
         youtubeVideoId = excluded.youtubeVideoId,
         youtubeUrl = excluded.youtubeUrl,
         youtubeTitle = NULL,
         channelName = NULL,
         thumbnailUrl = NULL,
         locked = 1,
         setBy = excluded.setBy,
         updatedAt = excluded.updatedAt`,
    )
    .bind(key.trim().toLowerCase(), exerciseName, video.videoId, video.url, setBy, now, now)
    .run();
}

// ---------- per-user video overrides (a user's own link, not shared) ----------

interface UserVideoRow {
  normalizedName: string;
  exerciseName: string;
  youtubeVideoId: string;
  youtubeUrl: string;
}

// Set/replace a user's personal video override for one exercise.
export async function setUserVideo(
  db: DB,
  userId: number,
  key: string,
  exerciseName: string,
  video: { videoId: string; url: string },
): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO v2_user_exercise_videos
         (accountId, normalizedName, exerciseName, youtubeVideoId, youtubeUrl, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(accountId, normalizedName) DO UPDATE SET
         exerciseName = excluded.exerciseName,
         youtubeVideoId = excluded.youtubeVideoId,
         youtubeUrl = excluded.youtubeUrl,
         updatedAt = excluded.updatedAt`,
    )
    .bind(userId, key.trim().toLowerCase(), exerciseName, video.videoId, video.url, now, now)
    .run();
}

// Remove a user's override (reverts to the shared/global video).
export async function deleteUserVideo(db: DB, userId: number, key: string): Promise<boolean> {
  const r = await db
    .prepare("DELETE FROM v2_user_exercise_videos WHERE accountId = ? AND normalizedName = ?")
    .bind(userId, key.trim().toLowerCase())
    .run();
  return (r.meta?.changes ?? 0) > 0;
}

// Batched lookup of a user's overrides, shaped like ExerciseVideo so render can merge them in.
export async function getUserVideos(db: DB, userId: number, keys: string[]): Promise<Map<string, ExerciseVideo>> {
  const out = new Map<string, ExerciseVideo>();
  const norm = [...new Set(keys.map((k) => k.trim().toLowerCase()).filter(Boolean))];
  if (!norm.length) return out;
  const placeholders = norm.map(() => "?").join(",");
  const r = await db
    .prepare(`SELECT * FROM v2_user_exercise_videos WHERE accountId = ? AND normalizedName IN (${placeholders})`)
    .bind(userId, ...norm)
    .all<UserVideoRow>();
  for (const row of r.results ?? []) {
    out.set(row.normalizedName, {
      normalizedName: row.normalizedName,
      exerciseName: row.exerciseName,
      videoId: row.youtubeVideoId,
      url: row.youtubeUrl,
      title: null,
      channelName: null,
      thumbnailUrl: null,
      locked: true,
    });
  }
  return out;
}

// Distinct catalog exercise names — the universe of exercises /refreshvideos iterates over.
export async function listAllCatalogNames(db: DB): Promise<string[]> {
  const r = await db
    .prepare("SELECT name FROM v2_exercises WHERE name NOT LIKE '%Russian%' ORDER BY name")
    .all<{ name: string }>();
  return (r.results ?? []).map((x) => x.name);
}
