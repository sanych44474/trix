// exerciseMuscleLearning.ts against real D1: a catalog match is learned without AI, an
// unclassifiable name is stored as a negative cache, and the stored rows feed the lookup.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { learnExerciseMuscles, learnUnknownExercises, loadLearnedMuscles } from "../../src/exerciseMuscleLearning";
import { musclesForExercise } from "../../src/domain/exerciseMuscles";

describe("learnExerciseMuscles", () => {
  it("learns from the catalog by its Ukrainian name, caches failures, and feeds the lookup", async () => {
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO v2_exercises (id, name, muscle, fetchedAt) VALUES ('xq1', 'Qzx Machine Pullover Variant', 'lats', ?)").bind(now),
      env.DB.prepare("INSERT INTO v2_exercise_translations (exerciseId, lang, name, instructions, safetyInfo, createdAt) VALUES ('xq1', 'uk', 'Кзх вправа клубу Омега', '', '', ?)").bind(now),
    ]);
    const learned = await learnExerciseMuscles(env, "Кзх вправа клубу Омега");
    expect(learned?.primary).toContain("upper-back"); // via the rules for the catalog's English name
    const row = await env.DB.prepare("SELECT source FROM v2_exercise_muscles WHERE normalizedName = ?").bind("кзх вправа клубу омега").first<{ source: string }>();
    expect(row?.source).toBe("catalog");

    // No catalog match and no AI keys in tests -> stored as "couldn't classify", not retried.
    expect(await learnExerciseMuscles(env, "Qwrtz zzyx")).toBeNull();
    const neg = await env.DB.prepare("SELECT source, primaryMuscles FROM v2_exercise_muscles WHERE normalizedName = 'qwrtz zzyx'").first<{ source: string; primaryMuscles: string }>();
    expect(neg).toEqual({ source: "none", primaryMuscles: "[]" });

    await loadLearnedMuscles(env.DB, true);
    expect(musclesForExercise("Кзх вправа клубу Омега")?.primary).toContain("upper-back");
  });

  it("the hourly sweep learns unknown names from recent workouts, once", async () => {
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO v2_accounts (id, legacyUserId, chatId, role, status, createdAt, updatedAt) VALUES (9301, 9301, 9301, 'solo', 'active', ?, ?)").bind(now, now),
      env.DB.prepare("INSERT INTO v2_exercises (id, name, muscle, fetchedAt) VALUES ('xq2', 'Zork Station', 'glutes', ?)").bind(now),
      env.DB.prepare("INSERT INTO v2_exercise_translations (exerciseId, lang, name, instructions, safetyInfo, createdAt) VALUES ('xq2', 'uk', 'Зорк станція', '', '', ?)").bind(now),
      env.DB.prepare("INSERT INTO v2_workout_sessions (id, accountId, date, weekday, completed, createdAt, updatedAt) VALUES (9301, 9301, ?, 1, 1, ?, ?)").bind(today, now, now),
      env.DB.prepare("INSERT INTO v2_workout_exercises (sessionId, position, name) VALUES (9301, 0, 'Зорк станція')"),
    ]);
    expect(await learnUnknownExercises(env)).toBeGreaterThanOrEqual(1);
    expect(musclesForExercise("Зорк станція")?.primary).toEqual(["gluteal"]);
    expect(await learnUnknownExercises(env)).toBe(0); // already learned: not picked again
  });
});
