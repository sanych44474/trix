// mainMenu takes the Mini App URL as an argument (the adapters layer does not import notify/appLinks).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mainMenu } from "../src/adapters/telegram/keyboards";

test("the dashboard button is the first row only when a Mini App URL is given", () => {
  const withApp = mainMenu("en", "https://example.test/app?v=1").inline_keyboard;
  assert.equal(withApp[0].length, 1);
  assert.equal((withApp[0][0] as { web_app?: { url: string } }).web_app?.url, "https://example.test/app?v=1");
  const without = mainMenu("en").inline_keyboard;
  assert.equal(without.length, withApp.length - 1);
  assert.ok(!JSON.stringify(without).includes("web_app"));
});
