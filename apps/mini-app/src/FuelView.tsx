import { useEffect, useState } from "react";
import { api, ApiError, typedBody } from "./api";
import type { FoodSearchItem, GroceryLine, Nutrition } from "./types";
import { t, type Lang } from "./i18n";
import type { RequestBody } from "./types";
import { MealPhoto } from "./media/MealPhoto";
import { VoiceButton } from "./media/VoiceButton";
import { Icon, type IconName } from "./icons";
import { looksLikeDish } from "./logic/foodQuery";

type NutritionBody = RequestBody<"editNutrition">;
type NutritionAction = NutritionBody["action"];

// Local copies of App.tsx's tiny shared UI primitives -- same convention TrainView.tsx /
// ProgressView.tsx already use for their own extraction, avoiding a circular import with App.tsx.
function Card({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "accent" | "muted" }) {
  return <section className={`card card-${tone}`}>{children}</section>;
}


function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="empty"><span className="empty-mark">—</span><strong>{title}</strong><small>{detail}</small></div>;
}

function ErrorState({ lang, error, retry }: { lang: Lang; error: unknown; retry: () => void }) {
  const message = error instanceof ApiError && error.code === "unauthorized" ? t(lang, "unauthorized_error") : t(lang, "generic_error");
  return <Card tone="muted"><div className="error-state"><strong>{message}</strong><button className="button button-ghost" onClick={retry}>{t(lang, "retry")}</button></div></Card>;
}

function Loading() { return <div className="view-stack"><div className="skeleton skeleton-hero" /><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>; }

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
}


type MealPlanDays = NonNullable<Nutrition["mealPlan"]>["days"];
type QuickPanel = "search" | "photo" | "text" | "barcode";

export function FuelView({ lang }: { lang: Lang }) {
  const [nutrition, setNutrition] = useState<Nutrition | null>(null);
  const [error, setError] = useState<unknown>(null);
  // Separate from `error` on purpose: `error` means "couldn't load Fuel, nothing to show" and
  // replaces the whole view with ErrorState. A single action failing (log/search/add/correct/
  // regenerate/send) is recoverable and must not blank an already-rendered day's data out from
  // under the user; it shows as a small dismissible inline note instead.
  const [actionError, setActionError] = useState<unknown>(null);
  const [text, setText] = useState(""); const [search, setSearch] = useState(""); const [barcode, setBarcode] = useState("");
  const [results, setResults] = useState<FoodSearchItem[]>([]); const [searched, setSearched] = useState<string | null>(null); const [grams, setGrams] = useState("100");
  const [saving, setSaving] = useState(false); const [searching, setSearching] = useState(false); const [selected, setSelected] = useState<FoodSearchItem | null>(null);
  const [editing, setEditing] = useState<number | null>(null); const [correction, setCorrection] = useState({ kcal: "", protein: "", fats: "", carbs: "", grams: "" });
  const [advice, setAdvice] = useState(""); const [adviceBusy, setAdviceBusy] = useState(false); const [grocery, setGrocery] = useState<GroceryLine[] | null>(null); const [groceryDays, setGroceryDays] = useState(3);
  const [regenBusy, setRegenBusy] = useState(false); const [regenNote, setRegenNote] = useState(false);
  const [grocerySendBusy, setGrocerySendBusy] = useState(false); const [grocerySent, setGrocerySent] = useState(false);
  const [tab, setTab] = useState<"day" | "plan" | "grocery">("day");
  const [quick, setQuick] = useState<QuickPanel | null>(null);
  const load = () => { setError(null); api<Nutrition>("/api/v2/nutrition").then(setNutrition).catch(setError); };
  useEffect(load, []);
  const log = async () => { if (!text.trim()) return; setSaving(true); try { await api("/api/v2/log", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"quickLog">({ kind: "food", text: text.trim() }) }); setText(""); load(); } catch (err) { setActionError(err); } finally { setSaving(false); } };
  const searchFood = async (action: "dbsearch" | "barcode") => { const q = action === "dbsearch" ? search.trim() : barcode.replace(/\D/g, ""); if (!q || q.length < 2) return; setSearching(true); try { const result = await api<{ items: FoodSearchItem[] }>("/api/v2/nutrition", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"editNutrition">(action === "dbsearch" ? { action, q } : { action, code: q }) }); setResults(result.items ?? []); if (action === "dbsearch") setSearched(q); } catch (err) { setActionError(err); } finally { setSearching(false); } };
  // A dish or an empty search: the same AI free-text log as "Describe", fed the search words.
  const logSearchAsMeal = async () => { const q = search.trim(); if (!q) return; setSaving(true); try { await api("/api/v2/log", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"quickLog">({ kind: "food", text: q }) }); setSearch(""); setSearched(null); setResults([]); load(); } catch (err) { setActionError(err); } finally { setSaving(false); } };
  const addFood = async (item: FoodSearchItem) => { const amount = Number(grams); if (!Number.isFinite(amount) || amount < 1 || amount > 3000) return; setSaving(true); try { await api("/api/v2/nutrition", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"editNutrition">({ action: "dbadd", name: item.name, ...(item.brand ? { brand: item.brand } : {}), grams: amount, per100: item.per100 }) }); setSelected(null); setResults([]); load(); } catch (err) { setActionError(err); } finally { setSaving(false); } };
  const readd = async (ri: number) => { setSaving(true); try { await api("/api/v2/nutrition", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"editNutrition">({ action: "readd", ri }) }); load(); } catch (err) { setActionError(err); } finally { setSaving(false); } };
  const mutateMeal = async (action: NutritionAction, index: number, extra: Omit<Partial<NutritionBody>, "action" | "index"> = {}) => { setSaving(true); try { await api("/api/v2/nutrition", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"editNutrition">({ action, index, ...extra }) }); setEditing(null); load(); } catch (err) { setActionError(err); } finally { setSaving(false); } };
  const openMealEdit = (meal: Nutrition["meals"][number]) => { setEditing(meal.index); setCorrection({ kcal: String(meal.kcal), protein: String(meal.protein), fats: String(meal.fats), carbs: String(meal.carbs), grams: meal.grams ? String(meal.grams) : "" }); };
  const saveCorrection = () => { if (editing === null) return; void mutateMeal("macros", editing, { kcal: Number(correction.kcal), protein: Number(correction.protein), fats: Number(correction.fats), carbs: Number(correction.carbs) }); };
  const askNutrition = async (action: "recipe" | "recover") => { setAdviceBusy(true); try { const result = await api<{ text: string }>("/api/v2/nutrition", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"editNutrition">({ action }) }); setAdvice(result.text || t(lang, "no_advice_available")); } catch (err) { setActionError(err); } finally { setAdviceBusy(false); } };
  const loadGrocery = async (days: number) => { setGroceryDays(days); setGrocerySent(false); try { const result = await api<{ lines: GroceryLine[] }>("/api/v2/nutrition", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"editNutrition">({ action: "grocery", days }) }); setGrocery(result.lines); } catch (err) { setActionError(err); } };
  // Regenerate today's plan, reusing the same allergen/likes/dislikes prefs already on file --
  // same "keep my prefs, build a fresh day" action as the bot's mp:useprev button. A from-scratch
  // questionnaire (new allergens/likes/dislikes) stays bot-only (a multi-step chat intake, not a
  // single-tap mutation this endpoint pattern fits).
  const regenerateMealPlan = async () => {
    setRegenBusy(true); setRegenNote(false);
    try {
      const result = await api<{ days: MealPlanDays }>("/api/v2/nutrition", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"editNutrition">({ action: "mealplan_regen" }) });
      setNutrition((current) => current ? { ...current, mealPlan: { days: result.days } } : current);
      setRegenNote(true);
    } catch (err) { setActionError(err); } finally { setRegenBusy(false); }
  };
  // Point edit of one item inside the meal-plan template -- separate from mutateMeal above,
  // which edits the day's LOGGED meals. dayIndex/mealIndex/itemIndex address the nested
  // day -> meal -> items shape (mealPlan.days[].meals[].items[]).
  const [planEditing, setPlanEditing] = useState<{ dayIndex: number; mealIndex: number; itemIndex: number } | null>(null);
  const [planGrams, setPlanGrams] = useState("");
  const mutateMealPlanItem = async (action: NutritionAction, extra: Omit<Partial<NutritionBody>, "action"> = {}) => {
    if (!planEditing) return;
    setSaving(true);
    try {
      const result = await api<{ days: MealPlanDays }>("/api/v2/nutrition", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"editNutrition">({ action, ...planEditing, ...extra }) });
      setNutrition((current) => current ? { ...current, mealPlan: { days: result.days } } : current);
      setPlanEditing(null);
    } catch (err) { setActionError(err); } finally { setSaving(false); }
  };
  // Push the grocery checklist to the viewer's own Telegram chat -- same delivery pattern as the
  // week-card / photo-compare exports in ExtrasView (the webview can't offer a file download).
  const sendGrocery = async () => {
    setGrocerySendBusy(true); setGrocerySent(false);
    try {
      await api("/api/v2/nutrition", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"editNutrition">({ action: "grocery_send", days: groceryDays }) });
      setGrocerySent(true);
    } catch (err) { setActionError(err); } finally { setGrocerySendBusy(false); }
  };
  if (error) return <ErrorState lang={lang} error={error} retry={load} />; if (!nutrition) return <Loading />;
  const targets = nutrition.targets;
  const hasPlan = Boolean(nutrition.mealPlan?.days?.length);
  const macro = (label: string, value: number, goal: number | undefined, tone: string) => (
    <div className="macro-row num" key={label}>
      <span>{label}</span>
      <span className="macro-track"><i className={tone} style={{ width: `${goal ? Math.min(100, (value / goal) * 100) : 0}%` }} /></span>
      <span className="macro-val"><b>{formatNumber(value)}</b>{goal ? ` / ${formatNumber(goal)}` : ""} {t(lang, "unit_g")}</span>
    </div>
  );
  const QUICK: Array<{ id: QuickPanel; icon: IconName; label: string }> = [
    { id: "search", icon: "search", label: t(lang, "search_btn") },
    { id: "photo", icon: "camera", label: t(lang, "fuel_photo_tile") },
    { id: "text", icon: "mic", label: t(lang, "fuel_voice_tile") },
    { id: "barcode", icon: "barcode", label: t(lang, "barcode_ph") },
  ];
  return <div className="view-stack">
    {hasPlan && <div className="segmented three" role="tablist">
      {(["day", "plan", "grocery"] as const).map((id) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{t(lang, id === "day" ? "fuel_tab_day" : id === "plan" ? "fuel_tab_plan" : "fuel_tab_grocery")}</button>)}
    </div>}
    {actionError !== null && <Card tone="muted"><div className="error-state"><strong>{t(lang, "generic_error")}</strong><button className="button button-ghost" onClick={() => setActionError(null)}>{t(lang, "close")}</button></div></Card>}
    {tab === "day" && <>
      <section className="kcal-card">
        <div className="row-between">
          <span className="kcal-big num">{formatNumber(nutrition.totals.kcal)}{targets && <span> / {formatNumber(targets.calories)} {t(lang, "kcal_unit")}</span>}</span>
          {nutrition.isRestDay && <span className="pill pill-good">{t(lang, "fuel_rest_day_badge")}</span>}
        </div>
        <div className="kcal-track" role="progressbar" aria-label={t(lang, "metric_calories")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={targets ? Math.min(100, Math.round((nutrition.totals.kcal / targets.calories) * 100)) : 0}><i style={{ width: `${targets ? Math.min(100, (nutrition.totals.kcal / targets.calories) * 100) : 0}%` }} /></div>
        {macro(t(lang, "metric_protein"), nutrition.totals.protein, targets?.protein, "p")}
        {macro(t(lang, "metric_fats"), nutrition.totals.fats, targets?.fats, "f")}
        {macro(t(lang, "metric_carbs"), nutrition.totals.carbs, targets?.carbs, "c")}
      </section>
      <div className="quick-grid">
        {QUICK.map((q) => <button key={q.id} type="button" className={q.id === "search" ? "quick-tile main" : "quick-tile"} aria-pressed={quick === q.id} onClick={() => setQuick(quick === q.id ? null : q.id)}><i><Icon name={q.icon} /></i>{q.label}</button>)}
      </div>
      {quick === "search" && <Card>
        <div className="input-row"><input value={search} placeholder={t(lang, "search_input_ph")} autoFocus onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchFood("dbsearch"); }} /><button className="button button-primary" onClick={() => void searchFood("dbsearch")} disabled={searching}>{searching ? "…" : t(lang, "search_btn")}</button></div>
        {searched !== null && searched === search.trim() && (results.length === 0 || looksLikeDish(searched)) && <div className="search-ai">
          {results.length === 0 && <p className="muted">{t(lang, "search_none")}</p>}
          <button className="button button-ghost button-wide" onClick={() => void logSearchAsMeal()} disabled={saving}>{saving ? "…" : t(lang, "search_ai_btn")}</button>
          <small className="muted">{t(lang, "search_ai_hint")}</small>
        </div>}
        {results.length === 0 && nutrition.recent?.length ? <div className="food-results">{nutrition.recent.slice(0, 6).map((item) => <button className="food-result" key={item.ri} onClick={() => void readd(item.ri)} disabled={saving}><span><strong>{item.desc}</strong><small>{t(lang, "fuel_recent_hint")}</small></span><span>{formatNumber(item.kcal)}</span></button>)}</div> : null}
        {results.length > 0 && <div className="food-results">{results.map((item) => <button className="food-result" key={`${item.name}-${item.brand ?? ""}`} onClick={() => { setSelected(item); if (item.portionG) setGrams(String(item.portionG)); }}><span><strong>{item.name}</strong><small>{item.brand || t(lang, "per_100g")}</small></span><span>{item.per100.kcal}</span></button>)}</div>}
        {selected && <div className="portion-editor"><strong>{selected.name}</strong><div className="input-row"><input type="number" min="1" max="3000" value={grams} onChange={(event) => setGrams(event.target.value)} /><span className="muted">{t(lang, "grams_unit")}</span><button className="button button-primary" onClick={() => void addFood(selected)} disabled={saving}>{t(lang, "add_portion_btn")}</button></div></div>}
      </Card>}
      {quick === "photo" && <Card><MealPhoto lang={lang} onLogged={load} /></Card>}
      {quick === "text" && <Card>
        <div className="input-row"><input value={text} placeholder={t(lang, "meal_input_ph")} autoFocus onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void log(); }} /><VoiceButton lang={lang} disabled={saving} onText={(spoken) => setText((cur) => (cur.trim() ? `${cur.trim()}, ${spoken}` : spoken))} /><button className="button button-primary" onClick={() => void log()} disabled={saving}>{saving ? "…" : t(lang, "log_btn")}</button></div>
      </Card>}
      {quick === "barcode" && <Card>
        <div className="input-row"><input value={barcode} inputMode="numeric" autoFocus placeholder={t(lang, "barcode_ph")} onChange={(event) => setBarcode(event.target.value)} /><button className="button button-primary" onClick={() => void searchFood("barcode")} disabled={searching}>{t(lang, "scan_code_btn")}</button></div>
        {results.length > 0 && <div className="food-results">{results.map((item) => <button className="food-result" key={`${item.name}-${item.brand ?? ""}`} onClick={() => { setSelected(item); if (item.portionG) setGrams(String(item.portionG)); }}><span><strong>{item.name}</strong><small>{item.brand || t(lang, "per_100g")}</small></span><span>{item.per100.kcal}</span></button>)}</div>}
        {selected && <div className="portion-editor"><strong>{selected.name}</strong><div className="input-row"><input type="number" min="1" max="3000" value={grams} onChange={(event) => setGrams(event.target.value)} /><span className="muted">{t(lang, "grams_unit")}</span><button className="button button-primary" onClick={() => void addFood(selected)} disabled={saving}>{t(lang, "add_portion_btn")}</button></div></div>}
      </Card>}
      {nutrition.meals.length ? <div className="list meals">{nutrition.meals.map((meal) => <div key={meal.index}>
        <button type="button" className="list-item" aria-expanded={editing === meal.index} onClick={() => (editing === meal.index ? setEditing(null) : openMealEdit(meal))}>
          <span className="grow"><strong>{meal.desc}</strong><small className="num">{meal.grams ? t(lang, "grams_prefix", { n: meal.grams }) : ""}{t(lang, "macro_line", { p: formatNumber(meal.protein), f: formatNumber(meal.fats), c: formatNumber(meal.carbs) })}</small></span>
          <span className="row-value num">{formatNumber(meal.kcal)}</span>
        </button>
        {editing === meal.index && <div className="meal-editor"><div className="form-grid"><input type="number" value={correction.kcal} aria-label={t(lang, "metric_calories")} onChange={(event) => setCorrection({ ...correction, kcal: event.target.value })} /><input type="number" value={correction.protein} aria-label={t(lang, "metric_protein")} onChange={(event) => setCorrection({ ...correction, protein: event.target.value })} /><input type="number" value={correction.fats} aria-label={t(lang, "metric_fats")} onChange={(event) => setCorrection({ ...correction, fats: event.target.value })} /><input type="number" value={correction.carbs} aria-label={t(lang, "metric_carbs")} onChange={(event) => setCorrection({ ...correction, carbs: event.target.value })} /></div><input type="number" placeholder={t(lang, "grams_unit")} value={correction.grams} onChange={(event) => setCorrection({ ...correction, grams: event.target.value })} /><div className="button-row"><button className="button button-primary" disabled={saving} onClick={saveCorrection}>{t(lang, "save_btn")}</button><button className="button button-secondary" disabled={saving} onClick={() => void mutateMeal("grams", meal.index, { grams: Number(correction.grams) })}>{t(lang, "save_grams_btn")}</button><button className="button button-quiet" disabled={saving} onClick={() => void mutateMeal("scale", meal.index, { factor: 0.5 })}>½×</button><button className="button button-quiet" disabled={saving} onClick={() => void mutateMeal("scale", meal.index, { factor: 1.5 })}>1.5×</button><button className="button button-quiet danger" disabled={saving} onClick={() => void mutateMeal("del", meal.index)}>{t(lang, "delete_btn")}</button></div></div>}
      </div>)}</div> : <Empty title={t(lang, "nothing_logged_title")} detail={t(lang, "nothing_logged_detail")} />}
      <div className="button-row"><button className="button button-quiet" disabled={adviceBusy} onClick={() => void askNutrition("recipe")}>{t(lang, "recipe_btn")}</button><button className="button button-quiet" disabled={adviceBusy} onClick={() => void askNutrition("recover")}>{t(lang, "recover_btn")}</button></div>
      {advice && <div className="info-box">{advice}</div>}
    </>}
    {tab === "plan" && hasPlan && nutrition.mealPlan && <>
      <Card>
        <div className="section-head"><div><span className="eyebrow">{t(lang, "meal_plan_eyebrow")}</span><h2>{t(lang, "use_plan_compass_title")}</h2></div><span className="tag">{nutrition.mealPlan.days.length}</span></div>
        <p className="muted">{t(lang, "meal_plan_detail", { n: nutrition.mealPlan.days.length })}</p>
        <div className="meal-plan-list">{nutrition.mealPlan.days.map((day, dayIndex) => <div className="meal-plan-day" key={day.label}><strong>{day.label}</strong>{day.meals.map((meal, mealIndex) => <div key={meal.name}>
          <span className="meal-plan-name">{meal.name}</span>
          {meal.items.map((item, itemIndex) => {
            const editKey = { dayIndex, mealIndex, itemIndex };
            const isEditing = planEditing && planEditing.dayIndex === dayIndex && planEditing.mealIndex === mealIndex && planEditing.itemIndex === itemIndex;
            return <div className="plan-row" key={item.food}>
              <button className="text-button" onClick={() => { setPlanEditing(isEditing ? null : editKey); setPlanGrams(String(item.grams)); }}>{item.food} {item.grams} {t(lang, "unit_g")}</button>
              {isEditing && <div className="meal-editor">
                <div className="button-row">
                  {([0.5, 1.5, 2] as const).map((f) => <button className="button button-ghost" key={f} disabled={saving} onClick={() => void mutateMealPlanItem("mealplan_item_scale", { factor: f })}>×{f}</button>)}
                </div>
                <div className="input-row">
                  <input value={planGrams} inputMode="numeric" onChange={(event) => setPlanGrams(event.target.value)} />
                  <button className="button button-ghost" disabled={saving || !planGrams} onClick={() => void mutateMealPlanItem("mealplan_item_grams", { grams: Number(planGrams) })}>{t(lang, "save_btn")}</button>
                  <button className="text-button danger-button" disabled={saving} onClick={() => void mutateMealPlanItem("mealplan_item_del")}>{t(lang, "delete_btn")}</button>
                </div>
              </div>}
            </div>;
          })}
        </div>)}</div>)}</div>
        <div className="button-row" style={{ marginTop: 10 }}>
          <button className="button button-ghost" disabled={regenBusy} onClick={() => void regenerateMealPlan()}>{regenBusy ? t(lang, "saving_ellipsis") : t(lang, "mealplan_regenerate_btn")}</button>
        </div>
        {regenNote && <div className="save-note">{t(lang, "mealplan_regenerated_note")}</div>}
      </Card>
    </>}
    {tab === "grocery" && hasPlan && <>
      <Card>
        <div className="section-head"><div><span className="eyebrow">{t(lang, "grocery_eyebrow")}</span><h2>{t(lang, "grocery_title")}</h2></div><div className="button-row">{[3, 5, 7].map((days) => <button key={days} className={groceryDays === days ? "button button-primary" : "button button-ghost"} onClick={() => void loadGrocery(days)}>{t(lang, "grocery_days", { n: days })}</button>)}</div></div>
        {grocery ? <div className="grocery-list">{grocery.length ? grocery.map((line) => <div className="record-row" key={`${line.category}-${line.food}`}><strong>{line.food}</strong><span>{line.grams} {t(lang, "unit_g")}</span></div>) : <p className="muted">{t(lang, "grocery_empty")}</p>}</div> : <p className="muted">{t(lang, "grocery_hint")}</p>}
        {grocery?.length ? <div className="button-row" style={{ marginTop: 10 }}>
          <button className="button button-primary" disabled={grocerySendBusy} onClick={() => void sendGrocery()}>{grocerySendBusy ? t(lang, "saving_ellipsis") : t(lang, "grocery_send_btn")}</button>
        </div> : null}
        {grocerySent && <div className="save-note">{t(lang, "grocery_sent_note")}</div>}
      </Card>
    </>}
  </div>;
}
