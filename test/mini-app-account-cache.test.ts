import { test } from "node:test";
import assert from "node:assert/strict";
import { clearAccountCache } from "../apps/mini-app/src/logic/accountCache";
import { OFFLINE_SAVES_KEY } from "../apps/mini-app/src/logic/offlineSaves";

function fakeStorage(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    get length() { return map.size; },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  } as unknown as Storage & { map: Map<string, string> };
}

// mirrorToDevice reads the global localStorage and window, as in the app.
function useDevice(device: Map<string, string>) {
  (globalThis as Record<string, unknown>).window = { Telegram: { WebApp: {
    isVersionAtLeast: () => true,
    DeviceStorage: { setItem: () => {}, getItem: () => {}, removeItem: (k: string) => void device.delete(k) },
  } } };
}

test("clearAccountCache: account keys go, auth account and theme survive, foreign keys untouched", () => {
  useDevice(new Map());
  const local = fakeStorage({
    "trix:v2:auth-account": "42",
    "trix:v2:contrast": "high",
    "trix:v2:accent": "red",
    "trix:v2:dashboard": "{}",
    "trix:v2:workout-today": "{}",
    "other-app:key": "x",
  });
  const session = fakeStorage({ "trix:v2:draft": "1", "unrelated": "2" });
  (globalThis as Record<string, unknown>).localStorage = local;
  clearAccountCache(local, session);
  delete (globalThis as Record<string, unknown>).localStorage;
  assert.deepEqual([...local.map.keys()].sort(), ["other-app:key", "trix:v2:accent", "trix:v2:auth-account", "trix:v2:contrast"]);
  assert.deepEqual([...session.map.keys()], ["unrelated"]);
});

test("clearAccountCache: the DeviceStorage backup of the offline queue is removed too", () => {
  const device = new Map<string, string>([[OFFLINE_SAVES_KEY, "[1]"]]);
  useDevice(device);
  const local = fakeStorage({ [OFFLINE_SAVES_KEY]: "[1]" });
  (globalThis as Record<string, unknown>).localStorage = local;
  clearAccountCache(local, fakeStorage());
  assert.equal(local.getItem(OFFLINE_SAVES_KEY), null);
  assert.equal(device.has(OFFLINE_SAVES_KEY), false);
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).localStorage;
});
