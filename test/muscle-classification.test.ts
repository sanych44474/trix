// The TS classifier matches the golden fixtures shared with the native app, and the Kotlin files
// generated from the TS rules are current. Regenerate with: npm run gen:kotlin-muscles
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { musclesForExercise, registerLearnedMuscles } from "../src/domain/exerciseMuscles";
import { buildArtifacts, PATHS, sameText } from "../scripts/gen-kotlin-muscle-rules.mjs";

interface FixtureCase {
  name: string;
  learned?: { primary: string[]; secondary: string[] };
  expected: { primary: string[]; secondary: string[] } | null;
}

const fixture = JSON.parse(readFileSync(PATHS.jsonFixtures, "utf8")) as { cases: FixtureCase[] };

describe("muscle classification golden cases", () => {
  it("the TS classifier returns the recorded result for every case", () => {
    for (const c of fixture.cases) {
      if (c.learned) registerLearnedMuscles([{ name: c.name, ...c.learned }]);
    }
    for (const c of fixture.cases) {
      const hit = musclesForExercise(c.name);
      const got = hit ? { primary: hit.primary, secondary: hit.secondary } : null;
      assert.deepEqual(got, c.expected, c.name);
    }
  });

  it("keeps a broad set of cases", () => {
    assert.ok(fixture.cases.length >= 60, `only ${fixture.cases.length} cases`);
  });

  it("committed Kotlin rules, embedded fixtures and JSON match the generator output", async () => {
    const built = await buildArtifacts();
    const stale = "stale: run npm run gen:kotlin-muscles and commit the result";
    assert.ok(sameText(readFileSync(PATHS.kotlinRules, "utf8"), built.rulesKt), `MuscleRulesGenerated.kt ${stale}`);
    assert.ok(sameText(readFileSync(PATHS.kotlinFixtures, "utf8"), built.fixturesKt), `MuscleFixturesGenerated.kt ${stale}`);
    assert.ok(sameText(readFileSync(PATHS.jsonFixtures, "utf8"), built.fixturesJson), `muscle-classification.json ${stale}`);
  });
});
