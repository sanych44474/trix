// Sends workout saves that were made without a connection (logic/offlineSaves.ts) once the
// network is back, and says so: a quiet "waiting for network" line while any are queued, then
// a short confirmation when they're through.
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { t, type Lang } from "./i18n";
import { flushQueue, readQueue } from "./logic/offlineSaves";

export function OfflineSync({ lang }: { lang: Lang }) {
  const [pending, setPending] = useState(() => { try { return readQueue(localStorage).length; } catch { return 0; } });
  const [sent, setSent] = useState(0);
  const busy = useRef(false);

  useEffect(() => {
    const flush = async () => {
      if (busy.current || !navigator.onLine) { try { setPending(readQueue(localStorage).length); } catch { /* storage is optional */ } return; }
      busy.current = true;
      try {
        const r = await flushQueue(localStorage, (q) =>
          api("/api/v2/workout/save", { method: "POST", idempotencyKey: q.key, body: JSON.stringify(q.body) }).then(() => undefined));
        setPending(r.remaining);
        if (r.sent) setSent((n) => n + r.sent);
      } catch { /* storage unavailable: nothing to flush */ } finally { busy.current = false; }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void flush(); };
    void flush();
    window.addEventListener("online", flush);
    window.addEventListener("trix:offline-save", flush);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", flush);
      window.removeEventListener("trix:offline-save", flush);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (!sent) return;
    const id = setTimeout(() => setSent(0), 6000);
    return () => clearTimeout(id);
  }, [sent]);

  if (pending) return <div className="offline-banner" role="status">{t(lang, "offline_pending", { n: pending })}</div>;
  if (sent) return <div className="offline-banner done" role="status">{t(lang, "offline_synced", { n: sent })}</div>;
  return null;
}
