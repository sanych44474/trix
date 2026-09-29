import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { nextBalanceStreak, weeklyReport, zonesToColors } from "../src/domain/weeklyReport";
import { TRACKED_MUSCLES } from "../src/domain/muscleLoad";
import { renderWeeklyMuscleLines } from "../src/render";
import { renderBodyMapPng } from "../src/render/bodyMapPng";
import { MASKS } from "../src/render/bodyMapMasks";
import { serveWeekMap, weekMapUrl } from "../src/webapp/weekMap";
import { pathToPolygons } from "../src/render/rasterize";
import type { Env } from "../src/types";

const day = (date: string, ex: Array<[string, number]>) => ({ date, done: true, ex: ex.map(([n, s]) => ({ n, s })) });

test("weekly report: a push-only week scores low, lists what lagged and one exercise to add", () => {
  const r = weeklyReport([day("2026-09-27", [["Жим лежачи", 12], ["Жим гантелей сидячи", 8], ["Французький жим", 6]])], "2026-09-21");
  assert.ok(r.balance > 0 && r.balance < 50, `balance ${r.balance}`);
  assert.equal(r.fullBody, false);
  assert.equal(r.allInRange, false);
  assert.equal(r.lagging.length, 2);
  assert.ok(r.lagging.every((l) => l.sets < l.mev));
  assert.equal(r.focus?.slug, r.lagging[0]!.slug);
  assert.equal(r.zones.length, TRACKED_MUSCLES.length);
  assert.equal(r.zones[TRACKED_MUSCLES.indexOf("chest")], "o", "12 chest sets: optimal");
  assert.equal(r.zones[TRACKED_MUSCLES.indexOf("quadriceps")], "n", "legs untouched");
});

test("weekly report: a balanced full-body week earns both flags and no focus", () => {
  const r = weeklyReport([
    day("2026-09-22", [["Жим лежачи", 10], ["Тяга штанги в нахилі", 10], ["Жим гантелей сидячи", 8], ["Планка", 3]]),
    day("2026-09-24", [["Присідання", 8], ["Румунська тяга", 6], ["Ягідний місток", 4]]),
    day("2026-09-26", [["Згинання рук зі штангою", 6], ["Розгинання рук на блоці", 6]]),
  ], "2026-09-21");
  assert.equal(r.fullBody, true);
  assert.equal(r.allInRange, true, JSON.stringify(r.lagging));
  assert.equal(r.balance, 100);
  assert.equal(r.focus, undefined);
});

test("zones round-trip to colours; balance streak counts and resets", () => {
  const zones = TRACKED_MUSCLES.map((s) => (s === "chest" ? "o" : s === "biceps" ? "b" : s === "triceps" ? "a" : "n")).join("");
  assert.deepEqual(zonesToColors(zones), { chest: "#ff5f3d", biceps: "#7d879b", triceps: "#ffb020" });
  assert.equal(nextBalanceStreak(undefined, true), 1);
  assert.equal(nextBalanceStreak(3, true), 4);
  assert.equal(nextBalanceStreak(3, false), 0);
});

test("renderWeeklyMuscleLines: score, lagging, records, focus and new badges", () => {
  const r = weeklyReport([day("2026-09-27", [["Жим лежачи", 12]])], "2026-09-21");
  const uk = renderWeeklyMuscleLines("uk", r, 2, ["full_body_week"]).join("\n");
  assert.match(uk, /Баланс тижня/);
  assert.match(uk, /Відстають/);
  assert.match(uk, /Рекордів за тиждень: <b>2<\/b>/);
  assert.match(uk, /Фокус на наступний тиждень/);
  assert.match(uk, /Нові бейджі: 🫀/);
  assert.doesNotMatch(renderWeeklyMuscleLines("en", r, 0, []).join("\n"), /Records/);
});

function pngInfo(png: Uint8Array) {
  assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer, png.byteOffset);
  const w = view.getUint32(16), h = view.getUint32(20);
  // Concatenate IDAT chunks and inflate.
  const parts: Uint8Array[] = [];
  for (let o = 8; o < png.length;) {
    const len = view.getUint32(o);
    const type = String.fromCharCode(...png.slice(o + 4, o + 8));
    if (type === "IDAT") parts.push(png.slice(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(parts));
  return { w, h, raw };
}

test("body map PNG: valid, the masks' size, and a highlighted part really is drawn in its colour", async () => {
  const png = await renderBodyMapPng({ colors: { chest: "#ff5f3d" } });
  const { w, h, raw } = pngInfo(png);
  assert.equal(w, MASKS.male.w);
  assert.equal(h, MASKS.male.h);
  assert.equal(raw.length, (w * 3 + 1) * h);
  let chestPixels = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * (w * 3 + 1) + 1 + x * 3;
    if (raw[o] === 0xff && raw[o + 1] === 0x5f && raw[o + 2] === 0x3d) chestPixels++;
  }
  assert.ok(chestPixels > 500, `chest pixels ${chestPixels}`);
  const female = pngInfo(await renderBodyMapPng({ colors: {}, sex: "female" }));
  assert.equal(female.w, MASKS.female.w);
});

test("weekmap link: signed, drawable, and a tampered link is refused", async () => {
  const env = { TELEGRAM_BOT_TOKEN: "123:test" } as unknown as Env;
  const zones = "o".repeat(TRACKED_MUSCLES.length);
  const link = await weekMapUrl("https://w.example", "male", zones, env.TELEGRAM_BOT_TOKEN);
  assert.ok(link?.startsWith("https://w.example/weekmap.png?s=m&z="));
  const ok = await serveWeekMap(new URL(link!), env);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/png");
  const bad = new URL(link!);
  bad.searchParams.set("z", "b".repeat(TRACKED_MUSCLES.length));
  assert.equal((await serveWeekMap(bad, env)).status, 404);
  assert.equal(await weekMapUrl(undefined, "male", zones, env.TELEGRAM_BOT_TOKEN), null, "no worker URL: no picture");
});

test("rasterizer: packed arc flags parse without NaNs", () => {
  const polys = pathToPolygons("M10 10a5 5 0 01.5 10a5 5 0 1010 0z");
  const pts = polys.flat();
  assert.ok(pts.length > 4);
  assert.ok(pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
});
