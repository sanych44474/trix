import { test } from "node:test";
import assert from "node:assert/strict";
import { CONTRAST_KEY, applyTheme, readContrast, resolveTheme, restoreContrast, setContrast } from "../apps/mini-app/src/logic/theme";

function setup(scheme?: "light" | "dark") {
  const local = new Map<string, string>();
  const device = new Map<string, string>();
  const dataset: Record<string, string> = {};
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => void local.set(k, v), removeItem: (k: string) => void local.delete(k),
  };
  (globalThis as Record<string, unknown>).document = { documentElement: { dataset } };
  (globalThis as Record<string, unknown>).window = { Telegram: { WebApp: {
    colorScheme: scheme,
    isVersionAtLeast: () => true,
    DeviceStorage: {
      setItem: (k: string, v: string) => device.set(k, v),
      getItem: (k: string, cb: (e: string | null, v?: string | null) => void) => cb(null, device.get(k) ?? null),
      removeItem: (k: string) => device.delete(k),
    },
  } } };
  return { local, device, dataset };
}

test("high contrast wins over Telegram's scheme; without either the stylesheet default stays", () => {
  assert.equal(resolveTheme(true, "dark"), "contrast");
  assert.equal(resolveTheme(false, "dark"), "dark");
  assert.equal(resolveTheme(false, "light"), "light");
  assert.equal(resolveTheme(false, undefined), null);
});

test("turning high contrast on and off repaints and is mirrored to DeviceStorage", () => {
  const { local, device, dataset } = setup("dark");
  applyTheme();
  assert.equal(dataset.theme, "dark");
  setContrast(true);
  assert.equal(dataset.theme, "contrast");
  assert.equal(readContrast(), true);
  assert.equal(local.get(CONTRAST_KEY), "1");
  assert.equal(device.get(CONTRAST_KEY), "1");
  setContrast(false);
  assert.equal(dataset.theme, "dark");
  assert.equal(device.has(CONTRAST_KEY), false);
});

test("off with no Telegram scheme clears the attribute instead of leaving contrast behind", () => {
  const { dataset } = setup(undefined);
  setContrast(true);
  assert.equal(dataset.theme, "contrast");
  setContrast(false);
  assert.equal("theme" in dataset, false);
});

test("a preference the WebView forgot comes back from DeviceStorage and is applied", async () => {
  const { device, dataset } = setup("light");
  device.set(CONTRAST_KEY, "1");
  applyTheme();
  assert.equal(dataset.theme, "light");
  restoreContrast();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(dataset.theme, "contrast");
});
