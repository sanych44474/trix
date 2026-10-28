// The signed-in account's local cache. Cleared when the account changes (AuthShell) and when the
// person signs out (AuthMethodsCard), so the next person on this phone never sees the previous
// account's dashboard, plans or queued saves. The Telegram DeviceStorage backup of the offline
// queue goes too, or OfflineSync would restore those saves on the next open.
import { mirrorToDevice } from "./deviceStorage";
import { OFFLINE_SAVES_KEY } from "./offlineSaves";

export const AUTH_ACCOUNT_KEY = "trix:v2:auth-account";
const PREFIX = "trix:v2:";
// Theme choices are a device preference, not account data: they survive the sweep.
const KEEP_LOCAL = new Set([AUTH_ACCOUNT_KEY, "trix:v2:contrast", "trix:v2:accent"]);

function prefixedKeys(store: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key?.startsWith(PREFIX)) keys.push(key);
  }
  return keys;
}

export function clearAccountCache(local: Storage, session: Storage): void {
  for (const key of prefixedKeys(local)) if (!KEEP_LOCAL.has(key)) local.removeItem(key);
  for (const key of prefixedKeys(session)) session.removeItem(key);
  mirrorToDevice(OFFLINE_SAVES_KEY);
}
