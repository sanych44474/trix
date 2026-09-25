import { useEffect, useState } from "react";
import { api, ApiError, jsonBody, typedBody } from "./api";
import type { FoodSearchItem, GroceryLine, Nutrition } from "./types";
import { t, type Lang } from "./i18n";
import type { RequestBody } from "./types";

type NutritionBody = RequestBody<"editNutrition">;
type NutritionAction = NutritionBody["action"];

// Local copies of App.tsx's tiny shared UI primitives -- same convention TrainView.tsx /
// ProgressView.tsx already use for their own extraction, avoiding a circular import with App.tsx.
function Card({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "accent" | "muted" }) {
  return <section className={`card card-${tone}`}>{children}</section>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
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

export function FuelView({ lang }: { lang: Lang }) {
  const [nutrition, setNutrition] = useState<Nutrition | null>(null);
  const [error, setError] = useState<unknown>(null);
  // Separate from `error` on purpose: `error` means "couldn't load Fuel, nothing to show" and
  // replaces the whole view with ErrorState. A single action failing (log/search/add/correct/
  // regenerate/send) is recoverable and must not blank an already-rendered day's data out from
  // under the user; it shows as a small dismissible inline note instead.
  const [actionError, setActionError] = useState<unknown>(null);
  const [text, setText] = useState(""); const [search, setSearch] = useState(""); const [barcode, setBarcode] = useState("");
  const [results, setResults] = useState<FoodSearchItem[]>([]); const [grams, setGrams] = useState("100");
  const [saving, setSaving] = useState(false); const [searching, setSearching] = useState(false); const [selected, setSelected] = useState<FoodSearchItem | null>(null);
  const [editing, setEditing] = useState<number | null>(null); const [correction, setCorrection] = useState({ kcal: "", protein: "", fats: "", carbs: "", grams: "" });
  const [advice, setAdvice] = useState(""); const [adviceBusy, setAdviceBusy] = useState(false); const [grocery, setGrocery] = useState<GroceryLine[] | null>(null); const [groceryDays, setGroceryDays] = useState(3);
  const [regenBusy, setRegenBusy] = useState(false); const [regenNote, setRegenNote] = useState(false);
  const [grocerySendBusy, setGrocerySendBusy] = useState(false); const [grocerySent, setGrocerySent] = useState(false);
  const load = () => { setError(null); api<Nutrition>("/api/v2/nutrition").then(setNutrition).catch(setError); };
  useEffect(load, []);
  const log = async () => { if (!text.trim()) return; setSaving(true); try { await api("/api/v2/log", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"quickLog">({ kind: "food", text: text.trim() }) }); setText(""); load(); } catch (err) { setActionError(err); } finally { setSaving(false); } };
  const searchFood = async (action: "dbsearch" | "barcode") => { const q = action === "dbsearch" ? search.trim() : barcode.replace(/\D/g, ""); if (!q || q.length < 2) return; setSearching(true); try { const result = await api<{ items: FoodSearchItem[] }>("/api/v2/nutrition", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"editNutrition">(action === "dbsearch" ? { action, q } : { action, code: q }) }); setResults(result.items ?? []); } catch (err) { setActionError(err); } finally { setSearching(false); } };
  const addFood = async (item: FoodSearchItem) => { const amount = Number(grams); if (!Number.isFinite(amount) || amount < 1 || amount > 3000) return; setSaving(true); try { await api("/api/v2/nutrition", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"editNutrition">({ action: "dbadd", name: item.name, grams: amount, per100: item.per100 }) }); setSelected(null); setResults([]); load(); } catch (err) { setActionError(err); } finally { setSaving(false); } };
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
  return <div className="view-stack">
    <div className="eyebrow">{t(lang, "fuel_eyebrow", { date: nutrition.date })}</div>
    <div className="page-title"><h1>{t(lang, "eat_intent_title")}</h1><span>{t(lang, "kcal_value", { n: formatNumber(nutrition.totals.kcal) })}</span></div>
    {actionError !== null && <Card tone="muted"><div className="error-state"><strong>{t(lang, "generic_error")}</strong><button className="button button-ghost" onClick={() => setActionError(null)}>{t(lang, "close")}</button></div></Card>}
    <Card tone="accent">
      {nutrition.isRestDay && <div className="tag" style={{ marginBottom: 10 }}>{t(lang, "fuel_rest_day_badge")}</div>}
      <div className="macro-grid"><Metric label={t(lang, "metric_calories")} value={`${formatNumber(nutrition.totals.kcal)}`} detail={nutrition.targets ? t(lang, "of_n", { n: formatNumber(nutrition.targets.calories) }) : undefined} /><Metric label={t(lang, "metric_protein")} value={`${formatNumber(nutrition.totals.protein)} g`} detail={nutrition.targets ? t(lang, "of_n_g", { n: formatNumber(nutrition.targets.protein) }) : undefined} /><Metric label={t(lang, "metric_fats")} value={`${formatNumber(nutrition.totals.fats)} g`} detail={nutrition.targets ? t(lang, "of_n_g", { n: formatNumber(nutrition.targets.fats) }) : undefined} /><Metric label={t(lang, "metric_carbs")} value={`${formatNumber(nutrition.totals.carbs)} g`} detail={nutrition.targets ? t(lang, "of_n_g", { n: formatNumber(nutrition.targets.carbs) }) : undefined} /></div>
    </Card>
    <Card><div className="section-head"><div><span className="eyebrow">{t(lang, "ai_quick_log_eyebrow")}</span><h2>{t(lang, "describe_meal_title")}</h2></div></div><div className="input-row"><input value={text} placeholder={t(lang, "meal_input_ph")} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void log(); }} /><button className="button button-primary" onClick={() => void log()} disabled={saving}>{saving ? "…" : t(lang, "log_btn")}</button></div><div className="button-row nutrition-advice"><button className="button button-ghost" disabled={adviceBusy} onClick={() => void askNutrition("recipe")}>{t(lang, "recipe_btn")}</button><button className="button button-ghost" disabled={adviceBusy} onClick={() => void askNutrition("recover")}>{t(lang, "recover_btn")}</button></div>{advice && <div className="info-box">{advice}</div>}</Card>
    <Card><div className="section-head"><div><span className="eyebrow">{t(lang, "food_search_eyebrow")}</span><h2>{t(lang, "measured_portions_title")}</h2></div></div><div className="input-row"><input value={search} placeholder={t(lang, "search_input_ph")} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchFood("dbsearch"); }} /><button className="button button-ghost" onClick={() => void searchFood("dbsearch")} disabled={searching}>{searching ? "…" : t(lang, "search_btn")}</button></div><div className="input-row"><input value={barcode} inputMode="numeric" placeholder={t(lang, "barcode_ph")} onChange={(event) => setBarcode(event.target.value)} /><button className="button button-ghost" onClick={() => void searchFood("barcode")} disabled={searching}>{t(lang, "scan_code_btn")}</button></div>{results.length > 0 && <div className="food-results">{results.map((item) => <button className="food-result" key={`${item.name}-${item.brand ?? ""}`} onClick={() => setSelected(item)}><span><strong>{item.name}</strong><small>{item.brand || t(lang, "per_100g")}</small></span><span>{item.per100.kcal} kcal</span></button>)}</div>}{selected && <div className="portion-editor"><strong>{selected.name}</strong><div className="input-row"><input type="number" min="1" max="3000" value={grams} onChange={(event) => setGrams(event.target.value)} /><span className="muted">{t(lang, "grams_unit")}</span><button className="button button-primary" onClick={() => void addFood(selected)} disabled={saving}>{t(lang, "add_portion_btn")}</button></div></div>}</Card>
    {nutrition.recent?.length ? <Card><div className="section-head"><div><span className="eyebrow">{t(lang, "recent_eyebrow")}</span><h2>{t(lang, "repeat_meal_title")}</h2></div></div><div className="food-results">{nutrition.recent.slice(0, 6).map((item) => <button className="food-result" key={item.ri} onClick={() => void readd(item.ri)} disabled={saving}><span><strong>{item.desc}</strong><small>{t(lang, "protein_short", { n: formatNumber(item.protein) })}</small></span><span>{formatNumber(item.kcal)} kcal</span></button>)}</div></Card> : null}
    {nutrition.meals.length ? <Card><div className="section-head"><div><span className="eyebrow">{t(lang, "today_eyebrow")}</span><h2>{t(lang, "logged_meals_title")}</h2></div></div><div className="meal-list">{nutrition.meals.map((meal) => <div className="meal-row meal-row-edit" key={meal.index}><div><strong>{meal.desc}</strong><small>{meal.grams ? t(lang, "grams_prefix", { n: meal.grams }) : ""}{t(lang, "macro_line", { p: formatNumber(meal.protein), f: formatNumber(meal.fats), c: formatNumber(meal.carbs) })}</small></div><span>{formatNumber(meal.kcal)}</span><button className="text-button" onClick={() => openMealEdit(meal)}>{t(lang, "edit_btn")}</button>{editing === meal.index && <div className="meal-editor"><div className="form-grid"><input type="number" value={correction.kcal} aria-label={t(lang, "metric_calories")} onChange={(event) => setCorrection({ ...correction, kcal: event.target.value })} /><input type="number" value={correction.protein} aria-label={t(lang, "metric_protein")} onChange={(event) => setCorrection({ ...correction, protein: event.target.value })} /><input type="number" value={correction.fats} aria-label={t(lang, "metric_fats")} onChange={(event) => setCorrection({ ...correction, fats: event.target.value })} /><input type="number" value={correction.carbs} aria-label={t(lang, "metric_carbs")} onChange={(event) => setCorrection({ ...correction, carbs: event.target.value })} /></div><div className="button-row"><button className="button button-primary" disabled={saving} onClick={saveCorrection}>{t(lang, "save_btn")}</button><button className="button button-ghost" disabled={saving} onClick={() => void mutateMeal("grams", meal.index, { grams: Number(correction.grams) })}>{t(lang, "save_grams_btn")}</button><button className="text-button" disabled={saving} onClick={() => void mutateMeal("scale", meal.index, { factor: 0.5 })}>½×</button><button className="text-button" disabled={saving} onClick={() => void mutateMeal("scale", meal.index, { factor: 1.5 })}>1.5×</button><button className="text-button danger-button" disabled={saving} onClick={() => void mutateMeal("del", meal.index)}>{t(lang, "delete_btn")}</button></div><input type="number" placeholder={t(lang, "grams_unit")} value={correction.grams} onChange={(event) => setCorrection({ ...correction, grams: event.target.value })} /></div>}</div>)}</div></Card> : <Empty title={t(lang, "nothing_logged_title")} detail={t(lang, "nothing_logged_detail")} />}
    {nutrition.mealPlan?.days?.length ? <>
      <Card>
        <div className="section-head"><div><span className="eyebrow">{t(lang, "meal_plan_eyebrow")}</span><h2>{t(lang, "use_plan_compass_title")}</h2></div><span className="tag">{nutrition.mealPlan.days.length}</span></div>
        <p className="muted">{t(lang, "meal_plan_detail", { n: nutrition.mealPlan.days.length })}</p>
        <div className="meal-plan-list">{nutrition.mealPlan.days.map((day, dayIndex) => <div className="meal-plan-day" key={day.label}><strong>{day.label}</strong>{day.meals.map((meal, mealIndex) => <div key={meal.name}>
          <span className="meal-plan-name">{meal.name}</span>
          {meal.items.map((item, itemIndex) => {
            const editKey = { dayIndex, mealIndex, itemIndex };
            const isEditing = planEditing && planEditing.dayIndex === dayIndex && planEditing.mealIndex === mealIndex && planEditing.itemIndex === itemIndex;
            return <div className="plan-row" key={item.food}>
              <button className="text-button" onClick={() => { setPlanEditing(isEditing ? null : editKey); setPlanGrams(String(item.grams)); }}>{item.food} {item.grams}g</button>
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
      <Card>
        <div className="section-head"><div><span className="eyebrow">{t(lang, "grocery_eyebrow")}</span><h2>{t(lang, "grocery_title")}</h2></div><div className="button-row">{[3, 5, 7].map((days) => <button key={days} className={groceryDays === days ? "button button-primary" : "button button-ghost"} onClick={() => void loadGrocery(days)}>{days}d</button>)}</div></div>
        {grocery ? <div className="grocery-list">{grocery.length ? grocery.map((line) => <div className="record-row" key={`${line.category}-${line.food}`}><strong>{line.food}</strong><span>{line.grams} g</span></div>) : <p className="muted">{t(lang, "grocery_empty")}</p>}</div> : <p className="muted">{t(lang, "grocery_hint")}</p>}
        {grocery?.length ? <div className="button-row" style={{ marginTop: 10 }}>
          <button className="button button-primary" disabled={grocerySendBusy} onClick={() => void sendGrocery()}>{grocerySendBusy ? t(lang, "saving_ellipsis") : t(lang, "grocery_send_btn")}</button>
        </div> : null}
        {grocerySent && <div className="save-note">{t(lang, "grocery_sent_note")}</div>}
      </Card>
    </> : null}
  </div>;
}
