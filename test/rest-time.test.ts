import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRestSec } from "../src/domain/restTime";

test("parseRestSec: units, ranges and bare numbers", () => {
  const cases: Array<[string | undefined, number | undefined]> = [
    ["90s", 90], ["90 s", 90], ["60 sec", 60], ["45 сек", 45], ["120с", 120],
    ["2-3 min", 120], ["3 min", 180], ["1.5 min", 90], ["3 хв", 180], ["2–3 хв", 120], ["2 мин", 120],
    ["1:30", 90], ["2:00", 120],
    ["2", 120], ["3-5", 180], ["90", 90], ["120", 120],
    ["", undefined], [undefined, undefined], ["as needed", undefined],
    ["30 min", 900],
    // Cyrillic units at a word end, minutes plus seconds, and only the first unit counts.
    ["10 с", 10], ["30 с", 30], ["1 хв 30 с", 90], ["1 min 30 s", 90], ["90 s (1.5 min)", 90],
    ["60-90s", 60], ["1-2 хв", 60], ["90 сек", 90],
  ];
  for (const [input, expected] of cases) assert.equal(parseRestSec(input), expected, String(input));
});
