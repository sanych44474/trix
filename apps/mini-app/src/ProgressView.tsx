import { recentExerciseNames } from "./logic/bodyMap";
import { StravaCard } from "./StravaCard";
import { WeightChart } from "./WeightChart";
import { PhotoPair } from "./PhotoPair";
import { targetsForDay } from "./logic/dayTargets";
import { useRef, useState, lazy, Suspense } from "react";
import { api, ApiError, apiForm, jsonBody } from "./api";
import type { Dashboard, MuscleGroup, VolumeZone, WorkoutToday } from "./types";
import { t, type Key, type Lang } from "./i18n";
import { track } from "./logic/track";
import { todayPlan } from "./logic/todayPlan";
import { Icon } from "./icons";

// The body-map figure is ~35 kB of SVG paths; loaded only when the Progress screen is opened.
const BodyMap = lazy(() => import("./BodyMap").then((m) => ({ default: m.BodyMap })));
const MuscleTrend = lazy(() => import("./MuscleTrend").then((m) => ({ default: m.MuscleTrend })));

// dashboard.volume/conditioning send stable codes (src/domain/analysis.ts), never prose -- the
// raw group/zone strings were being interpolated straight into an otherwise-localized sentence
// ("19 підходів · optimal"), which is why the weekly-volume card mixed languages.
const muscleGroupLabel = (lang: Lang, group: MuscleGroup) => t(lang, `mg_${group}` as Key);
const zoneLabel = (lang: Lang, zone: VolumeZone) => t(lang, `zone_${zone}` as Key);

// ---- Small view-local UI primitives -- duplicated from App.tsx rather than imported, matching
// this app's convention of no cross-file context/helpers for small view-local concerns (see
// Workspace.tsx's own local Metric/Panel for the precedent) and avoiding a circular import with
// App.tsx (which itself imports ProgressView). ----

function Card({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "accent" | "muted" }) {
  return <section className={`card card-${tone}`}>{children}</section>;
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="empty"><span className="empty-mark">—</span><strong>{title}</strong><small>{detail}</small></div>;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
}

/** YYYY-MM-DD that is `n` days before `date` -- client-side mirror of the backend's
 * isoDaysBefore (src/webapp/dashboard.ts), needed to know which calendar days still fall inside
 * /api/v2/workout/today's 14-day edit window (see workoutApi.ts's validateEditDate). */
function isoDaysBefore(date: string, n: number): string {
  const time = Date.parse(`${date}T00:00:00Z`) - n * 86_400_000;
  return new Date(time).toISOString().slice(0, 10);
}

/** Same "webview can't send auth headers to an <img>/needs a debug-query fallback outside real
 * Telegram" upload helper as App.tsx's apiUpload -- duplicated for the same reason as the UI
 * primitives above (no cross-file helpers for one call site's concern). */

/** Small hand-rolled SVG line chart -- no charting library in this app's dependencies (see
 * package.json), and a handful of sparkline-scale series don't justify adding one. */
function LineChart({ points, color = "var(--accent)" }: { points: { date: string; v: number }[]; color?: string }) {
  if (points.length < 2) return null;
  const w = 300;
  const h = 92;
  const pad = 8;
  const values = points.map((p) => p.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = (w - pad * 2) / (points.length - 1);
  const coords = points.map((p, i) => ({
    x: pad + i * stepX,
    y: h - pad - ((p.v - min) / span) * (h - pad * 2),
    p,
  }));
  return <svg viewBox={`0 0 ${w} ${h}`} className="line-chart" preserveAspectRatio="none" role="img">
    <polyline points={coords.map((c) => `${c.x},${c.y}`).join(" ")} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    {coords.map((c) => <circle key={c.p.date} cx={c.x} cy={c.y} r="3" fill={color}><title>{`${c.p.date}: ${formatNumber(c.p.v)}`}</title></circle>)}
  </svg>;
}

const MEASURE_LABEL_KEY: Record<string, Key> = {
  waist: "measure_key_waist",
  chest: "measure_key_chest",
  hips: "measure_key_hips",
  arm: "measure_key_arm",
  thigh: "measure_key_thigh",
  neck: "measure_key_neck",
};

export function ProgressView({ dashboard, lang }: { dashboard: Dashboard; lang: Lang }) {
  const latest = [...dashboard.weight.points].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  const [weightPeriod, setWeightPeriod] = useState<7 | 30 | 90>(30);
  const [section, setSection] = useState<"train" | "body" | "food">("train");
  const [measure, setMeasure] = useState(""); const [busy, setBusy] = useState<string | null>(null); const [notice, setNotice] = useState("");
  const [checkin, setCheckin] = useState({ energy: 3, sleep: 3, stress: 3 });
  const post = async (key: string, body: unknown) => { setBusy(key); setNotice(""); try { await api("/api/v2/log", { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody(body) }); setNotice(t(lang, "progress_saved_note")); if (key === "measure") setMeasure(""); } catch (err) { setNotice(err instanceof ApiError ? t(lang, "generic_error") : t(lang, "generic_error")); } finally { setBusy(null); } };
  const markerClass = (status: string) => status === "done" ? "activity-cell done" : status === "missed" ? "activity-cell missed" : "activity-cell recovery";

  // ---- Calendar with per-day detail (tap a recent day to expand it) ----
  const today = dashboard.today;
  const fetchFloor = isoDaysBefore(today, 14); // matches /api/v2/workout/today's own edit-window cap
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayDetail, setDayDetail] = useState<WorkoutToday | null>(null);
  const [dayDetailBusy, setDayDetailBusy] = useState(false);
  const [dayDetailError, setDayDetailError] = useState<unknown>(null);
  const macroForDate = (date: string) => dashboard.macros.days.find((d) => d.date === date);
  const weightForDate = (date: string) => dashboard.weight.points.find((p) => p.date === date);
  const measurementsForDate = (date: string) => (dashboard.measurements ?? []).flatMap((m) => m.points.filter((p) => p.date === date).map((p) => ({ key: m.key, v: p.v })));
  const openDay = async (date: string) => {
    if (selectedDay === date) { setSelectedDay(null); return; }
    setSelectedDay(date); setDayDetail(null); setDayDetailError(null);
    if (date < fetchFloor || date > today) return; // outside the workout-detail endpoint's window -- local data only
    setDayDetailBusy(true);
    try { setDayDetail(await api<WorkoutToday>(`/api/v2/workout/today?date=${date}`)); } catch (err) { setDayDetailError(err); } finally { setDayDetailBusy(false); }
  };
  const selectedStatus = selectedDay ? dashboard.calendar.days.find((d) => d.date === selectedDay)?.s : undefined;
  const selectedMacro = selectedDay ? macroForDate(selectedDay) : undefined;
  const selectedWeight = selectedDay ? weightForDate(selectedDay) : undefined;
  const selectedMeasurements = selectedDay ? measurementsForDate(selectedDay) : [];

  // ---- Measurement + e1RM strength trend charts (already computed server-side --
  // dashboard.ts's assemblePayload -- just not surfaced in the client until now) ----
  const exercises = dashboard.exercises ?? [];
  const [selectedExercise, setSelectedExercise] = useState<string>(() => exercises[0]?.name ?? "");
  const activeExercise = exercises.find((e) => e.name === selectedExercise) ?? exercises[0];
  const measurements = dashboard.measurements ?? [];
  const [selectedMeasureKey, setSelectedMeasureKey] = useState<string>(() => measurements[0]?.key ?? "");
  const activeMeasurement = measurements.find((m) => m.key === selectedMeasureKey) ?? measurements[0];

  // ---- Today's macro breakdown (donut, same conic-gradient technique TodayView's activity
  // rings already use) -- data already on the dashboard prop, no fetch needed. ----
  const todayMacro = dashboard.macros.days.at(-1);
  const dayTargets = (training: boolean) => targetsForDay(training, dashboard.macros.targets, dashboard.macros.restTargets);
  const todayTargets = todayMacro ? dayTargets(todayMacro.training) : { targets: dashboard.macros.targets, rest: false };
  const macroTargets = todayTargets.targets;
  const macroDonut = todayMacro && (todayMacro.p || todayMacro.f || todayMacro.c) ? (() => {
    const pCal = todayMacro.p * 4, fCal = todayMacro.f * 9, cCal = todayMacro.c * 4;
    const total = pCal + fCal + cCal || 1;
    const pPct = (pCal / total) * 100;
    const fPct = (fCal / total) * 100;
    const seg2 = pPct + fPct;
    return { pPct, fPct, cPct: 100 - seg2, background: `conic-gradient(var(--good) 0 ${pPct}%, var(--warn) ${pPct}% ${seg2}%, var(--accent) ${seg2}% 100%)` };
  })() : null;

  // ---- Progress photo upload -- reuses the /api/v2/photo POST route (mirrors the existing
  // weekcard/photocompare "push bytes to Telegram, store the resulting file_id" pattern). ----
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoNotice, setPhotoNotice] = useState("");
  const [photoReload, setPhotoReload] = useState(0);
  const uploadPhoto = async (file: File) => {
    setPhotoBusy(true); setPhotoNotice("");
    try {
      const form = new FormData();
      form.append("photo", file, file.name || "progress.jpg");
      await apiForm<{ ok: boolean }>("/api/v2/photo", form);
      setPhotoNotice(t(lang, "progress_photo_uploaded_note"));
      setPhotoReload((n) => n + 1);
    } catch {
      setPhotoNotice(t(lang, "generic_error"));
    } finally {
      setPhotoBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // The week first: workouts against the plan, the weight change over the last 7 days, sets logged.
  const week = todayPlan({ today: dashboard.today, planExercises: [], plannedWeekdays: dashboard.calendar.split.map((d) => d.weekday), days: dashboard.calendar.days, logs: dashboard.calendar.logs, draft: null });
  const monday = week.week[0].date;
  const weekSets = dashboard.calendar.logs.filter((log) => log.done && log.date >= monday).reduce((n, log) => n + log.ex.reduce((m, e) => m + e.s, 0), 0);
  const sortedWeights = [...dashboard.weight.points].sort((a, b) => a.date.localeCompare(b.date));
  const weekAgo = new Date(Date.parse(`${dashboard.today}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
  const before = [...sortedWeights].reverse().find((p) => p.date <= weekAgo);
  // Only a real 7-day change: the latest weigh-in inside this week, compared with one from the
  // week before (not a month-old one labelled as 7 days).
  const twoWeeksAgo = new Date(Date.parse(`${dashboard.today}T00:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10);
  const weightDelta = latest && before && before !== latest && latest.date > weekAgo && before.date > twoWeeksAgo ? Math.round((latest.kg - before.kg) * 10) / 10 : null;
  const periodFrom = new Date(Date.parse(`${dashboard.today}T00:00:00Z`) - (weightPeriod - 1) * 86_400_000).toISOString().slice(0, 10);
  const periodPoints = dashboard.weight.points.filter((p) => p.date >= periodFrom);

  const kg = t(lang, "unit_kg");
  const dayLabel = (iso: string) => new Intl.DateTimeFormat(lang === "uk" ? "uk-UA" : "en-GB", { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${iso}T12:00:00`));
  const hasLogs = (dashboard.calendar.logs ?? []).some((log) => log.done);

  return <div className="view-stack">
    <div className="page-title"><h1>{t(lang, "progress_title")}</h1></div>
    <section className="summary-stats progress-week" aria-label={t(lang, "week_title")}>
      <div><strong className="num">{week.weekDone}/{week.weekPlanned}</strong><small>{t(lang, "pw_workouts")}</small></div>
      <div><strong className="num">{latest ? `${formatNumber(latest.kg)}` : "—"}</strong><small>{weightDelta === null ? t(lang, "pw_weight") : t(lang, "pw_weight_delta", { d: `${weightDelta > 0 ? "+" : weightDelta < 0 ? "−" : "±"}${formatNumber(Math.abs(weightDelta))}` })}</small></div>
      <div><strong className="num">{weekSets}</strong><small>{t(lang, "pw_sets")}</small></div>
    </section>
    <div className="segmented three" role="tablist" aria-label={t(lang, "progress_title")}>
      {(["train", "body", "food"] as const).map((key) => <button key={key} type="button" role="tab" aria-selected={section === key} onClick={() => { setSection(key); track(`app_progress_${key}`); }}>{t(lang, key === "train" ? "progress_tab_train" : key === "body" ? "progress_tab_body" : "progress_tab_food")}</button>)}
    </div>

    {section === "train" && <>
      <Card><h2 className="card-title">{t(lang, "muscle_map_title")}</h2>{dashboard.volume.length ? <><Suspense fallback={<div className="skeleton" />}><BodyMap lang={lang} logs={dashboard.calendar.logs ?? []} today={dashboard.today} sex={dashboard.sex} exercises={recentExerciseNames(dashboard.calendar.logs ?? [])} /></Suspense><div className="volume-list">{dashboard.volume.map((item) => <div className="volume-row" key={item.group}><div><strong>{muscleGroupLabel(lang, item.group)}</strong><small>{t(lang, "volume_row_detail", { n: lang === "uk" ? String(item.sets).replace(".", ",") : item.sets, zone: zoneLabel(lang, item.zone) })}</small></div><div className="bar"><span style={{ width: `${Math.min(100, (item.sets / Math.max(item.mav, 1)) * 100)}%` }} /></div></div>)}</div></> : <Empty title={t(lang, "no_volume_title")} detail={t(lang, "no_volume_detail")} />}</Card>

      <Card>
        <div className="row-between"><h2 className="card-title">{t(lang, "activity_calendar_title")}</h2><span className="muted num">{t(lang, "calendar_done_count", { n: dashboard.calendar.days.filter((day) => day.s === "done").length })}</span></div>
        <div className="activity-grid">{dashboard.calendar.days.slice(-35).map((day) => <button type="button" className={`${markerClass(day.s)}${selectedDay === day.date ? " selected" : ""}${day.date === today ? " today" : ""}`} key={day.date} aria-label={`${dayLabel(day.date)}: ${t(lang, day.s === "done" ? "done_label" : day.s === "missed" ? "missed_label" : "recovery_label")}`} onClick={() => void openDay(day.date)}><span>{Number(day.date.slice(-2))}</span></button>)}</div>
        <div className="activity-legend"><span><i className="legend-dot done" />{t(lang, "done_label")}</span><span><i className="legend-dot missed" />{t(lang, "missed_label")}</span></div>
        {selectedDay && <div className="day-detail">
          <div className="section-head"><strong>{dayLabel(selectedDay)}</strong>{selectedStatus && <span className={`pill ${selectedStatus === "done" ? "pill-good" : selectedStatus === "missed" ? "pill-bad" : ""}`}>{t(lang, selectedStatus === "done" ? "done_label" : selectedStatus === "missed" ? "missed_label" : "recovery_label")}</span>}</div>
          <div className="day-detail-row">
            <strong>{t(lang, "day_detail_workout_title")}</strong>
            {selectedDay < fetchFloor ? <p className="muted">{t(lang, "day_detail_unavailable")}</p>
              : dayDetailBusy ? <p className="muted">{t(lang, "saving_ellipsis")}</p>
              : dayDetailError !== null ? <p className="muted">{t(lang, "generic_error")}</p>
              : dayDetail?.saved?.length ? <ul className="factor-list">{dayDetail.saved.map((s) => <li key={s.name}>{s.name} · {s.sets.length}×</li>)}</ul>
              : <p className="muted">{t(lang, "day_detail_no_log")}</p>}
          </div>
          <div className="day-detail-row">
            <strong>{t(lang, "day_detail_macros_title")}</strong>
            {selectedMacro ? <p className="muted">{t(lang, "macro_line", { p: formatNumber(selectedMacro.p), f: formatNumber(selectedMacro.f), c: formatNumber(selectedMacro.c) })} · {Math.round(selectedMacro.kcal)} {t(lang, "kcal_unit")}</p> : <p className="muted">{t(lang, "day_detail_no_macros")}</p>}
          </div>
          {(selectedWeight || selectedMeasurements.length > 0) && <div className="day-detail-row">
            <strong>{t(lang, "day_detail_measure_title")}</strong>
            <p className="muted">{[selectedWeight ? `${formatNumber(selectedWeight.kg)} ${kg}` : null, ...selectedMeasurements.map((m) => `${t(lang, MEASURE_LABEL_KEY[m.key] ?? "day_detail_measure_title")} ${formatNumber(m.v)} ${t(lang, "unit_cm")}`)].filter(Boolean).join(" · ")}</p>
          </div>}
        </div>}
      </Card>

      <Card>
        <h2 className="card-title">{t(lang, "strength_trend_title")}</h2>
        {!exercises.length ? <p className="muted">{t(lang, "strength_trend_empty")}</p> : <>
          <label className="form-field"><span>{t(lang, "strength_pick_exercise_label")}</span><select value={activeExercise?.name ?? ""} onChange={(event) => setSelectedExercise(event.target.value)}>{exercises.map((e) => <option key={e.name} value={e.name}>{e.name}</option>)}</select></label>
          {activeExercise && <LineChart points={activeExercise.points.map((p) => ({ date: p.date, v: p.e1rm }))} color="var(--accent)" />}
          {activeExercise && activeExercise.points.length > 0 && <p className="muted num">{t(lang, "strength_latest", { n: formatNumber(activeExercise.points.at(-1)!.e1rm), unit: kg })}</p>}
        </>}
      </Card>

      {hasLogs && <Card><h2 className="card-title">{t(lang, "trend_title")}</h2><Suspense fallback={<div className="skeleton" />}><MuscleTrend lang={lang} logs={dashboard.calendar.logs ?? []} today={dashboard.today} /></Suspense></Card>}
      <StravaCard lang={lang} />
    </>}

    {section === "body" && <>
      <Card><div className="row-between"><h2 className="card-title">{t(lang, "weight_trend_eyebrow_plain")}</h2><span className="muted">{dashboard.weight.projection?.reached ? t(lang, "goal_reached") : dashboard.weight.projection?.onTrack ? t(lang, "on_track") : ""}</span></div>
        <div className="segmented three period" role="tablist">{([7, 30, 90] as const).map((d) => <button key={d} type="button" role="tab" aria-selected={weightPeriod === d} onClick={() => setWeightPeriod(d)}>{t(lang, d === 7 ? "period_week" : d === 30 ? "period_month" : "period_3m")}</button>)}</div>
        {periodPoints.length > 1 ? <WeightChart lang={lang} points={periodPoints} goal={dashboard.weight.goal} slopePerWeek={dashboard.weight.projection?.slopePerWeek} /> : <p className="muted">{t(lang, "build_baseline_detail")}</p>}
        {dashboard.bodyFat && <p className="muted num">{t(lang, "metric_body_fat")}: {formatNumber(dashboard.bodyFat.pct)}%</p>}
      </Card>

      {measurements.length > 0 && <Card>
        <h2 className="card-title">{t(lang, "measurements_title")}</h2>
        <label className="form-field"><span>{t(lang, "measurements_pick_key_label")}</span><select value={activeMeasurement?.key ?? ""} onChange={(event) => setSelectedMeasureKey(event.target.value)}>{measurements.map((m) => <option key={m.key} value={m.key}>{t(lang, MEASURE_LABEL_KEY[m.key] ?? "measurements_pick_key_label")}</option>)}</select></label>
        {activeMeasurement && <LineChart points={activeMeasurement.points} color="var(--good)" />}
      </Card>}

      <Card>
        <h2 className="card-title">{t(lang, "log_today_title")}</h2>
        <label className="form-field"><span>{t(lang, "qt_body_label")}</span>
          <div className="input-row"><input value={measure} placeholder={t(lang, "measure_ph")} onChange={(event) => setMeasure(event.target.value)} /><button className="button button-primary" disabled={!measure.trim() || busy === "measure"} onClick={() => void post("measure", { kind: "measure", text: measure.trim() })}>{busy === "measure" ? "…" : t(lang, "save_measure_btn")}</button></div>
        </label>
        <div className="qt-sub"><strong>{t(lang, "qt_checkin_label")}</strong><small>{t(lang, "qt_checkin_hint")}</small></div>
        <div className="checkin-grid">{(["energy", "sleep", "stress"] as const).map((key) => <label className="form-field" key={key}><span>{t(lang, `${key}_label` as Parameters<typeof t>[1])}</span><select value={checkin[key]} onChange={(event) => setCheckin({ ...checkin, [key]: Number(event.target.value) })}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}/5</option>)}</select></label>)}</div>
        <button className="button button-secondary button-block" disabled={busy === "checkin"} onClick={() => void post("checkin", { kind: "checkin", ...checkin })}>{busy === "checkin" ? t(lang, "saving_ellipsis") : t(lang, "save_checkin_btn")}</button>
        {notice && <div className="save-note">{notice}</div>}
      </Card>

      <Card>
        <h2 className="card-title">{t(lang, "progress_photo_upload_title")}</h2>
        <PhotoPair lang={lang} weights={dashboard.weight.points} reloadKey={photoReload} />
        <p className="muted">{t(lang, "progress_photo_upload_hint")}</p>
        <input ref={fileInputRef} type="file" accept="image/*" capture="environment" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadPhoto(file); }} />
        <button type="button" className="button button-secondary button-block" disabled={photoBusy} onClick={() => fileInputRef.current?.click()}><Icon name="camera" size={20} />{photoBusy ? t(lang, "saving_ellipsis") : t(lang, "progress_photo_upload_btn")}</button>
        {photoNotice && <div className="save-note">{photoNotice}</div>}
      </Card>
    </>}

    {section === "food" && <>
      <Card>
        <h2 className="card-title">{t(lang, "macro_breakdown_title")}</h2>
        {!macroDonut || !todayMacro ? <p className="muted">{t(lang, "macro_breakdown_empty")}</p> : <div className="macro-donut-row">
            <div className="ring" style={{ background: macroDonut.background }}><div><strong>{Math.round(todayMacro.kcal)}</strong><small>{t(lang, "kcal_unit")}</small></div></div>
            <div className="macro-donut-legend">
              <span><i style={{ background: "var(--good)" }} />{t(lang, "metric_protein")} · {formatNumber(todayMacro.p)} {t(lang, "unit_g")}</span>
              <span><i style={{ background: "var(--warn)" }} />{t(lang, "metric_fats")} · {formatNumber(todayMacro.f)} {t(lang, "unit_g")}</span>
              <span><i style={{ background: "var(--accent)" }} />{t(lang, "metric_carbs")} · {formatNumber(todayMacro.c)} {t(lang, "unit_g")}</span>
              {macroTargets && <span>{t(lang, "kcal_of_target", { n: Math.round(todayMacro.kcal), target: Math.round(macroTargets.calories) })}{todayTargets.rest ? ` · ${t(lang, "fuel_rest_day_badge")}` : ""}</span>}
            </div>
          </div>}
      </Card>
      <Card><h2 className="card-title">{t(lang, "macro_trend_title")}</h2>{dashboard.macros.days.length ? <div className="macro-history">{dashboard.macros.days.slice(-7).map((day) => <div className="macro-history-row" key={day.date}><span>{dayLabel(day.date)}</span><div className="bar"><span style={{ width: `${(() => { const tg = dayTargets(day.training).targets; return tg ? Math.min(100, day.kcal / Math.max(1, tg.calories) * 100) : 0; })()}%` }} /></div><strong className="num">{Math.round(day.kcal)} {t(lang, "kcal_unit")}</strong></div>)}</div> : <p className="muted">{t(lang, "macro_empty")}</p>}</Card>
    </>}
  </div>;
}
