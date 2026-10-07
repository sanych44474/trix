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
  ];
  for (const [input, expected] of cases) assert.equal(parseRestSec(input), expected, String(input));
});
