// The Plan screen (lazy chunk): the weekly plan editor, mesocycle card, kit fit and change log.
import { RebuildPlanCard } from "./RebuildPlan";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api, ApiError, typedBody } from "./api";
import type { MesoPhase, Plan } from "./types";
import { t, type Key, type Lang } from "./i18n";
import { Icon } from "./icons";
import type { LibraryEntry } from "./logic/library";

// The 750-exercise library (data + pictures) loads only when the picker opens.
const LibraryBrowser = lazy(() => import("./Library").then((m) => ({ default: m.LibraryBrowser })));
import { planBalance } from "./logic/muscleLoad";
import { Card, Empty, ErrorState, wmodeLabel, PlanAction, PlanEditBody, DayGroup, DAY_GROUPS, WEEKDAY_KEYS, EQUIPMENT_CHOICES, Loading } from "./App";

// Mirrors src/domain/mesocycle.ts's phaseGuidance() -- rep range/intensity notation is
// non-linguistic (numbers, "RPE"), so it's duplicated here rather than round-tripped through the
// backend, matching this app's convention of small view-local presentation helpers.
export function mesoGuidance(phase: MesoPhase): { reps: string; intensity: string } {
  switch (phase) {
    case "hypertrophy": return { reps: "8–12", intensity: "RPE 7–8" };
    case "strength": return { reps: "3–6", intensity: "RPE 8–9" };
    case "peak": return { reps: "1–3", intensity: "RPE 9–10" };
    case "deload": return { reps: "8–10", intensity: "RPE 5–6" };
  }
}

export function KitFitCard({ lang, kit, busy, onFit }: { lang: Lang; kit: NonNullable<Plan["kit"]>; busy: boolean; onFit: (equipment?: PlanEditBody["equipment"]) => void }) {
  const current = EQUIPMENT_CHOICES.find(([value]) => value === kit.equipment);
  const [choice, setChoice] = useState<PlanEditBody["equipment"]>(current?.[0] ?? "dumbbells only");
  return <Card tone="accent">
    <div className="section-head"><div><span className="eyebrow">{t(lang, "kitfit_eyebrow")}</span><h2>{t(lang, "kitfit_title", { n: kit.mismatches })}</h2></div></div>
    <p>{t(lang, "kitfit_body", { equipment: current ? t(lang, current[1]) : kit.equipment })}</p>
    <div className="button-row">
      <select value={choice} onChange={(event) => setChoice(event.target.value as PlanEditBody["equipment"])} aria-label={t(lang, "field_equipment")}>
        {EQUIPMENT_CHOICES.map(([value, key]) => <option key={value} value={value}>{t(lang, key)}</option>)}
      </select>
      <button className="button button-light" disabled={busy} onClick={() => onFit(choice !== kit.equipment ? choice : undefined)}>{busy ? t(lang, "saving_ellipsis") : t(lang, "kitfit_btn")}</button>
    </div>
  </Card>;
}

export function PlanView({ lang, clientId = null, onBack, onOpenLibrary, canRebuild = false }: { lang: Lang; clientId?: number | null; onBack?: () => void; onOpenLibrary?: () => void; canRebuild?: boolean }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<unknown>(null);
  // Separate from `error` on purpose: `error` means "couldn't load the plan, nothing to show" and
  // replaces the whole editor with ErrorState. A single edit failing -- most commonly a 409 from a
  // stale If-Match version after a concurrent change -- is recoverable and must not blank out an
  // already-rendered plan the user is mid-edit on; it shows as a small dismissible inline note.
  const [actionError, setActionError] = useState<unknown>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newExercises, setNewExercises] = useState<Record<number, string>>({});
  const [swapDrafts, setSwapDrafts] = useState<Record<string, string>>({});
  const [catalogResults, setCatalogResults] = useState<Record<string, Array<{ id: string; name: string; muscle: string }>>>({});
  const [catalogBusy, setCatalogBusy] = useState<string | null>(null);
  const [videoDrafts, setVideoDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [difficultyNote, setDifficultyNote] = useState<{ weekday: number; swapped: number } | null>(null);
  const [showChanges, setShowChanges] = useState(false);
  const [dayBusy, setDayBusy] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<number | null>(null);
  // "pick" is the exercise library over the schedule: add to a day, or (with `swap`) replace one.
  const [sheet, setSheet] = useState<{ kind: "exercise"; weekday: number; index: number } | { kind: "addday"; weekday: number } | { kind: "pick"; weekday: number; swap?: { index: number; name: string } } | null>(null);
  // Escape closes the editing sheet (keyboard and desktop Telegram).
  useEffect(() => {
    if (!sheet) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setSheet(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheet]);
  const [newDayGroup, setNewDayGroup] = useState<DayGroup>("chest");

  const load = () => {
    setError(null);
    api<Plan>(`/api/v2/plan${clientId ? `?clientId=${clientId}` : ""}`).then(setPlan).catch(setError);
  };
  useEffect(load, [clientId]);

  const edit = async (
    weekday: number,
    index: number,
    action: PlanAction,
    value?: string,
    expectName?: string,
    extra: Partial<PlanEditBody> = {},
  ): Promise<boolean> => {
    if (!plan) return false;
    const key = `${weekday}:${index}:${action}`;
    setSaving(key); setSaved(null); setActionError(null);
    try {
      const result = await api<{ ok: true; days: Plan["days"]; version: string; changes?: Plan["changes"] }>("/api/v2/plan", {
        method: "POST",
        headers: { "If-Match": `"${plan.version}"` },
        idempotencyKey: crypto.randomUUID(),
        body: typedBody<"editPlan">({ weekday, index, action, clientId: clientId ?? undefined, value, expectName, ...extra }),
      });
      setPlan({ ...plan, days: result.days, version: result.version, ...(result.changes ? { changes: result.changes } : {}) });
      setSaved(key);
      return true;
    } catch (err) {
      // A 409 here is a stale If-Match version (the plan changed since this copy was loaded) --
      // recoverable by re-fetching, not a reason to blank the editor out from under the user.
      setActionError(err);
      return false;
    } finally {
      setSaving(null);
    }
  };

  const mutateDay = async (key: string, body: Partial<PlanEditBody>) => {
    if (!plan) return;
    setDayBusy(key); setSaved(null); setActionError(null);
    try {
      const result = await api<{ ok: true; days: Plan["days"]; version: string; changes?: Plan["changes"] }>("/api/v2/plan", {
        method: "POST",
        headers: { "If-Match": `"${plan.version}"` },
        idempotencyKey: crypto.randomUUID(),
        body: typedBody<"editPlan">({ ...body, clientId: clientId ?? undefined }),
      });
      setPlan({ ...plan, days: result.days, version: result.version, ...(result.changes ? { changes: result.changes } : {}), ...(key === "fitkit" && plan.kit ? { kit: { equipment: body.equipment ?? plan.kit.equipment, mismatches: 0 } } : {}) });
      setSaved(key);
    } catch (err) { setActionError(err); } finally { setDayBusy(null); }
  };
  // Only weekdays the plan does not already use -- adding a duplicate is a 409 server-side, so
  // don't offer it.
  const removeDay = (weekday: number) => mutateDay(`del:${weekday}`, { action: "daydel", weekday });

  // Whole-day "easier / harder": swaps this day's exercises one difficulty tier (the bot's buttons).
  const stepDifficulty = async (weekday: number, dir: "up" | "down") => {
    if (!plan) return;
    setDayBusy(`diff:${weekday}:${dir}`); setSaved(null); setActionError(null); setDifficultyNote(null);
    try {
      const result = await api<{ ok: true; swapped: number; days: Plan["days"]; version: string; changes?: Plan["changes"] }>("/api/v2/plan", {
        method: "POST",
        headers: { "If-Match": `"${plan.version}"` },
        idempotencyKey: crypto.randomUUID(),
        body: typedBody<"editPlan">({ action: "difficulty", weekday, dir, clientId: clientId ?? undefined }),
      });
      setPlan({ ...plan, days: result.days, version: result.version, ...(result.changes ? { changes: result.changes } : {}) });
      setDifficultyNote({ weekday, swapped: result.swapped });
    } catch (err) { setActionError(err); } finally { setDayBusy(null); }
  };

  const addExercise = async (weekday: number) => {
    const name = newExercises[weekday]?.trim();
    if (!name) return;
    if (await edit(weekday, -1, "add", name)) {
      setNewExercises((current) => ({ ...current, [weekday]: "" }));
      setSheet(null); setOpenDay(weekday);
    }
  };

  const [mesoBusy, setMesoBusy] = useState(false);
  const toggleMeso = async (on: boolean) => {
    if (!plan) return;
    setMesoBusy(true); setActionError(null);
    try {
      await api("/api/v2/plan", {
        method: "POST",
        headers: { "If-Match": `"${plan.version}"` },
        idempotencyKey: crypto.randomUUID(),
        body: typedBody<"editPlan">({ action: "meso", on, clientId: clientId ?? undefined }),
      });
      load();
    } catch (err) { setActionError(err); } finally { setMesoBusy(false); }
  };

  const searchCatalog = async (key: string, query: string) => {
    if (query.trim().length < 2) return;
    setCatalogBusy(key);
    try {
      const result = await api<{ items: Array<{ id: string; name: string; muscle: string }> }>(`/api/v2/plan/catalog?q=${encodeURIComponent(query.trim())}`);
      setCatalogResults((current) => ({ ...current, [key]: result.items ?? [] }));
    } catch (err) {
      setActionError(err);
    } finally {
      setCatalogBusy(null);
    }
  };

  // Recomputed from the live days, so adding the suggested exercise clears its line straight away.
  const balance = useMemo(() => planBalance(plan?.days ?? []), [plan?.days]);
  const fmtSets = (n: number) => (lang === "uk" ? String(n).replace(".", ",") : String(n));
  const muscleName = (slug: string) => t(lang, `muscle_${slug.replace("-", "_")}` as Key);

  if (error) return <ErrorState lang={lang} error={error} retry={load} />;
  if (!plan) return <Loading />;
  if (!plan.days.length) return <Empty title={t(lang, "no_plan_title")} detail={t(lang, "no_plan_detail")} />;

  const sheetDay = sheet && sheet.kind === "exercise" ? plan.days.find((d) => d.weekday === sheet.weekday) : undefined;
  const sheetExercise = sheet && sheet.kind === "exercise" ? sheetDay?.exercises.find((e) => e.index === sheet.index) : undefined;
  const closeSheet = () => setSheet(null);

  const exerciseSheet = () => {
    if (!sheetDay || !sheetExercise) return null;
    const day = sheetDay; const exercise = sheetExercise;
    const base = `${day.weekday}:${exercise.index}`;
    const weightKey = `${base}:weight`;
    const setsKey = `${base}:sets`;
    const swapKey = `${base}:swap`;
    const videoKey = `${base}:video`;
    const noteKey = `${base}:note`;
    const techniqueKey = `${base}:technique`;
    const isSaving = (action: PlanAction) => saving === `${day.weekday}:${exercise.index}:${action}`;
    const canLink = exercise.index < day.exercises.length - 1;
    return <>
      <h2 className="sheet-title">{exercise.name}</h2>
      <p className="muted">{t(lang, WEEKDAY_KEYS[day.weekday - 1])} · {exercise.sets} · {exercise.startWeight}{exercise.wmode && ` · ${wmodeLabel(lang, exercise.wmode)}`}</p>
      <div className="form-grid">
        <label className="form-field"><span>{t(lang, "weight_label")}</span><input value={drafts[weightKey] ?? exercise.startWeight} onChange={(event) => setDrafts((current) => ({ ...current, [weightKey]: event.target.value }))} /></label>
        <label className="form-field"><span>{t(lang, "sets_label")}</span><input value={drafts[setsKey] ?? exercise.sets} onChange={(event) => setDrafts((current) => ({ ...current, [setsKey]: event.target.value }))} /></label>
      </div>
      <button className="button button-primary button-block" disabled={saving !== null || (drafts[weightKey] === undefined && drafts[setsKey] === undefined)} onClick={async () => {
        if (drafts[weightKey] !== undefined && drafts[weightKey] !== exercise.startWeight) await edit(day.weekday, exercise.index, "weight", drafts[weightKey], exercise.name);
        if (drafts[setsKey] !== undefined && drafts[setsKey] !== exercise.sets) await edit(day.weekday, exercise.index, "sets", drafts[setsKey], exercise.name);
      }}>{isSaving("weight") || isSaving("sets") ? t(lang, "saving_ellipsis") : t(lang, "save_btn")}</button>
      <div className="sheet-section">
        <span className="sheet-label">{t(lang, clientId ? "plan_note_label_client" : "plan_note_label")}</span>
        <textarea rows={2} maxLength={300} value={drafts[noteKey] ?? exercise.note ?? ""} placeholder={t(lang, clientId ? "plan_note_ph_client" : "plan_note_ph")} onChange={(event) => setDrafts((current) => ({ ...current, [noteKey]: event.target.value }))} />
        {drafts[noteKey] !== undefined && drafts[noteKey] !== (exercise.note ?? "") && <button className="button button-secondary" disabled={saving !== null} onClick={async () => { if (await edit(day.weekday, exercise.index, "note", drafts[noteKey], exercise.name)) setDrafts((current) => { const next = { ...current }; delete next[noteKey]; return next; }); }}>{isSaving("note") ? t(lang, "saving_ellipsis") : t(lang, "plan_note_save")}</button>}
      </div>
      <div className="sheet-section">
        <span className="sheet-label">{t(lang, "plan_technique_label")}</span>
        <textarea rows={4} maxLength={1000} value={drafts[techniqueKey] ?? exercise.technique ?? ""} placeholder={t(lang, "plan_technique_ph")} onChange={(event) => setDrafts((current) => ({ ...current, [techniqueKey]: event.target.value }))} />
        {drafts[techniqueKey] !== undefined && drafts[techniqueKey].trim() !== "" && drafts[techniqueKey] !== (exercise.technique ?? "") && <button className="button button-secondary" disabled={saving !== null} onClick={async () => { if (await edit(day.weekday, exercise.index, "technique", drafts[techniqueKey], exercise.name)) setDrafts((current) => { const next = { ...current }; delete next[techniqueKey]; return next; }); }}>{isSaving("technique") ? t(lang, "saving_ellipsis") : t(lang, "plan_technique_save")}</button>}
      </div>
      <div className="sheet-section">
        <span className="sheet-label">{t(lang, "plan_swap_btn")}</span>
        <button type="button" className="button button-secondary button-block" onClick={() => setSheet({ kind: "pick", weekday: day.weekday, swap: { index: exercise.index, name: exercise.name } })}><Icon name="search" size={20} />{t(lang, "plan_pick_library")}</button>
        <div className="input-row">
          <input value={swapDrafts[swapKey] ?? ""} maxLength={80} placeholder={t(lang, "plan_swap_ph")} onChange={(event) => setSwapDrafts((current) => ({ ...current, [swapKey]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") void searchCatalog(swapKey, swapDrafts[swapKey] ?? ""); }} />
          <button className="button button-secondary" disabled={catalogBusy === swapKey || (swapDrafts[swapKey] ?? "").trim().length < 2} onClick={() => void searchCatalog(swapKey, swapDrafts[swapKey] ?? "")}>{catalogBusy === swapKey ? "…" : t(lang, "plan_catalog_search")}</button>
        </div>
        {catalogResults[swapKey] && <div className="choice-list">{catalogResults[swapKey].length ? catalogResults[swapKey].map((choice) => <button className="choice-button" key={choice.id} onClick={async () => { if (await edit(day.weekday, exercise.index, "swap", choice.name, exercise.name, { catalogId: choice.id })) { setCatalogResults((current) => ({ ...current, [swapKey]: [] })); setSwapDrafts((current) => ({ ...current, [swapKey]: "" })); closeSheet(); } }}><strong>{choice.name}</strong><small>{choice.muscle}</small></button>) : <span className="muted">{t(lang, "plan_catalog_empty")}</span>}</div>}
      </div>
      <div className="sheet-section">
        <span className="sheet-label">{t(lang, "plan_video_label")}</span>
        <div className="input-row">
          <input value={videoDrafts[videoKey] ?? ""} maxLength={300} placeholder={t(lang, "plan_video_ph")} onChange={(event) => setVideoDrafts((current) => ({ ...current, [videoKey]: event.target.value }))} />
          <button className="button button-secondary" disabled={saving !== null || !(videoDrafts[videoKey] ?? "").trim()} onClick={async () => { if (await edit(day.weekday, exercise.index, "video", videoDrafts[videoKey]?.trim(), exercise.name)) setVideoDrafts((current) => ({ ...current, [videoKey]: "" })); }}>{isSaving("video") ? "…" : t(lang, "plan_video_save")}</button>
        </div>
      </div>
      <div className="action-sheet">
        <button className="chip-button" disabled={saving !== null || exercise.index === 0} onClick={() => void edit(day.weekday, exercise.index, "move", undefined, exercise.name, { dir: "up" })}>{t(lang, "plan_move_up")}</button>
        <button className="chip-button" disabled={saving !== null || exercise.index === day.exercises.length - 1} onClick={() => void edit(day.weekday, exercise.index, "move", undefined, exercise.name, { dir: "down" })}>{t(lang, "plan_move_down")}</button>
        {canLink && <button className="chip-button" disabled={saving !== null} onClick={() => void edit(day.weekday, exercise.index, "link", undefined, exercise.name)}>{exercise.ssGroup ? t(lang, "plan_unlink_btn") : t(lang, "plan_link_btn")}</button>}
        <button className="chip-button danger" disabled={saving !== null} onClick={async () => { if (day.exercises.length <= 1) { setActionError(new Error(t(lang, "plan_last_exercise"))); return; } if (window.confirm(t(lang, "plan_delete_confirm")) && await edit(day.weekday, exercise.index, "del", undefined, exercise.name)) closeSheet(); }}>{t(lang, "plan_delete_btn")}</button>
      </div>
    </>;
  };

  // Library picker: the opened exercise gets "Add to <day>" (or "Swap for this"), which sends the
  // library id so the plan keeps its English canonical name and translated steps.
  const pickSheet = () => {
    if (!sheet || sheet.kind !== "pick") return null;
    const { weekday, swap } = sheet;
    const dayLabel = t(lang, WEEKDAY_KEYS[weekday - 1]);
    const pick = async (ex: LibraryEntry, name: string) => {
      const ok = swap
        ? await edit(weekday, swap.index, "swap", name, swap.name, { freeExerciseId: ex.id })
        : await edit(weekday, -1, "add", name, undefined, { freeExerciseId: ex.id });
      if (ok) { closeSheet(); setOpenDay(weekday); }
    };
    return <>
      <h2 className="sheet-title">{swap ? t(lang, "plan_pick_swap_title", { name: swap.name }) : t(lang, "plan_pick_title", { day: dayLabel })}</h2>
      {!swap && <div className="sheet-section">
        <span className="sheet-label">{t(lang, "plan_pick_own")}</span>
        <div className="input-row">
          <input value={newExercises[weekday] ?? ""} maxLength={80} placeholder={t(lang, "plan_add_ph")} onChange={(event) => setNewExercises((current) => ({ ...current, [weekday]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") void addExercise(weekday); }} />
          <button className="button button-secondary" disabled={saving !== null || !(newExercises[weekday] ?? "").trim()} onClick={() => void addExercise(weekday)}>{saving === `${weekday}:-1:add` ? "…" : t(lang, "plan_add_btn")}</button>
        </div>
      </div>}
      <Suspense fallback={<div className="skeleton" />}>
        <LibraryBrowser lang={lang} action={(ex, name) => <button type="button" className="button button-primary button-block" disabled={saving !== null} onClick={() => void pick(ex, name)}>{saving !== null ? t(lang, "saving_ellipsis") : swap ? t(lang, "plan_pick_swap_btn") : t(lang, "plan_pick_add_btn", { day: dayLabel })}</button>} />
      </Suspense>
    </>;
  };

  const addDaySheet = () => sheet && sheet.kind === "addday" ? <>
    <h2 className="sheet-title">{t(lang, "plan_day_add_title")}</h2>
    <p className="muted">{t(lang, WEEKDAY_KEYS[sheet.weekday - 1])}</p>
    <label className="form-field"><span>{t(lang, "plan_day_group_label")}</span>
      <select value={newDayGroup} onChange={(event) => setNewDayGroup(event.target.value as DayGroup)}>
        {DAY_GROUPS.map((g) => <option key={g} value={g}>{t(lang, `plan_day_g_${g}` as Key)}</option>)}
      </select></label>
    <button className="button button-primary button-block" disabled={dayBusy !== null} onClick={async () => { await mutateDay("add", { action: "dayadd", weekday: sheet.weekday, group: newDayGroup }); closeSheet(); setOpenDay(sheet.weekday); }}>{dayBusy === "add" ? t(lang, "saving_ellipsis") : t(lang, "plan_day_add_btn")}</button>
    <p className="muted">{t(lang, "plan_day_add_hint")}</p>
  </> : null;

  return <div className="view-stack">
    <div className="screen-head"><h1>{clientId ? t(lang, "plan_owner_title", { name: plan.owner.name }) : t(lang, "plan_schedule_title")}</h1><span className="num">{t(lang, "days_count", { n: plan.days.length })}</span></div>
    {onBack && <button className="button button-quiet" onClick={onBack}><Icon name="chevron" size={20} className="flip" />{t(lang, "nav_clients")}</button>}
    {actionError !== null && <Card tone="muted"><div className="error-state"><strong>{actionError instanceof Error && !(actionError instanceof ApiError) ? actionError.message : t(lang, "generic_error")}</strong><button className="button button-ghost" onClick={() => setActionError(null)}>{t(lang, "close")}</button></div></Card>}
    {saved && <div className="save-note">{t(lang, "plan_updated")}</div>}

    <ol className="list schedule">
      {[1, 2, 3, 4, 5, 6, 7].map((weekday) => {
        const day = plan.days.find((d) => d.weekday === weekday);
        if (!day) return <li key={weekday}>
          <button type="button" className="list-item rest-day" onClick={() => setSheet({ kind: "addday", weekday })} disabled={plan.days.length >= 7}>
            <span className="wd">{t(lang, WEEKDAY_KEYS[weekday - 1])}</span>
            <span className="grow">{t(lang, "plan_rest_day")}</span>
            <Icon name="plus" size={20} className="row-chevron" />
          </button>
        </li>;
        const open = openDay === weekday;
        return <li key={weekday} className={open ? "open" : undefined}>
          <button type="button" className="list-item" aria-expanded={open} onClick={() => setOpenDay(open ? null : weekday)}>
            <span className="wd on">{t(lang, WEEKDAY_KEYS[weekday - 1])}</span>
            <span className="grow"><strong>{day.muscleGroup || day.name}</strong><small>{t(lang, "plan_day_meta", { n: day.exercises.length })}</small></span>
            <Icon name="chevron" size={20} className={open ? "row-chevron open" : "row-chevron"} />
          </button>
          {open && <div className="day-body">
            <ol className="day-exercises">
              {day.exercises.map((exercise) => <li key={`${exercise.index}-${exercise.name}`}>
                <button type="button" className="ex-line" onClick={() => setSheet({ kind: "exercise", weekday, index: exercise.index })}>
                  <span className="grow"><strong>{exercise.name}{exercise.ssGroup ? <span className="tag">{t(lang, "plan_superset_label", { group: exercise.ssGroup })}</span> : null}</strong><small className="num">{exercise.sets}{exercise.startWeight && exercise.startWeight !== "—" ? ` · ${exercise.startWeight}` : ""}</small>{exercise.note && <small className="ex-note"><Icon name="chat" size={14} />{exercise.note}</small>}</span>
                  <Icon name="dots" size={20} className="row-chevron" />
                </button>
              </li>)}
            </ol>
            <button type="button" className="button button-secondary button-block" onClick={() => setSheet({ kind: "pick", weekday })}><Icon name="plus" size={20} />{t(lang, "plan_add_exercise_btn")}</button>
            <div className="button-row">
              <button type="button" className="button button-secondary" disabled={dayBusy !== null} onClick={() => void stepDifficulty(weekday, "down")}>{dayBusy === `diff:${weekday}:down` ? "…" : t(lang, "plan_diff_easier_btn")}</button>
              <button type="button" className="button button-secondary" disabled={dayBusy !== null} onClick={() => void stepDifficulty(weekday, "up")}>{dayBusy === `diff:${weekday}:up` ? "…" : t(lang, "plan_diff_harder_btn")}</button>
            </div>
            {difficultyNote?.weekday === weekday && <p className="muted">{difficultyNote.swapped > 0 ? t(lang, "plan_diff_swapped", { n: difficultyNote.swapped }) : t(lang, "plan_diff_none")}</p>}
            {plan.days.length > 1 && <button className="button button-quiet danger" disabled={dayBusy !== null} onClick={() => void removeDay(weekday)}>{dayBusy === `del:${weekday}` ? "…" : t(lang, "plan_day_remove_btn")}</button>}
          </div>}
        </li>;
      })}
    </ol>

    {balance.length > 0 && <Card>
      <h2 className="card-title">{t(lang, "plan_balance_title")}</h2>
      <div className="balance-list">{balance.map((issue) => <div className="balance-row" key={`${issue.kind}-${issue.slug}`}>
        <div>
          <strong>{muscleName(issue.slug)}</strong>
          <small>{issue.kind === "imbalance" && issue.other
            ? t(lang, "plan_balance_imbalance", { weak: fmtSets(issue.sets), strong: fmtSets(issue.other.sets), other: muscleName(issue.other.slug) })
            : t(lang, "plan_balance_missing")}</small>
        </div>
        {issue.suggestion && <button className="button button-secondary" disabled={saving !== null} onClick={() => void edit(issue.suggestion!.weekday, -1, "add", issue.suggestion![lang])}>
          {saving === `${issue.suggestion.weekday}:-1:add` ? "…" : t(lang, "plan_balance_add", { exercise: issue.suggestion[lang], day: t(lang, WEEKDAY_KEYS[issue.suggestion.weekday - 1]) })}
        </button>}
      </div>)}</div>
    </Card>}
    {plan.kit && plan.kit.mismatches > 0 && <KitFitCard lang={lang} kit={plan.kit} busy={dayBusy === "fitkit"} onFit={(equipment) => void mutateDay("fitkit", { action: "fitkit", ...(equipment ? { equipment } : {}) })} />}
    <Card>
      <div className="row-between"><h2 className="card-title">{plan.mesocycle ? t(lang, `meso_phase_${plan.mesocycle.phase}` as Key) : t(lang, "meso_start_btn")}</h2>{plan.mesocycle && <span className="pill pill-good">{t(lang, "meso_week", { n: plan.mesocycle.weekInBlock, total: plan.mesocycle.phase === "deload" ? 1 : plan.mesocycle.blockLength })}</span>}</div>
      {plan.mesocycle ? <>
        <p className="muted">{t(lang, "meso_target_line", mesoGuidance(plan.mesocycle.phase))}</p>
        <div className="button-row"><button className="button button-secondary" disabled={mesoBusy} onClick={() => void toggleMeso(false)}>{mesoBusy ? t(lang, "saving_ellipsis") : t(lang, "meso_stop_btn")}</button></div>
      </> : <>
        <p className="muted">{t(lang, "meso_intro")}</p>
        <div className="button-row"><button className="button button-secondary" disabled={mesoBusy} onClick={() => void toggleMeso(true)}>{mesoBusy ? t(lang, "saving_ellipsis") : t(lang, "meso_start_btn")}</button></div>
      </>}
    </Card>
    {canRebuild && clientId === null && <RebuildPlanCard lang={lang} onDone={load} />}
    {plan.changes.length > 0 && <div className="list">
      <button type="button" className="list-item" aria-expanded={showChanges} onClick={() => setShowChanges((current) => !current)}><span className="grow">{t(lang, "plan_changes_title")}</span><Icon name="chevron" size={20} className={showChanges ? "row-chevron open" : "row-chevron"} /></button>
      {showChanges && <div className="record-list changes">{plan.changes.map((change, index) => <div className="record-row" key={`${change.at}-${index}`}>
        <div><strong>{change.summary}</strong><small>{t(lang, `plan_change_src_${change.source}` as Key)} · {change.at.slice(0, 10)}</small></div>
      </div>)}</div>}
    </div>}
    {onOpenLibrary && clientId === null && <button className="button button-secondary button-block" onClick={onOpenLibrary}>{t(lang, "library_open_btn")}</button>}

    {/* Portalled to <body>: the view stack is its own stacking context, so a fixed sheet inside
        it would sit under the bottom nav. */}
    {sheet && createPortal(<div className="sheet-backdrop" onClick={closeSheet}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={sheet.kind === "exercise" ? sheetExercise?.name : sheet.kind === "pick" ? t(lang, "plan_pick_title", { day: t(lang, WEEKDAY_KEYS[sheet.weekday - 1]) }) : t(lang, "plan_day_add_title")} onClick={(event) => event.stopPropagation()}>
        <div className="sheet-bar"><span className="sheet-handle" aria-hidden="true" /><button type="button" className="icon-button" onClick={closeSheet} aria-label={t(lang, "close")}><Icon name="close" /></button></div>
        {sheet.kind === "exercise" ? exerciseSheet() : sheet.kind === "pick" ? pickSheet() : addDaySheet()}
      </div>
    </div>, document.body)}
  </div>;
}
