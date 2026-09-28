import { test } from "node:test";
import assert from "node:assert/strict";
import { latestBodyFat, navyBodyFat } from "../src/domain/bodyFat";

test("navyBodyFat: textbook values", () => {
  // Metric equations; the imperial form agrees within ~0.2 pp (16.15 / 25.10).
  assert.equal(navyBodyFat({ sex: "male", heightCm: 180, waistCm: 85, neckCm: 38 }), 16.1);
  assert.equal(navyBodyFat({ sex: "female", heightCm: 165, waistCm: 70, neckCm: 32, hipsCm: 95 }), 24.9);
});

test("navyBodyFat: rejects what it can't answer", () => {
  assert.equal(navyBodyFat({ sex: "female", heightCm: 165, waistCm: 70, neckCm: 32 }), null, "women need hips");
  assert.equal(navyBodyFat({ sex: "male", heightCm: 180, waistCm: 38, neckCm: 40 }), null, "waist below neck");
  assert.equal(navyBodyFat({ sex: "male", heightCm: 18, waistCm: 85, neckCm: 38 }), null, "height typed in metres");
  assert.equal(navyBodyFat({ sex: "male", heightCm: 180, waistCm: 85, neckCm: 3.8 }), null, "neck typed in dm");
});

test("latestBodyFat: combines each measurement's newest value", () => {
  const logs = [
    { date: "2026-09-01", measurements: { waist: 90, neck: 38 } },
    { date: "2026-09-20", measurements: { waist: 85 } }, // neck carried over from 09-01
  ];
  assert.deepEqual(latestBodyFat(logs, { sex: "male", heightCm: 180 }), { date: "2026-09-20", pct: 16.1 });
  assert.equal(latestBodyFat(logs, { heightCm: 180 }), null, "needs sex");
  assert.equal(latestBodyFat([{ date: "2026-09-20", measurements: { waist: 85 } }], { sex: "male", heightCm: 180 }), null, "needs a neck");
});

test("parseMeasurements reads the neck in both languages", async () => {
  const { parseMeasurements } = await import("../src/domain/progression");
  assert.deepEqual(parseMeasurements("талія 82, шия 38").measurements, { waist: 82, neck: 38 });
  assert.deepEqual(parseMeasurements("waist 85 neck 39.5").measurements, { waist: 85, neck: 39.5 });
});
