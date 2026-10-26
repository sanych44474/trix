// The logger rules both apps share (apps/mini-app/src/logic/loggerOrder.ts): what the fixes for
// "moving jumps to another exercise" and "the rest timer restarts / vanishes" rely on, and the
// golden cases the Kotlin port is tested against. Regenerate with: npm run gen:logger-fixtures
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { moveInList, removeFromList, resumableRest, startsRest } from "../apps/mini-app/src/logic/loggerOrder";
import { buildArtifacts, NOW, PATHS, sameText } from "../scripts/gen-logger-fixtures.mjs";

describe("logger order", () => {
  it("moving the focused exercise keeps it on screen", () => {
    assert.deepEqual(moveInList(3, 1, -1, 1), { order: [1, 0, 2], focus: 0 });
    assert.deepEqual(moveInList(3, 1, 1, 1), { order: [0, 2, 1], focus: 2 });
  });

  it("moving the neighbour of the focused exercise keeps focus on the same exercise", () => {
    assert.deepEqual(moveInList(3, 0, 1, 1), { order: [1, 0, 2], focus: 0 });
    assert.deepEqual(moveInList(3, 2, -1, 0), { order: [0, 2, 1], focus: 0 });
  });

  it("moving past either end changes nothing", () => {
    assert.equal(moveInList(3, 0, -1, 0), null);
    assert.equal(moveInList(3, 2, 1, null), null);
  });

  it("removing shifts focus with the list; removing the focused one shows its neighbour", () => {
    assert.deepEqual(removeFromList(3, 0, 2), { order: [1, 2], focus: 1 });
    assert.deepEqual(removeFromList(3, 1, 1), { order: [0, 2], focus: 1 });
    assert.deepEqual(removeFromList(3, 2, 2), { order: [0, 1], focus: 1 });
    assert.deepEqual(removeFromList(1, 0, 0), { order: [], focus: null });
  });

  it("only a set finished just now starts the rest", () => {
    assert.equal(startsRest(true, false), true);
    assert.equal(startsRest(true, true), false, "correcting a done set must not restart the running rest");
    assert.equal(startsRest(false, false), false);
  });

  it("a saved rest comes back until the overrun cap, and junk is ignored", () => {
    const running = { endAt: NOW + 60_000, startedAt: NOW - 30_000, target: 90, label: "Squat · set 1" };
    assert.deepEqual(resumableRest(running, NOW, 60), running);
    assert.equal(resumableRest({ ...running, endAt: NOW - 300_000 }, NOW, 60), null);
    assert.equal(resumableRest("x", NOW, 60), null);
    assert.equal(resumableRest({ endAt: NOW }, NOW, 60), null);
  });
});

describe("logger order golden cases", () => {
  it("the committed JSON and the embedded Kotlin fixtures match the generator output", async () => {
    const built = await buildArtifacts();
    const stale = "stale: run npm run gen:logger-fixtures and commit the result";
    assert.ok(sameText(readFileSync(PATHS.jsonFixtures, "utf8"), built.json), `logger-order.json ${stale}`);
    assert.ok(sameText(readFileSync(PATHS.kotlinFixtures, "utf8"), built.kotlin), `LoggerOrderFixturesGenerated.kt ${stale}`);
  });

  it("covers every short list shape", () => {
    const fixture = JSON.parse(readFileSync(PATHS.jsonFixtures, "utf8")) as { move: unknown[]; remove: unknown[]; resume: unknown[] };
    assert.ok(fixture.move.length >= 100 && fixture.remove.length >= 50 && fixture.resume.length >= 8);
  });
});
