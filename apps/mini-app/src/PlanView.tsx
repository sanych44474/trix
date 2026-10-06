// The Plan screen (lazy chunk): the weekly plan editor, mesocycle card, kit fit and change log.
import { RebuildPlanCard } from "./RebuildPlan";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError, typedBody } from "./api";
import type { MesoPhase, Plan } from "./types";
import { t, type Key, type Lang } from "./i18n";
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
  const [showChanges, setShowChanges] = useState(false);
  const [dayBusy, setDayBusy] = useState<string | null>(null);
  const [newDayWeekday, setNewDayWeekday] = useState(1);
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
  const usedWeekdays = new Set((plan?.days ?? []).map((d) => d.weekday));
  const missingWeekdays = [1, 2, 3, 4, 5, 6, 7].filter((w) => !usedWeekdays.has(w));
  const addDay = () => mutateDay("add", { action: "dayadd", weekday: newDayWeekday, group: newDayGroup });
  const removeDay = (weekday: number) => mutateDay(`del:${weekday}`, { action: "daydel", weekday });

  const addExercise = async (weekday: number) => {
    const name = newExercises[weekday]?.trim();
    if (!name) return;
    if (await edit(weekday, -1, "add", name)) {
      setNewExercises((current) => ({ ...current, [weekday]: "" }));
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

  return <div className="view-stack">
    <div className="eyebrow">{t(lang, "plan_eyebrow")}</div>
    <div className="page-title"><h1>{t(lang, "plan_owner_title", { name: plan.owner.name })}</h1><span>{t(lang, "days_count", { n: plan.days.length })}</span></div>
    {onBack && <button className="text-button" onClick={onBack}>← {t(lang, "nav_role")}</button>}
    <Card>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "meso_eyebrow")}</span><h2>{plan.mesocycle ? t(lang, `meso_phase_${plan.mesocycle.phase}` as Key) : t(lang, "meso_start_btn")}</h2></div>{plan.mesocycle && <span className="tag">{t(lang, "meso_week", { n: plan.mesocycle.weekInBlock, total: plan.mesocycle.phase === "deload" ? 1 : plan.mesocycle.blockLength })}</span>}</div>
      {plan.mesocycle ? <>
        <p className="muted">{t(lang, "meso_target_line", mesoGuidance(plan.mesocycle.phase))}</p>
        <div className="button-row"><button className="button button-ghost" disabled={mesoBusy} onClick={() => void toggleMeso(false)}>{mesoBusy ? t(lang, "saving_ellipsis") : t(lang, "meso_stop_btn")}</button></div>
      </> : <>
        <p className="muted">{t(lang, "meso_intro")}</p>
        <div className="button-row"><button className="button button-primary" disabled={mesoBusy} onClick={() => void toggleMeso(true)}>{mesoBusy ? t(lang, "saving_ellipsis") : t(lang, "meso_start_btn")}</button></div>
      </>}
    </Card>
    {plan.changes.length > 0 && <Card tone="muted">
      <div className="section-head"><div><span className="eyebrow">{t(lang, "plan_changes_eyebrow")}</span><h2>{t(lang, "plan_changes_title")}</h2></div><button className="text-button" onClick={() => setShowChanges((current) => !current)}>{showChanges ? t(lang, "close") : t(lang, "details_arrow")}</button></div>
      {showChanges && <div className="record-list">{plan.changes.map((change, index) => <div className="record-row" key={`${change.at}-${index}`}>
        <div><strong>{change.summary}</strong><small>{t(lang, `plan_change_src_${change.source}` as Key)} · {change.at.slice(0, 10)}</small></div>
      </div>)}</div>}
    </Card>}
    {canRebuild && clientId === null && <RebuildPlanCard lang={lang} onDone={load} />}
    {plan.kit && plan.kit.mismatches > 0 && <KitFitCard lang={lang} kit={plan.kit} busy={dayBusy === "fitkit"} onFit={(equipment) => void mutateDay("fitkit", { action: "fitkit", ...(equipment ? { equipment } : {}) })} />}
    {balance.length > 0 && <Card>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "plan_balance_eyebrow")}</span><h2>{t(lang, "plan_balance_title")}</h2></div></div>
      <div className="balance-list">{balance.map((issue) => <div className="balance-row" key={`${issue.kind}-${issue.slug}`}>
        <div>
          <strong>{muscleName(issue.slug)}</strong>
          <small>{issue.kind === "imbalance" && issue.other
            ? t(lang, "plan_balance_imbalance", { weak: fmtSets(issue.sets), strong: fmtSets(issue.other.sets), other: muscleName(issue.other.slug) })
            : t(lang, "plan_balance_missing")}</small>
        </div>
        {issue.suggestion && <button className="button button-ghost" disabled={saving !== null} onClick={() => void edit(issue.suggestion!.weekday, -1, "add", issue.suggestion![lang])}>
          {saving === `${issue.suggestion.weekday}:-1:add` ? "…" : t(lang, "plan_balance_add", { exercise: issue.suggestion[lang], day: t(lang, WEEKDAY_KEYS[issue.suggestion.weekday - 1]) })}
        </button>}
      </div>)}</div>
      <p className="muted">{t(lang, "plan_balance_hint")}</p>
    </Card>}
    <Card tone="muted">
      <div className="section-head"><div><span className="eyebrow">{t(lang, "plan_days_eyebrow")}</span><h2>{t(lang, "plan_day_add_title")}</h2></div></div>
      {missingWeekdays.length === 0 ? <p className="muted">{t(lang, "plan_day_week_full")}</p> : <>
        <div className="form-grid">
          <label className="form-field"><span>{t(lang, "plan_day_weekday_label")}</span>
            <select value={newDayWeekday} onChange={(event) => setNewDayWeekday(Number(event.target.value))}>
              {missingWeekdays.map((w) => <option key={w} value={w}>{t(lang, WEEKDAY_KEYS[w - 1])}</option>)}
            </select></label>
          <label className="form-field"><span>{t(lang, "plan_day_group_label")}</span>
            <select value={newDayGroup} onChange={(event) => setNewDayGroup(event.target.value as DayGroup)}>
              {DAY_GROUPS.map((g) => <option key={g} value={g}>{t(lang, `plan_day_g_${g}` as Key)}</option>)}
            </select></label>
        </div>
        <div className="button-row"><button className="button button-primary" disabled={dayBusy !== null} onClick={() => void addDay()}>{dayBusy === "add" ? t(lang, "saving_ellipsis") : t(lang, "plan_day_add_btn")}</button></div>
        <p className="muted">{t(lang, "plan_day_add_hint")}</p>
      </>}
    </Card>
    <p className="muted">{t(lang, "plan_editor_hint")}</p>
    {onOpenLibrary && clientId === null && <button className="button button-ghost" onClick={onOpenLibrary}>📚 {t(lang, "library_open_btn")}</button>}
    {actionError !== null && <Card tone="muted"><div className="error-state"><strong>{actionError instanceof Error && !(actionError instanceof ApiError) ? actionError.message : t(lang, "generic_error")}</strong><button className="button button-ghost" onClick={() => setActionError(null)}>{t(lang, "close")}</button></div></Card>}
    {saved && <div className="save-note">{t(lang, "plan_updated")}</div>}
    {plan.days.map((day) => <Card key={day.weekday}>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "day_label", { n: day.weekday })}</span><h2>{day.name}</h2></div><span className="tag">{day.muscleGroup}</span>{plan.days.length > 1 && <button className="text-button danger-button" disabled={dayBusy !== null} onClick={() => void removeDay(day.weekday)}>{dayBusy === `del:${day.weekday}` ? "…" : t(lang, "plan_day_remove_btn")}</button>}</div>
      <div className="plan-list">
        {day.exercises.map((exercise) => {
          const base = `${day.weekday}:${exercise.index}`;
          const weightKey = `${base}:weight`;
          const setsKey = `${base}:sets`;
          const swapKey = `${base}:swap`;
          const videoKey = `${base}:video`;
          const isSaving = (action: PlanAction) => saving === `${day.weekday}:${exercise.index}:${action}`;
          const canLink = exercise.index < day.exercises.length - 1;
          return <div className="plan-row plan-row-edit" key={`${day.weekday}-${exercise.index}-${exercise.name}`}>
            <span className="exercise-index">{String(exercise.index + 1).padStart(2, "0")}</span>
            <div>
              <div className="plan-exercise-title"><strong>{exercise.name}</strong>{exercise.ssGroup && <span className="tag">{t(lang, "plan_superset_label", { group: exercise.ssGroup })}</span>}</div>
              <small>{exercise.sets} · {exercise.startWeight}{exercise.wmode && ` · ${wmodeLabel(lang, exercise.wmode)}`}</small>
              {(exercise.technique || exercise.videoUrl) && <div className="plan-reference"><span>{exercise.technique ? `${t(lang, "plan_technique_label")}: ${exercise.technique}` : ""}</span>{exercise.videoUrl && <a href={exercise.videoUrl} target="_blank" rel="noreferrer">{exercise.videoTitle || t(lang, "plan_video_label")}</a>}</div>}
              <div className="plan-edit-fields">
                <input aria-label={t(lang, "weight_field_aria", { name: exercise.name })} value={drafts[weightKey] ?? exercise.startWeight} onChange={(event) => setDrafts((current) => ({ ...current, [weightKey]: event.target.value }))} />
                <button className="button button-ghost" disabled={saving !== null} onClick={() => void edit(day.weekday, exercise.index, "weight", drafts[weightKey] ?? exercise.startWeight, exercise.name)}>{isSaving("weight") ? "…" : saved === weightKey ? t(lang, "saved_label") : t(lang, "weight_label")}</button>
                <input aria-label={t(lang, "sets_field_aria", { name: exercise.name })} value={drafts[setsKey] ?? exercise.sets} onChange={(event) => setDrafts((current) => ({ ...current, [setsKey]: event.target.value }))} />
                <button className="button button-ghost" disabled={saving !== null} onClick={() => void edit(day.weekday, exercise.index, "sets", drafts[setsKey] ?? exercise.sets, exercise.name)}>{isSaving("sets") ? "…" : t(lang, "sets_label")}</button>
              </div>
              <div className="plan-inline-editor">
                <input value={swapDrafts[swapKey] ?? ""} maxLength={80} placeholder={t(lang, "plan_swap_ph")} onChange={(event) => setSwapDrafts((current) => ({ ...current, [swapKey]: event.target.value }))} />
                <button className="button button-ghost" disabled={catalogBusy === swapKey || (swapDrafts[swapKey] ?? "").trim().length < 2} onClick={() => void searchCatalog(swapKey, swapDrafts[swapKey] ?? "")}>{catalogBusy === swapKey ? "…" : t(lang, "plan_catalog_search")}</button>
                <button className="button button-ghost" disabled={saving !== null || !(swapDrafts[swapKey] ?? "").trim()} onClick={async () => { if (await edit(day.weekday, exercise.index, "swap", swapDrafts[swapKey]?.trim(), exercise.name)) setSwapDrafts((current) => ({ ...current, [swapKey]: "" })); }}>{isSaving("swap") ? "…" : t(lang, "plan_swap_btn")}</button>
              </div>
              {catalogResults[swapKey] && <div className="choice-list">{catalogResults[swapKey].length ? catalogResults[swapKey].map((choice) => <button className="choice-button" key={choice.id} onClick={async () => { if (await edit(day.weekday, exercise.index, "swap", choice.name, exercise.name, { catalogId: choice.id })) { setCatalogResults((current) => ({ ...current, [swapKey]: [] })); setSwapDrafts((current) => ({ ...current, [swapKey]: "" })); } }}><strong>{choice.name}</strong><small>{choice.muscle}</small></button>) : <span className="muted">{t(lang, "plan_catalog_empty")}</span>}</div>}
              <div className="plan-inline-editor">
                <input value={videoDrafts[videoKey] ?? ""} maxLength={300} placeholder={t(lang, "plan_video_ph")} onChange={(event) => setVideoDrafts((current) => ({ ...current, [videoKey]: event.target.value }))} />
                <button className="button button-ghost" disabled={saving !== null || !(videoDrafts[videoKey] ?? "").trim()} onClick={async () => { if (await edit(day.weekday, exercise.index, "video", videoDrafts[videoKey]?.trim(), exercise.name)) setVideoDrafts((current) => ({ ...current, [videoKey]: "" })); }}>{isSaving("video") ? "…" : t(lang, "plan_video_save")}</button>
              </div>
              <div className="plan-exercise-actions">
                <button className="text-button" disabled={saving !== null || exercise.index === 0} aria-label={t(lang, "plan_move_up")} onClick={() => void edit(day.weekday, exercise.index, "move", undefined, exercise.name, { dir: "up" })}>↑ {t(lang, "plan_move_up")}</button>
                <button className="text-button" disabled={saving !== null || exercise.index === day.exercises.length - 1} aria-label={t(lang, "plan_move_down")} onClick={() => void edit(day.weekday, exercise.index, "move", undefined, exercise.name, { dir: "down" })}>↓ {t(lang, "plan_move_down")}</button>
                {canLink && <button className="text-button" disabled={saving !== null} onClick={() => void edit(day.weekday, exercise.index, "link", undefined, exercise.name)}>{exercise.ssGroup ? t(lang, "plan_unlink_btn") : t(lang, "plan_link_btn")}</button>}
                <button className="text-button danger-button" disabled={saving !== null} onClick={() => { if (day.exercises.length <= 1) { setActionError(new Error(t(lang, "plan_last_exercise"))); return; } if (window.confirm(t(lang, "plan_delete_confirm"))) void edit(day.weekday, exercise.index, "del", undefined, exercise.name); }}>{t(lang, "plan_delete_btn")}</button>
              </div>
            </div>
          </div>;
        })}
      </div>
      <div className="plan-add-row">
        <input value={newExercises[day.weekday] ?? ""} maxLength={80} placeholder={t(lang, "plan_add_ph")} onChange={(event) => setNewExercises((current) => ({ ...current, [day.weekday]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") void addExercise(day.weekday); }} />
        <button className="button button-primary" disabled={saving !== null || !(newExercises[day.weekday] ?? "").trim()} onClick={() => void addExercise(day.weekday)}>{saving === `${day.weekday}:-1:add` ? "…" : t(lang, "plan_add_btn")}</button>
      </div>
    </Card>)}
  </div>;
}
