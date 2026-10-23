// The latest release note as cards: on Today once per release (dismissed server-side, so it
// doesn't come back on another phone) and permanently under More → What's new.
import { useState } from "react";
import { api, jsonBody } from "./api";
import { t, type Lang } from "./i18n";
import { parseReleaseNote, type ReleaseItem } from "./logic/releaseDelivery";

// Cards come parsed from the server (/api/v2/whatsnew items). The plain text is parsed here only
// when no items were sent (the dashboard's whatsnew carries text only).
export function ReleaseItems({ items, text, compact = false }: { items?: ReleaseItem[]; text?: string; compact?: boolean }) {
  const cards = items ?? parseReleaseNote(text ?? "");
  return (
    <ul className={compact ? "release-items compact" : "release-items"}>
      {cards.map((item, i) => (
        <li key={i}>
          {item.icon && <span className="release-icon" aria-hidden="true">{item.icon}</span>}
          <div>{item.title && <strong>{item.title}</strong>}{(!compact || !item.title) && <p>{item.body}</p>}</div>
        </li>
      ))}
    </ul>
  );
}

export function WhatsNewCard({ lang, version, text, items }: { lang: Lang; version: string; text: string; items?: ReleaseItem[] }) {
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
      <ReleaseItems items={items} text={text} compact={!open} />
      <div className="button-row">
        <button className="button button-primary" onClick={dismiss}>{t(lang, "whatsnew_got_it")}</button>
        {!open && <button className="button button-ghost" onClick={() => setOpen(true)}>{t(lang, "whatsnew_more")}</button>}
      </div>
    </section>
  );
}
