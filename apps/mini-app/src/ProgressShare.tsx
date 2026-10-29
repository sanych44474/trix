// Progress tools that used to sit on More: the week card (draw it, send it to the chat or a story)
// and a before/after of two progress photos. Each mounts only when its Fold is open.
import { useEffect, useState } from "react";
import { api } from "./api";
import type { ProfilePhoto, WeekCardResponse } from "./types";
import { t, type Lang } from "./i18n";
import { WeekStoryButton } from "./TelegramExtras";
import { formatNumber, Metric, Empty, ErrorState, photoUrl, apiUpload, composeCompare, drawWeekCard } from "./App";

export function WeekCardTool({ lang }: { lang: Lang }) {
  const [week, setWeek] = useState<WeekCardResponse | null>(null);
  const [weekError, setWeekError] = useState<unknown>(null);
  const [weekBusy, setWeekBusy] = useState(false);
  const [weekSent, setWeekSent] = useState(false);
  const [weekCanvasUrl, setWeekCanvasUrl] = useState<string | null>(null);
  const [weekBlob, setWeekBlob] = useState<Blob | null>(null);
  const loadWeek = () => { setWeekError(null); api<WeekCardResponse>("/api/v2/weekcard").then(setWeek).catch(setWeekError); };
  useEffect(loadWeek, []);
  const generateWeekCard = () => {
    if (!week?.stats) return;
    const canvas = drawWeekCard(lang, week.stats, week.name);
    canvas.toBlob((blob) => { if (!blob) return; setWeekBlob(blob); setWeekCanvasUrl(URL.createObjectURL(blob)); });
  };
  const sendWeekCard = async () => {
    if (!weekBlob) return;
    setWeekBusy(true); setWeekSent(false);
    try {
      const form = new FormData();
      form.append("photo", weekBlob, "weekcard.png");
      await apiUpload("/api/v2/weekcard", form);
      setWeekSent(true);
    } catch (err) { setWeekError(err); } finally { setWeekBusy(false); }
  };

  return <>
    {weekError !== null ? <ErrorState lang={lang} error={weekError} retry={loadWeek} /> : !week ? <div className="skeleton" /> : !week.stats ? <Empty title={t(lang, "weekcard_empty_title")} detail={t(lang, "weekcard_empty_detail")} /> : <>
      <p className="muted">{week.stats.since.slice(5)} → {week.stats.until.slice(5)}</p>
      <div className="metric-grid compact">
        <Metric label={t(lang, "weekcard_workouts")} value={week.stats.planned ? `${week.stats.done}/${week.stats.planned}` : `${week.stats.done}`} />
        <Metric label={t(lang, "weekcard_sets")} value={`${week.stats.totalSets}`} />
        <Metric label={t(lang, "weekcard_volume")} value={`${formatNumber(week.stats.volumeKg)} kg`} />
      </div>
      <div className="metric-grid compact">
        <Metric label={t(lang, "metric_streak")} value={`${week.stats.streak}`} />
        <Metric label={t(lang, "weekcard_level")} value={`${week.stats.level}`} detail={`${week.stats.xp} XP`} />
        {week.stats.prs > 0 && <Metric label={t(lang, "weekcard_prs")} value={`${week.stats.prs}`} />}
      </div>
      <div className="button-row" style={{ marginTop: 12 }}>
        <button className="button button-ghost" onClick={generateWeekCard}>{t(lang, "weekcard_generate_btn")}</button>
        {weekCanvasUrl && <button className="button button-primary" disabled={weekBusy} onClick={() => void sendWeekCard()}>{weekBusy ? t(lang, "saving_ellipsis") : t(lang, "weekcard_send_btn")}</button>}
        <WeekStoryButton lang={lang} stats={week.stats} />
      </div>
      {weekCanvasUrl && <img src={weekCanvasUrl} alt="" style={{ marginTop: 10, width: "100%", borderRadius: 12 }} />}
      {weekSent && <div className="save-note">{t(lang, "weekcard_sent_note")}</div>}
    </>}
  </>;
}

export function PhotoCompareTool({ lang }: { lang: Lang }) {
  const [photos, setPhotos] = useState<ProfilePhoto[] | null>(null);
  const [photosError, setPhotosError] = useState<unknown>(null);
  const loadPhotos = () => { setPhotosError(null); api<{ photos: ProfilePhoto[] }>("/api/v2/profile").then((data) => setPhotos(data.photos)).catch(setPhotosError); };
  useEffect(loadPhotos, []);
  const [fromId, setFromId] = useState<number | null>(null);
  const [toId, setToId] = useState<number | null>(null);
  const [compareBusy, setCompareBusy] = useState(false);
  const [compareSent, setCompareSent] = useState(false);
  const [compareError, setCompareError] = useState<unknown>(null);
  const sendCompare = async () => {
    if (!photos || fromId == null || toId == null) return;
    const a = photos.find((p) => p.id === fromId);
    const b = photos.find((p) => p.id === toId);
    if (!a || !b) return;
    setCompareBusy(true); setCompareSent(false); setCompareError(null);
    try {
      const blob = await composeCompare(photoUrl(fromId), photoUrl(toId));
      if (!blob) throw new Error("compose failed");
      const form = new FormData();
      form.append("photo", blob, "progress.png");
      form.append("from", a.takenAt);
      form.append("to", b.takenAt);
      await apiUpload("/api/v2/photocompare", form);
      setCompareSent(true);
    } catch (err) { setCompareError(err); } finally { setCompareBusy(false); }
  };

  return <>
    {photosError !== null ? <ErrorState lang={lang} error={photosError} retry={loadPhotos} /> : !photos ? <div className="skeleton" /> : photos.length < 2 ? <Empty title={t(lang, "photocompare_empty_title")} detail={t(lang, "photocompare_need_two")} /> : <>
      <div className="input-row">
        <label className="form-field"><span>{t(lang, "photocompare_from_label")}</span><select value={fromId ?? ""} onChange={(event) => setFromId(Number(event.target.value) || null)}><option value="">—</option>{photos.map((p) => <option key={p.id} value={p.id}>{p.takenAt}</option>)}</select></label>
        <label className="form-field"><span>{t(lang, "photocompare_to_label")}</span><select value={toId ?? ""} onChange={(event) => setToId(Number(event.target.value) || null)}><option value="">—</option>{photos.map((p) => <option key={p.id} value={p.id}>{p.takenAt}</option>)}</select></label>
      </div>
      <div className="button-row" style={{ marginTop: 10 }}>
        <button className="button button-primary" disabled={compareBusy || fromId == null || toId == null || fromId === toId} onClick={() => void sendCompare()}>{compareBusy ? t(lang, "saving_ellipsis") : t(lang, "photocompare_send_btn")}</button>
      </div>
      {compareSent && <div className="save-note">{t(lang, "photocompare_sent_note")}</div>}
      {compareError !== null && <div className="save-note error-note">{t(lang, "generic_error")}</div>}
    </>}
  </>;
}
