// "A month ago vs now" on the Progress screen: the newest progress photo next to the one closest
// to 30 days before it (logic/photoPair), each with its date and the weight logged nearest to it.
// Photos stream through /api/v2/photo (the same route the More screen's compare uses).
import { useEffect, useState } from "react";
import { api } from "./api";
import { photoUrl } from "./App";
import { t, type Lang } from "./i18n";
import { pickPhotoPair, weightNear, type WeightPoint } from "./logic/photoPair";
import type { ProfilePhoto } from "./types";

const fmtDay = (lang: Lang, iso: string) => new Intl.DateTimeFormat(lang === "uk" ? "uk-UA" : "en-GB", { day: "numeric", month: "short" }).format(new Date(`${iso.slice(0, 10)}T12:00:00`));
const kg = (n: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(n);

export function PhotoPair({ lang, weights, reloadKey }: { lang: Lang; weights: WeightPoint[]; reloadKey: number }) {
  const [photos, setPhotos] = useState<ProfilePhoto[] | null>(null);
  useEffect(() => { api<{ photos: ProfilePhoto[] }>("/api/v2/profile").then((d) => setPhotos(d.photos ?? [])).catch(() => setPhotos([])); }, [reloadKey]);
  if (!photos) return null;
  const pair = pickPhotoPair(photos);
  if (!pair) return <p className="muted">{t(lang, photos.length ? "photo_pair_need_second" : "photo_pair_need_first")}</p>;
  const side = (p: ProfilePhoto, label: string) => {
    const w = weightNear(weights, p.takenAt);
    return <figure className="photo-side">
      <img src={photoUrl(p.id)} alt={`${label} · ${fmtDay(lang, p.takenAt)}`} loading="lazy" />
      <figcaption><strong>{label}</strong><span>{fmtDay(lang, p.takenAt)}{w !== undefined ? ` · ${kg(w)} kg` : ""}</span></figcaption>
    </figure>;
  };
  const wb = weightNear(weights, pair.before.takenAt), wa = weightNear(weights, pair.after.takenAt);
  const delta = wb !== undefined && wa !== undefined ? Math.round((wa - wb) * 10) / 10 : undefined;
  return <div className="photo-pair">
    <div className="photo-pair-grid">{side(pair.before, t(lang, "photo_pair_before"))}{side(pair.after, t(lang, "photo_pair_now"))}</div>
    <small className="muted">{t(lang, "photo_pair_span", { days: pair.days })}{delta !== undefined ? ` · ${delta > 0 ? "+" : delta < 0 ? "−" : ""}${kg(Math.abs(delta))} kg` : ""}</small>
  </div>;
}
