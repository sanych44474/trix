// Telegram DeviceStorage (Mini Apps 9.0): key-value storage kept by the Telegram app itself, so it
// survives the WebView's own storage being cleared — which mobile Telegram does more often than
// people expect. The offline workout queue is mirrored there: a save made in a gym basement is
// not lost if the WebView forgets localStorage before the network comes back. localStorage stays
// the working copy; DeviceStorage is the backup restored on the next open.

type CB<T> = (error: string | null, value?: T) => void;
interface DeviceStorageApi {
  setItem(key: string, value: string, cb?: CB<boolean>): void;
  getItem(key: string, cb: CB<string | null>): void;
  removeItem(key: string, cb?: CB<boolean>): void;
}

function store(): DeviceStorageApi | null {
  const wa = window.Telegram?.WebApp as unknown as { DeviceStorage?: DeviceStorageApi; isVersionAtLeast?: (v: string) => boolean } | undefined;
  if (!wa?.DeviceStorage || !wa.isVersionAtLeast?.("9.0")) return null;
  return wa.DeviceStorage;
}

/** Copy one localStorage key to DeviceStorage (or remove it there when it's gone locally). */
export function mirrorToDevice(key: string): void {
  const ds = store();
  if (!ds) return;
  let value: string | null = null;
  try { value = localStorage.getItem(key); } catch { return; }
  try {
    if (value) ds.setItem(key, value);
    else ds.removeItem(key);
  } catch { /* backup only */ }
}

/** If localStorage lost the key but DeviceStorage still has it, put it back. Resolves true when
 *  something was restored. Never rejects. */
export function restoreFromDevice(key: string): Promise<boolean> {
  const ds = store();
  if (!ds) return Promise.resolve(false);
  try { if (localStorage.getItem(key)) return Promise.resolve(false); } catch { return Promise.resolve(false); }
  return new Promise((resolve) => {
    const done = setTimeout(() => resolve(false), 1500); // never hold the app on a slow bridge
    try {
      ds.getItem(key, (err, value) => {
        clearTimeout(done);
        if (err || !value) return resolve(false);
        try { localStorage.setItem(key, value); resolve(true); } catch { resolve(false); }
      });
    } catch { clearTimeout(done); resolve(false); }
  });
}
