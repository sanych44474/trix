// Meal by photo: take or pick a photo, the AI recognises the foods and portions, the user fixes
// the weights (macros scale) or drops a wrong item, then logs the meal. Nothing is logged before
// the user confirms -- photos are guesses (which grain? what portion?).
import { useRef, useState } from "react";
import { api, apiForm, typedBody } from "../api";
import { t, type Lang } from "../i18n";
import { type MealItem, reweigh, sumMeal } from "../logic/media";
import { track } from "../logic/track";
import { shrinkImage } from "./files";

export function MealPhoto({ lang, onLogged }: { lang: Lang; onLogged: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [items, setItems] = useState<MealItem[] | null>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState<"estimate" | "log" | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const reset = () => { if (preview) URL.revokeObjectURL(preview); setPreview(null); setItems(null); setCaption(""); if (input.current) input.current.value = ""; };

  const estimate = async (file: File) => {
    reset();
    setNote(null);
    setPreview(URL.createObjectURL(file));
    setBusy("estimate");
    try {
      const form = new FormData();
      form.append("photo", await shrinkImage(file), "meal.jpg");
      if (caption.trim()) form.append("caption", caption.trim());
      const r = await apiForm<{ items: MealItem[] }>("/api/v2/media/meal-photo", form);
      setItems(r.items);
      if (!r.items.length) setNote(t(lang, "meal_photo_unreadable"));
      track("app_meal_photo");
    } catch (err) {
      setNote(t(lang, (err as { status?: number }).status === 429 ? "meal_photo_limit" : "generic_error"));
    } finally { setBusy(null); }
  };

  const log = async () => {
    if (!items?.length) return;
    setBusy("log");
    try {
      await api("/api/v2/nutrition", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"editNutrition">({ action: "add_items", items }) });
      reset();
      setNote(t(lang, "meal_photo_logged"));
      onLogged();
    } catch { setNote(t(lang, "generic_error")); } finally { setBusy(null); }
  };

  const total = items ? sumMeal(items) : null;
  return <div className="meal-photo">
    <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void estimate(f); }} />
    {!preview && <button type="button" className="button button-primary meal-photo-cta" onClick={() => input.current?.click()}>📷 {t(lang, "meal_photo_btn")}</button>}
    {preview && <div className="meal-photo-body">
      <img src={preview} alt="" className="meal-photo-preview" />
      {busy === "estimate" && <p className="muted">{t(lang, "meal_photo_reading")}</p>}
      {items && items.length > 0 && <>
        <div className="meal-list">{items.map((item, i) => <div className="meal-row meal-photo-row" key={i}>
          <div><strong>{item.desc}</strong><small>{t(lang, "macro_line", { p: item.protein, f: item.fats, c: item.carbs })}</small></div>
          <span>{item.kcal}</span>
          {item.grams ? <label className="meal-photo-grams"><input type="number" min="1" max="3000" defaultValue={item.grams} aria-label={t(lang, "grams_unit")}
            onBlur={(e) => { const g = Number(e.target.value); setItems((cur) => cur ? cur.map((x, j) => (j === i ? reweigh(x, g) : x)) : cur); }} /> {t(lang, "grams_unit")}</label> : <span />}
          <button type="button" className="text-button danger-button" aria-label={t(lang, "delete_btn")} onClick={() => setItems((cur) => cur ? cur.filter((_, j) => j !== i) : cur)}>✕</button>
        </div>)}</div>
        {total && <p className="meal-photo-total"><strong>{t(lang, "kcal_value", { n: total.kcal })}</strong> · {t(lang, "macro_line", { p: total.protein, f: total.fats, c: total.carbs })}</p>}
      </>}
      <div className="button-row">
        {items && items.length > 0 && <button type="button" className="button button-primary" disabled={busy !== null} onClick={() => void log()}>{busy === "log" ? "…" : t(lang, "meal_photo_log_btn")}</button>}
        <button type="button" className="button button-ghost" disabled={busy !== null} onClick={() => input.current?.click()}>{t(lang, "meal_photo_retake")}</button>
        <button type="button" className="text-button" disabled={busy !== null} onClick={reset}>{t(lang, "close")}</button>
      </div>
    </div>}
    {!preview && <input className="meal-photo-caption" value={caption} maxLength={200} placeholder={t(lang, "meal_photo_caption_ph")} onChange={(e) => setCaption(e.target.value)} />}
    {note && <div className="save-note">{note}</div>}
  </div>;
}
