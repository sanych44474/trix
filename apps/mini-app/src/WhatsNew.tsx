// The latest release note as cards: on Today once per release (dismissed server-side, so it
// doesn't come back on another phone) and permanently under More → What's new.
import { useState } from "react";
import { api, jsonBody } from "./api";
import { t, type Lang } from "./i18n";
import { parseReleaseNote } from "./logic/releaseDelivery";

export function ReleaseItems({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <ul className={compact ? "release-items compact" : "release-items"}>
      {parseReleaseNote(text).map((item, i) => (
        <li key={i}>
          {item.icon && <span className="release-icon" aria-hidden="true">{item.icon}</span>}
          <div>{item.title && <strong>{item.title}</strong>}{(!compact || !item.title) && <p>{item.body}</p>}</div>
        </li>
      ))}
    </ul>
  );
}

export function WhatsNewCard({ lang, version, text }: { lang: Lang; version: string; text: string }) {
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false); // on Today: the headlines first, details on request
  if (hidden) return null;
  const dismiss = () => {
    setHidden(true);
    api("/api/v2/whatsnew/seen", { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody({ version }) }).catch(() => {});
  };
  return (
    <section className="card whatsnew-card">
      <div className="section-head"><div><span className="eyebrow">{t(lang, "whatsnew_eyebrow")} · {version}</span><h2>{t(lang, "whatsnew_title")}</h2></div></div>
      <ReleaseItems text={text} compact={!open} />
      <div className="button-row">
        <button className="button button-primary" onClick={dismiss}>{t(lang, "whatsnew_got_it")}</button>
        {!open && <button className="button button-ghost" onClick={() => setOpen(true)}>{t(lang, "whatsnew_more")}</button>}
      </div>
    </section>
  );
}
