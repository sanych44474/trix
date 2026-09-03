import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSetLine, parseSetEdit } from "../src/domain/setLine";

const opts = { defaultSets: 4 };

test("W R → uniform defaultSets sets", () => {
  assert.deepEqual(parseSetLine("80 8", opts), {
    kind: "sets",
    sets: [{ weight: 80, reps: 8 }, { weight: 80, reps: 8 }, { weight: 80, reps: 8 }, { weight: 80, reps: 8 }],
  });
  assert.deepEqual(parseSetLine("80x8", opts), parseSetLine("80 8", opts));
});

test("NxWxR → explicit uniform count (Cyrillic х and units tolerated)", () => {
  const r = parseSetLine("3х80кг х8", opts);
  assert.equal(r?.kind, "sets");
  assert.equal(r?.kind === "sets" ? r.sets.length : 0, 3);
  assert.deepEqual(r?.kind === "sets" ? r.sets[0] : null, { weight: 80, reps: 8 });
});

test("W R1,R2,R3 → per-set reps at one weight", () => {
  const r = parseSetLine("80 8,7,6", opts);
  assert.deepEqual(r, { kind: "sets", sets: [{ weight: 80, reps: 8 }, { weight: 80, reps: 7 }, { weight: 80, reps: 6 }] });
});

test("spaces around commas in a reps list are tolerated", () => {
  const expected = {
    kind: "sets",
    sets: [{ weight: 0, reps: 25 }, { weight: 0, reps: 20 }, { weight: 0, reps: 12 }, { weight: 0, reps: 7 }],
  };
  // Bodyweight pull-ups logged as "0 <reps per set>" with the spacing phones insert after commas.
  assert.deepEqual(parseSetLine("0 25, 20, 12, 7", opts), expected);
  assert.deepEqual(parseSetLine("0 25 , 20 , 12 , 7", opts), expected);
  // Same tolerance for a bodyweight-only reps list.
  assert.deepEqual(parseSetLine("25, 20, 12, 7", { defaultSets: 4, bodyweight: true }), expected);
});

test("explicit pair list → fully per-set", () => {
  const r = parseSetLine("80x8 80x7 75x10", opts);
  assert.deepEqual(r, { kind: "sets", sets: [{ weight: 80, reps: 8 }, { weight: 80, reps: 7 }, { weight: 75, reps: 10 }] });
  assert.deepEqual(parseSetLine("80x8, 75x10", opts), { kind: "sets", sets: [{ weight: 80, reps: 8 }, { weight: 75, reps: 10 }] });
});

test("bare number: weighted → weight-only fallback; bodyweight → reps", () => {
  assert.deepEqual(parseSetLine("80", opts), { kind: "weight", weight: 80 });
  const bw = parseSetLine("12", { defaultSets: 3, bodyweight: true });
  assert.deepEqual(bw, { kind: "sets", sets: [{ weight: 0, reps: 12 }, { weight: 0, reps: 12 }, { weight: 0, reps: 12 }] });
});

test("bodyweight reps list", () => {
  assert.deepEqual(parseSetLine("12,10,8", { defaultSets: 3, bodyweight: true }), {
    kind: "sets",
    sets: [{ weight: 0, reps: 12 }, { weight: 0, reps: 10 }, { weight: 0, reps: 8 }],
  });
  // weighted exercises don't guess a bare comma list
  assert.equal(parseSetLine("12,10,8", opts), null);
});

test("decimal weights and validation limits", () => {
  const r = parseSetLine("22.5 10", { defaultSets: 2 });
  assert.deepEqual(r, { kind: "sets", sets: [{ weight: 22.5, reps: 10 }, { weight: 22.5, reps: 10 }] });
  assert.equal(parseSetLine("5000 8", opts), null); // weight out of range
  assert.equal(parseSetLine("99x80x8", opts), null); // too many sets
  assert.equal(parseSetLine("junk", opts), null);
  assert.equal(parseSetLine("", opts), null);
});

test("parseSetEdit: reps-only and weight+reps", () => {
  assert.deepEqual(parseSetEdit("7"), { reps: 7 });
  assert.deepEqual(parseSetEdit("75x7"), { weight: 75, reps: 7 });
  assert.deepEqual(parseSetEdit("75 7"), { weight: 75, reps: 7 });
  assert.deepEqual(parseSetEdit("75х7"), { weight: 75, reps: 7 }); // Cyrillic х
  assert.equal(parseSetEdit("nope"), null);
  assert.equal(parseSetEdit("0"), null);
});
