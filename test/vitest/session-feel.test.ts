// setSessionFeelRpe against real D1: only that day's exercises without their own RPE take it.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { setSessionFeelRpe } from "../../src/adapters/d1/v2Workouts";

describe("setSessionFeelRpe", () => {
  it("fills missing RPE for the session's exercises and leaves explicit ones", async () => {
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO v2_accounts (id, legacyUserId, chatId, role, status, createdAt, updatedAt) VALUES (9401, 9401, 9401, 'solo', 'active', ?, ?)").bind(now, now),
      env.DB.prepare("INSERT INTO v2_workout_sessions (id, accountId, date, weekday, completed, createdAt, updatedAt) VALUES (9401, 9401, '2026-10-05', 1, 1, ?, ?)").bind(now, now),
      env.DB.prepare("INSERT INTO v2_workout_exercises (sessionId, position, name) VALUES (9401, 0, 'Bench Press')"),
      env.DB.prepare("INSERT INTO v2_workout_exercises (sessionId, position, name, rpe) VALUES (9401, 1, 'Squat', 7)"),
      env.DB.prepare("INSERT INTO v2_workout_exercises (sessionId, position, name, skipped) VALUES (9401, 2, 'Dips', 1)"),
    ]);
    expect(await setSessionFeelRpe(env.DB, 9401, "2026-10-05", 9.5)).toBe(1);
    const rows = await env.DB.prepare("SELECT name, rpe FROM v2_workout_exercises WHERE sessionId = 9401 ORDER BY position").all<{ name: string; rpe: number | null }>();
    expect(rows.results).toEqual([{ name: "Bench Press", rpe: 9.5 }, { name: "Squat", rpe: 7 }, { name: "Dips", rpe: null }]);
    expect(await setSessionFeelRpe(env.DB, 9401, "2026-10-04", 8)).toBe(0); // no session that day
  });
});
