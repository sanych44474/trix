import { test } from "node:test";
import assert from "node:assert/strict";
import { challengeByCode, challengeWindow, isSeasonCode, seasonalChallenge, seasonMilestones, CHALLENGES } from "../src/domain/challenges";
import { challengeTitleText } from "../src/render";

test("seasonal challenge: one per calendar month, rotating, resolvable from its code", () => {
  const oct = seasonalChallenge("2026-10-02");
  assert.equal(oct.code, "season_2026_10");
  assert.deepEqual(oct.season, { month: "2026-10", start: "2026-10-01", end: "2026-10-31" });
  assert.equal(oct.windowDays, 31);
  assert.equal(seasonalChallenge("2027-02-10").season!.end, "2027-02-28");
  assert.equal(seasonalChallenge("2028-02-10").season!.end, "2028-02-29");
  const metrics = new Set(["2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01"].map((d) => seasonalChallenge(d).metric));
  assert.equal(metrics.size, 4, "four consecutive months, four different goals");
  assert.deepEqual(challengeByCode("season_2026_10"), oct);
  assert.equal(challengeByCode("season_2026_13"), undefined);
  assert.ok(isSeasonCode(oct.code) && !isSeasonCode("w4"));
  assert.ok(CHALLENGES.every((c) => challengeByCode(c.code) === c), "fixed templates unchanged");
});

test("challenge window: seasons span their month whenever joined; others start today", () => {
  assert.deepEqual(challengeWindow(seasonalChallenge("2026-10-15"), "2026-10-15"), { start: "2026-10-01", end: "2026-10-31" });
  assert.deepEqual(challengeWindow(challengeByCode("w4")!, "2026-10-15"), { start: "2026-10-15", end: "2026-10-21" });
});

test("seasonal titles name the month, badges at 1 and 3 wins", () => {
  const steps = ["2026-10-01", "2026-11-01", "2026-12-01", "2027-01-01"].map((d) => seasonalChallenge(d)).find((c) => c.metric === "steps_sum")!;
  const month = Number(steps.season!.month.slice(5));
  const uk = challengeTitleText("uk", steps);
  assert.ok(uk.includes("200 000") && uk.includes("Сезон"), uk);
  assert.ok(uk.includes("Січень,Лютий,Березень,Квітень,Травень,Червень,Липень,Серпень,Вересень,Жовтень,Листопад,Грудень".split(",")[month - 1]!), uk);
  assert.ok(challengeTitleText("en", steps).startsWith("Season · "));
  assert.equal(challengeTitleText("uk", challengeByCode("w2")!), "2 тренування за тиждень");
  assert.deepEqual(seasonMilestones(0), []);
  assert.deepEqual(seasonMilestones(1), ["season_win"]);
  assert.deepEqual(seasonMilestones(3), ["season_win", "season_3"]);
});
