// Domain 2 (exercise/library catalog) v2-native repo — src/adapters/d1/v2Catalog.ts.
// Exercises it against the same in-memory D1 harness the legacy repo tests use (test/harness.ts),
// which builds its schema from every migrations/*.sql file, including 0074_v2_catalog.sql
// (v2_exercises/v2_exercise_translations/v2_exercise_videos/v2_user_exercise_videos).
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import type { CatalogExercise } from "../src/types";
import {
  countExercises,
  deleteUserVideo,
  existingCatalogIds,
  findEasierExercise,
  findHarderExercise,
  getCatalogExercise,
  getExerciseTranslation,
  getExerciseTranslationNames,
  getExerciseTranslations,
  getExerciseVideo,
  getExerciseVideos,
  getUserVideos,
  listAllCatalogNames,
  listCandidatesByMuscles,
  listExercisesByMusclesAnyLevel,
  searchExercisesByName,
  setManualVideo,
  setUserVideo,
  upsertExercise,
  upsertExerciseTranslation,
  upsertExerciseVideo,
} from "../src/adapters/d1/v2Catalog";

function makeExercise(overrides: Partial<CatalogExercise> = {}): CatalogExercise {
  return {
    id: overrides.id ?? "ex1",
    name: overrides.name ?? "Bench Press",
    type: overrides.type ?? "strength",
    muscle: overrides.muscle ?? "chest",
    difficulty: overrides.difficulty ?? "beginner",
    equipments: overrides.equipments ?? ["barbell"],
    instructions: overrides.instructions ?? "Lie on bench, press up.",
    safetyInfo: overrides.safetyInfo ?? "Use a spotter.",
  };
}

// ---------- exercises: upsert / get / count / existingCatalogIds ----------

test("upsertExercise + getCatalogExercise: round-trips full fidelity, including equipments JSON", async () => {
  const db = newDb();
  await upsertExercise(db, makeExercise());
  const ex = await getCatalogExercise(db, "ex1");
  assert.deepEqual(ex, makeExercise());
});

test("getCatalogExercise: missing id returns null", async () => {
  const db = newDb();
  assert.equal(await getCatalogExercise(db, "missing"), null);
});

test("upsertExercise: ON CONFLICT updates the existing row in place", async () => {
  const db = newDb();
  await upsertExercise(db, makeExercise({ name: "Bench Press" }));
  await upsertExercise(db, makeExercise({ name: "Barbell Bench Press", difficulty: "intermediate" }));
  assert.equal(await countExercises(db), 1);
  const ex = await getCatalogExercise(db, "ex1");
  assert.equal(ex!.name, "Barbell Bench Press");
  assert.equal(ex!.difficulty, "intermediate");
});

test("countExercises", async () => {
  const db = newDb();
  assert.equal(await countExercises(db), 0);
  await upsertExercise(db, makeExercise({ id: "a" }));
  await upsertExercise(db, makeExercise({ id: "b" }));
  assert.equal(await countExercises(db), 2);
});

test("existingCatalogIds: returns only ids actually present, empty input short-circuits", async () => {
  const db = newDb();
  await upsertExercise(db, makeExercise({ id: "a" }));
  await upsertExercise(db, makeExercise({ id: "b" }));
  const found = await existingCatalogIds(db, ["a", "b", "missing"]);
  assert.deepEqual([...found].sort(), ["a", "b"]);
  assert.deepEqual(await existingCatalogIds(db, []), new Set());
});

// ---------- difficulty search / candidates ----------

test("findHarderExercise / findEasierExercise: walk difficulty tiers, excluding given ids", async () => {
  const db = newDb();
  await upsertExercise(db, makeExercise({ id: "beg", muscle: "back", difficulty: "beginner" }));
  await upsertExercise(db, makeExercise({ id: "int", muscle: "back", difficulty: "intermediate" }));
  await upsertExercise(db, makeExercise({ id: "exp", muscle: "back", difficulty: "expert" }));

  const harder = await findHarderExercise(db, "back", "beginner", []);
  assert.equal(harder!.id, "int");

  const harderExcluded = await findHarderExercise(db, "back", "beginner", ["int"]);
  assert.equal(harderExcluded!.id, "exp");

  const easier = await findEasierExercise(db, "back", "expert", []);
  assert.equal(easier!.id, "int");

  const none = await findHarderExercise(db, "back", "expert", []);
  assert.equal(none, null);
});

test("listExercisesByMusclesAnyLevel: all difficulty tiers, Russian-named rows excluded", async () => {
  const db = newDb();
  await upsertExercise(db, makeExercise({ id: "a", muscle: "legs", difficulty: "beginner" }));
  await upsertExercise(db, makeExercise({ id: "b", muscle: "legs", difficulty: "expert" }));
  await upsertExercise(db, makeExercise({ id: "ru", muscle: "legs", name: "Russian Twist" }));
  await upsertExercise(db, makeExercise({ id: "c", muscle: "arms" }));
  const rows = await listExercisesByMusclesAnyLevel(db, ["legs"]);
  assert.deepEqual(rows.map((r) => r.id).sort(), ["a", "b"]);
  assert.deepEqual(await listExercisesByMusclesAnyLevel(db, []), []);
});

test("listCandidatesByMuscles: per-muscle cap, muscle order preserved, expert excluded for non-advanced level", async () => {
  const db = newDb();
  for (let i = 0; i < 3; i++) {
    await upsertExercise(db, makeExercise({ id: `chest${i}`, muscle: "chest", difficulty: "beginner" }));
  }
  await upsertExercise(db, makeExercise({ id: "chestExpert", muscle: "chest", difficulty: "expert" }));
  await upsertExercise(db, makeExercise({ id: "back0", muscle: "back", difficulty: "beginner" }));

  const beginnerPicks = await listCandidatesByMuscles(db, ["chest", "back"], { perMuscle: 2, total: 40 });
  const chestPicks = beginnerPicks.filter((e) => e.muscle === "chest");
  assert.equal(chestPicks.length, 2);
  assert.ok(chestPicks.every((e) => e.id !== "chestExpert"));
  assert.equal(beginnerPicks[beginnerPicks.length - 1].muscle, "back"); // muscle order preserved

  const advancedPicks = await listCandidatesByMuscles(db, ["chest"], { level: "advanced", perMuscle: 10 });
  assert.ok(advancedPicks.some((e) => e.id === "chestExpert"));

  assert.deepEqual(await listCandidatesByMuscles(db, [], {}), []);
});

test("searchExercisesByName: token-AND match on English name, Russian-named rows excluded", async () => {
  const db = newDb();
  await upsertExercise(db, makeExercise({ id: "a", name: "Rear Delt Machine Fly" }));
  await upsertExercise(db, makeExercise({ id: "b", name: "Front Raise" }));
  await upsertExercise(db, makeExercise({ id: "ru", name: "Russian Twist" }));
  const found = await searchExercisesByName(db, "rear delt fly");
  assert.deepEqual(found.map((f) => f.id), ["a"]);
  const none = await searchExercisesByName(db, "russian");
  assert.deepEqual(none, []);
});

test("searchExercisesByName: with lang, matches via the cached translation too", async () => {
  const db = newDb();
  await upsertExercise(db, makeExercise({ id: "a", name: "Front Raise" }));
  // SQLite LIKE case-folding only covers ASCII, so keep translation + query the same case here
  // (a real caller's query text is whatever the user typed, matched as-is via LIKE) — this test
  // is about the OR-with-translation branch, not Cyrillic case-folding.
  await upsertExerciseTranslation(db, "a", "uk", { name: "підйом гантелей", instructions: "i", safetyInfo: "s" });
  const found = await searchExercisesByName(db, "підйом гантелей", 5, "uk");
  assert.deepEqual(found.map((f) => f.id), ["a"]);
});

// ---------- translations ----------

test("getExerciseTranslation / upsertExerciseTranslation: round-trip and ON CONFLICT update", async () => {
  const db = newDb();
  await upsertExercise(db, makeExercise({ id: "a" }));
  assert.equal(await getExerciseTranslation(db, "a", "uk"), null);
  await upsertExerciseTranslation(db, "a", "uk", { name: "Жим лежачи", instructions: "i1", safetyInfo: "s1" });
  assert.deepEqual(await getExerciseTranslation(db, "a", "uk"), { name: "Жим лежачи", instructions: "i1", safetyInfo: "s1" });
  await upsertExerciseTranslation(db, "a", "uk", { name: "Жим штанги лежачи", instructions: "i2", safetyInfo: "s2" });
  assert.equal((await getExerciseTranslation(db, "a", "uk"))!.name, "Жим штанги лежачи");
});

test("getExerciseTranslations / getExerciseTranslationNames: batched lookups", async () => {
  const db = newDb();
  await upsertExercise(db, makeExercise({ id: "a" }));
  await upsertExercise(db, makeExercise({ id: "b" }));
  await upsertExerciseTranslation(db, "a", "uk", { name: "А", instructions: "i", safetyInfo: "s" });
  await upsertExerciseTranslation(db, "b", "uk", { name: "Б", instructions: "i", safetyInfo: "s" });

  const map = await getExerciseTranslations(db, ["a", "b", "missing"], "uk");
  assert.equal(map.size, 2);
  assert.equal(map.get("a")!.name, "А");

  const names = await getExerciseTranslationNames(db, ["a", "b"], "uk");
  assert.deepEqual(Object.fromEntries(names), { a: "А", b: "Б" });
  assert.deepEqual(await getExerciseTranslations(db, [], "uk"), new Map());
});

// ---------- exercise videos (shared cache) ----------

test("getExerciseVideo: never-searched key returns undefined, not null", async () => {
  const db = newDb();
  assert.equal(await getExerciseVideo(db, "bench press"), undefined);
});

test("upsertExerciseVideo + getExerciseVideo: round-trip, key normalized (trim/lowercase)", async () => {
  const db = newDb();
  await upsertExerciseVideo(db, {
    normalizedName: "Bench Press",
    exerciseName: "Bench Press",
    videoId: "abc123",
    url: "https://www.youtube.com/shorts/abc123",
    title: "How to bench",
    channelName: "Fit Channel",
    thumbnailUrl: "https://img/thumb.jpg",
    locked: false,
  });
  const v = await getExerciseVideo(db, "  BENCH PRESS  ");
  assert.equal(v!.videoId, "abc123");
  assert.equal(v!.locked, false);
});

test("upsertExerciseVideo: negative cache (null url) is stored and distinguishable from unsearched", async () => {
  const db = newDb();
  await upsertExerciseVideo(db, {
    normalizedName: "obscure exercise",
    exerciseName: "Obscure Exercise",
    videoId: null,
    url: null,
    title: null,
    channelName: null,
    thumbnailUrl: null,
    locked: false,
  });
  const v = await getExerciseVideo(db, "obscure exercise");
  assert.notEqual(v, undefined);
  assert.equal(v!.url, null);
});

test("setManualVideo locks the row; a later upsertExerciseVideo (auto refresh) does not overwrite it", async () => {
  const db = newDb();
  await setManualVideo(db, "squat", "Squat", { videoId: "manual1", url: "https://youtu.be/manual1" }, 999);
  let v = await getExerciseVideo(db, "squat");
  assert.equal(v!.locked, true);
  assert.equal(v!.videoId, "manual1");

  await upsertExerciseVideo(db, {
    normalizedName: "squat",
    exerciseName: "Squat",
    videoId: "auto1",
    url: "https://youtu.be/auto1",
    title: "Auto found",
    channelName: "Auto",
    thumbnailUrl: null,
    locked: false,
  });
  v = await getExerciseVideo(db, "squat");
  assert.equal(v!.videoId, "manual1"); // unchanged — locked row wins
});

test("getExerciseVideos: batched lookup, absent keys simply missing from the Map", async () => {
  const db = newDb();
  await upsertExerciseVideo(db, {
    normalizedName: "a", exerciseName: "A", videoId: "1", url: "u1", title: null, channelName: null, thumbnailUrl: null, locked: false,
  });
  const map = await getExerciseVideos(db, ["a", "missing"]);
  assert.equal(map.size, 1);
  assert.ok(map.has("a"));
  assert.deepEqual(await getExerciseVideos(db, []), new Map());
});

// ---------- per-user video overrides ----------

// v2_user_exercise_videos.accountId FKs to v2_accounts(id) — seed minimal account rows directly
// (this domain doesn't own v2_accounts; test/v2-users.test.ts exercises getOrCreateUser itself).
function seedAccount(db: ReturnType<typeof newDb>, id: number): void {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO v2_accounts (id, legacyUserId, chatId, role, status, createdAt, updatedAt) VALUES (?, ?, ?, 'solo', 'active', ?, ?)",
  ).bind(id, id, id, now, now).run();
}

test("setUserVideo / getUserVideos / deleteUserVideo: per-user override lifecycle", async () => {
  const db = newDb();
  seedAccount(db, 1);
  seedAccount(db, 2);
  await setUserVideo(db, 1, "deadlift", "Deadlift", { videoId: "u1", url: "https://youtu.be/u1" });
  let map = await getUserVideos(db, 1, ["deadlift"]);
  assert.equal(map.get("deadlift")!.videoId, "u1");
  assert.equal(map.get("deadlift")!.locked, true);

  // A different user has no override.
  assert.deepEqual(await getUserVideos(db, 2, ["deadlift"]), new Map());

  // ON CONFLICT update.
  await setUserVideo(db, 1, "deadlift", "Deadlift", { videoId: "u2", url: "https://youtu.be/u2" });
  map = await getUserVideos(db, 1, ["deadlift"]);
  assert.equal(map.get("deadlift")!.videoId, "u2");

  const deleted = await deleteUserVideo(db, 1, "deadlift");
  assert.equal(deleted, true);
  assert.deepEqual(await getUserVideos(db, 1, ["deadlift"]), new Map());
  assert.equal(await deleteUserVideo(db, 1, "deadlift"), false);
});

// ---------- misc ----------

test("listAllCatalogNames: alphabetical, Russian-named rows excluded", async () => {
  const db = newDb();
  await upsertExercise(db, makeExercise({ id: "a", name: "Zebra Curl" }));
  await upsertExercise(db, makeExercise({ id: "b", name: "Ab Wheel Rollout" }));
  await upsertExercise(db, makeExercise({ id: "ru", name: "Russian Twist" }));
  assert.deepEqual(await listAllCatalogNames(db), ["Ab Wheel Rollout", "Zebra Curl"]);
});
