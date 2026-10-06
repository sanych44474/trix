import { test } from "node:test";
import assert from "node:assert/strict";
import { mirrorToDevice, restoreFromDevice } from "../apps/mini-app/src/logic/deviceStorage";

function setup(version = "9.1") {
  const local = new Map<string, string>();
  const device = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => void local.set(k, v), removeItem: (k: string) => void local.delete(k),
  };
  (globalThis as Record<string, unknown>).window = { Telegram: { WebApp: {
    isVersionAtLeast: (v: string) => Number(version) >= Number(v),
    DeviceStorage: {
      setItem: (k: string, v: string) => device.set(k, v),
      getItem: (k: string, cb: (e: string | null, v?: string | null) => void) => cb(null, device.get(k) ?? null),
      removeItem: (k: string) => device.delete(k),
    },
  } } };
  return { local, device };
}

test("the offline queue is mirrored to DeviceStorage and restored when localStorage lost it", async () => {
  const { local, device } = setup();
  local.set("q", "[1]");
  mirrorToDevice("q");
  assert.equal(device.get("q"), "[1]");
  local.clear(); // the WebView forgot it
  assert.equal(await restoreFromDevice("q"), true);
  assert.equal(local.get("q"), "[1]");
  local.delete("q"); mirrorToDevice("q"); // flushed → removed from the backup too
  assert.equal(device.has("q"), false);
});

test("older Telegram clients: no DeviceStorage calls", async () => {
  const { local, device } = setup("8.0");
  local.set("q", "[1]");
  mirrorToDevice("q");
  assert.equal(device.size, 0);
  assert.equal(await restoreFromDevice("q"), false);
});
