import { test } from "node:test";
import assert from "node:assert/strict";
import { barList, monoTable, pctBar, share, sparkline } from "../src/bot/ownerReport";

test("monoTable: first column left-aligned, the rest right-aligned, HTML-escaped inside <pre>", () => {
  const out = monoTable(["name", "n"], [["a<b", 5], ["long", 120]]);
  assert.equal(out, "<pre>name    n\n----  ---\na&lt;b     5\nlong  120</pre>");
});

test("pctBar: proportional, clamped, empty when total is 0", () => {
  assert.equal(pctBar(5, 10), "▰▰▰▰▰▱▱▱▱▱");
  assert.equal(pctBar(20, 10), "▰▰▰▰▰▰▰▰▰▰");
  assert.equal(pctBar(-3, 10), "▱▱▱▱▱▱▱▱▱▱");
  assert.equal(pctBar(1, 0, 4), "▱▱▱▱");
});

test("sparkline: scales to the max, empty input gives empty string, all zero stays flat", () => {
  assert.equal(sparkline([]), "");
  assert.equal(sparkline([0, 0, 0]), "▁▁▁");
  assert.equal(sparkline([0, 7]), "▁█");
  assert.equal(sparkline([1, 2, 4, 8]).length, 4);
});

test("share: rounded percent, 0 when total is 0", () => {
  assert.equal(share(1, 3), 33);
  assert.equal(share(2, 3), 67);
  assert.equal(share(5, 0), 0);
});

test("barList: bars proportional to the top row, at least one block, counts padded", () => {
  const out = barList([{ label: "menu:today", n: 40 }, { label: "x", n: 1 }], 8);
  assert.equal(out, "<pre>40 ▇▇▇▇▇▇▇▇ menu:today\n 1 ▇        x</pre>");
});
