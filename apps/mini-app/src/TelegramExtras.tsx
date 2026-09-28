// Mini App pieces that exist because the app runs inside Telegram: share to a story, pin the app
// to the home screen / go full screen, and a voluntary Telegram Stars tip jar. Each one renders
// only when the running Telegram client supports it (see ./telegram.ts).
import { useEffect, useState } from "react";
import { api, typedBody } from "./api";
import { t, type Lang } from "./i18n";
import type { WeekCardResponse } from "./types";
import { shareStoryCard } from "./storyCard";
import {
  addToHomeScreen, canAddToHomeScreen, canFullscreen, canOpenInvoice, canShareStory, homeScreenStatus,
  isFullscreen, onTelegramEvent, openInvoice, setFullscreen,
} from "./telegram";

const SUPPORT_AMOUNTS = [50, 100, 250] as const;

export function WeekStoryButton({ lang, stats }: { lang: Lang; stats: NonNullable<WeekCardResponse["stats"]> }) {
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  if (!canShareStory()) return null;
  const share = async () => {
    setState("busy");
    try {
      await shareStoryCard({
        eyebrow: `${stats.since.slice(5)} → ${stats.until.slice(5)}`,
        title: t(lang, "story_week_title"),
        rows: [
          [t(lang, "weekcard_workouts"), stats.planned ? `${stats.done}/${stats.planned}` : `${stats.done}`],
          [t(lang, "weekcard_sets"), `${stats.totalSets}`],
          [t(lang, "weekcard_volume"), `${stats.volumeKg} kg`],
          ...(stats.prs > 0 ? [[t(lang, "weekcard_prs"), `${stats.prs} 🏆`] as [string, string]] : []),
          [t(lang, "metric_streak"), `${stats.streak} 🔥`],
        ],
        footer: t(lang, "story_footer"),
      });
      setState("idle");
    } catch { setState("failed"); }
  };
  return (
    <>
      <button type="button" className="button button-ghost" disabled={state === "busy"} onClick={() => void share()}>{state === "busy" ? "…" : t(lang, "share_story_btn")}</button>
      {state === "failed" && <small className="muted">{t(lang, "share_story_failed")}</small>}
    </>
  );
}

/** "Add to home screen" and full-screen mode -- the two things that make a Mini App feel installed. */
export function AppShortcutsCard({ lang }: { lang: Lang }) {
  const [home, setHome] = useState<"unsupported" | "unknown" | "added" | "missed">("unsupported");
  const [full, setFull] = useState(isFullscreen);
  useEffect(() => { void homeScreenStatus().then(setHome); }, []);
  useEffect(() => onTelegramEvent("homeScreenAdded", () => setHome("added")), []);
  useEffect(() => onTelegramEvent("fullscreenChanged", () => setFull(isFullscreen())), []);
  const showHome = canAddToHomeScreen() && home !== "unsupported";
  if (!showHome && !canFullscreen()) return null;
  return (
    <section className="card card-default stack-card">
      <div className="section-head"><div><span className="eyebrow">Telegram</span><h2>{t(lang, "app_shortcuts_title")}</h2></div></div>
      <p className="muted">{t(lang, "app_shortcuts_detail")}</p>
      <div className="button-row">
        {showHome && (home === "added"
          ? <span className="tag">{t(lang, "home_screen_added")}</span>
          : <button type="button" className="button button-primary" onClick={addToHomeScreen}>{t(lang, "home_screen_btn")}</button>)}
        {canFullscreen() && <button type="button" className="button button-ghost" onClick={() => setFullscreen(!full)}>{full ? t(lang, "fullscreen_off_btn") : t(lang, "fullscreen_on_btn")}</button>}
      </div>
    </section>
  );
}

/** Voluntary Telegram Stars support. Nothing is unlocked by it -- the copy says so. */
export function SupportCard({ lang }: { lang: Lang }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [result, setResult] = useState<"paid" | "failed" | null>(null);
  if (!canOpenInvoice()) return null;
  const tip = async (stars: number) => {
    setBusy(stars); setResult(null);
    try {
      const { link } = await api<{ link: string }>("/api/v2/support/invoice", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"createSupportInvoice">({ stars: stars as 50 | 100 | 250 }) });
      const status = await openInvoice(link);
      if (status === "paid") { setResult("paid"); window.Telegram?.WebApp.HapticFeedback?.notificationOccurred("success"); }
      else if (status === "failed") setResult("failed");
    } catch { setResult("failed"); } finally { setBusy(null); }
  };
  return (
    <section className="card card-muted stack-card">
      <div className="section-head"><div><span className="eyebrow">⭐ Telegram Stars</span><h2>{t(lang, "support_title")}</h2></div></div>
      <p className="muted">{t(lang, "support_detail")}</p>
      <div className="button-row">
        {SUPPORT_AMOUNTS.map((stars) => (
          <button type="button" key={stars} className="button button-ghost" disabled={busy !== null} onClick={() => void tip(stars)}>{busy === stars ? "…" : `${stars} ⭐`}</button>
        ))}
      </div>
      {result === "paid" && <div className="save-note">{t(lang, "support_paid_note")}</div>}
      {result === "failed" && <div className="save-note error-note">{t(lang, "generic_error")}</div>}
    </section>
  );
}
