import { useMemo, useRef, useState } from "react";
import { api, ApiError, jsonBody } from "./api";
import type { Dashboard, WorkoutToday } from "./types";
import { t, type Key, type Lang } from "./i18n";

// ---- Small view-local UI primitives -- duplicated from App.tsx rather than imported, matching
// this app's convention of no cross-file context/helpers for small view-local concerns (see
// Workspace.tsx's own local Metric/Panel for the precedent) and avoiding a circular import with
// App.tsx (which itself imports ProgressView). ----

function Card({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "accent" | "muted" }) {
  return <section className={`card card-${tone}`}>{children}</section>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
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
async function uploadFile(path: string, form: FormData): Promise<{ ok: boolean }> {
  const requestHeaders = new Headers();
  const initData = window.Telegram?.WebApp?.initData ?? "";
  if (initData) requestHeaders.set("Authorization", `tma ${initData}`);
  requestHeaders.set("Accept", "application/json");
  const debugQuery = !initData && window.location.search ? window.location.search : "";
  const response = await fetch(`${path}${debugQuery}`, { method: "POST", headers: requestHeaders, body: form });
  let body: unknown = null;
  try { body = await response.json(); } catch { /* empty response */ }
  if (!response.ok) {
    const failure = body as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(failure?.error?.code ?? "dependency_unavailable", failure?.error?.message ?? "Request failed", response.status);
  }
  if (body && typeof body === "object" && "data" in body) return (body as { data: { ok: boolean } }).data;
  return body as { ok: boolean };
}

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
};

export function ProgressView({ dashboard, lang }: { dashboard: Dashboard; lang: Lang }) {
  const latest = dashboard.weight.points.at(-1); const first = dashboard.weight.points[0];
  const [measure, setMeasure] = useState(""); const [steps, setSteps] = useState(""); const [busy, setBusy] = useState<string | null>(null); const [notice, setNotice] = useState("");
  const [checkin, setCheckin] = useState({ energy: 3, sleep: 3, stress: 3 });
  const post = async (key: string, body: unknown) => { setBusy(key); setNotice(""); try { await api("/api/v2/log", { method: "POST", idempotencyKey: crypto.randomUUID(), body: jsonBody(body) }); setNotice(t(lang, "progress_saved_note")); if (key === "measure") setMeasure(""); if (key === "steps") setSteps(""); } catch (err) { setNotice(err instanceof ApiError ? t(lang, "generic_error") : t(lang, "generic_error")); } finally { setBusy(null); } };
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

  // ---- 12-week heatmap (GitHub-contribution-graph style) -- reuses the same 84-day calendar
  // window the dashboard already returns (dashboard.ts's CALENDAR_DAYS = 84 = 12 weeks); no new
  // fetch. Volume per day is the completed-set count from calendar.logs (already loaded). ----
  const setsByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const log of dashboard.calendar.logs) {
      if (!log.done) continue;
      m.set(log.date, log.ex.reduce((sum, e) => sum + e.s, 0));
    }
    return m;
  }, [dashboard.calendar.logs]);
  const maxSets = Math.max(1, ...dashboard.calendar.days.map((d) => setsByDate.get(d.date) ?? 0));
  const heatmapClass = (day: Dashboard["calendar"]["days"][number]) => {
    if (day.s === "missed") return "heatmap-cell missed";
    if (day.s !== "done") return "heatmap-cell";
    const sets = setsByDate.get(day.date) ?? 0;
    const level = sets <= 0 ? 0 : Math.min(4, Math.ceil((sets / maxSets) * 4));
    return level > 0 ? `heatmap-cell l${level}` : "heatmap-cell l1";
  };

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
  const macroTargets = dashboard.macros.targets;
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
  const uploadPhoto = async (file: File) => {
    setPhotoBusy(true); setPhotoNotice("");
    try {
      const form = new FormData();
      form.append("photo", file, file.name || "progress.jpg");
      await uploadFile("/api/v2/photo", form);
      setPhotoNotice(t(lang, "progress_photo_uploaded_note"));
    } catch {
      setPhotoNotice(t(lang, "generic_error"));
    } finally {
      setPhotoBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return <div className="view-stack">
    <div className="eyebrow">{t(lang, "progress_eyebrow")}</div>
    <div className="page-title"><h1>{t(lang, "progress_title")}</h1><span>{dashboard.today}</span></div>
    <div className="metric-grid">
      <Metric label={t(lang, "metric_current_weight")} value={latest ? `${formatNumber(latest.kg)} kg` : "—"} detail={dashboard.weight.goal ? t(lang, "goal_kg", { n: formatNumber(dashboard.weight.goal) }) : t(lang, "add_weighin")} />
      <Metric label={t(lang, "metric_recovery")} value={`${dashboard.recovery.score}`} detail={dashboard.recovery.label} />
      <Metric label={t(lang, "metric_conditioning")} value={t(lang, "min_value", { n: dashboard.conditioning.minutes })} detail={t(lang, "zone_load", { zone: dashboard.conditioning.zone })} />
    </div>

    <Card><div className="section-head"><div><span className="eyebrow">{t(lang, "weight_trend_eyebrow")}</span><h2>{dashboard.weight.projection?.reached ? t(lang, "goal_reached") : dashboard.weight.projection?.onTrack ? t(lang, "on_track") : t(lang, "keep_observing")}</h2></div></div>{dashboard.weight.points.length > 1 ? <div className="sparkline">{dashboard.weight.points.map((point, index) => <span key={point.date} style={{ left: `${(index / (dashboard.weight.points.length - 1)) * 100}%`, bottom: `${Math.max(4, Math.min(92, ((point.kg - (first?.kg ?? point.kg) + 5) / 10) * 100))}%` }} title={`${point.date}: ${point.kg} kg`} />)}</div> : <Empty title={t(lang, "build_baseline_title")} detail={t(lang, "build_baseline_detail")} />}</Card>

    <Card>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "activity_calendar_eyebrow")}</span><h2>{t(lang, "activity_calendar_title")}</h2></div><span className="tag">{dashboard.calendar.days.filter((day) => day.s === "done").length}</span></div>
      <div className="activity-grid">{dashboard.calendar.days.slice(-35).map((day) => <button type="button" className={`${markerClass(day.s)}${selectedDay === day.date ? " selected" : ""}`} key={day.date} title={`${day.date}: ${day.s}`} onClick={() => void openDay(day.date)}><span>{day.date.slice(-2)}</span></button>)}</div>
      <div className="activity-legend"><span><i className="legend-dot done" />{t(lang, "done_label")}</span><span><i className="legend-dot missed" />{t(lang, "missed_label")}</span><span><i className="legend-dot recovery" />{t(lang, "recovery_label")}</span></div>
      {selectedDay && <div className="day-detail">
        <div className="section-head"><strong>{selectedDay}</strong>{selectedStatus && <span className={`tag${selectedStatus === "missed" ? " status-attention" : ""}`}>{t(lang, selectedStatus === "done" ? "done_label" : selectedStatus === "missed" ? "missed_label" : "recovery_label")}</span>}</div>
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
          {selectedMacro ? <p className="muted">{t(lang, "macro_line", { p: formatNumber(selectedMacro.p), f: formatNumber(selectedMacro.f), c: formatNumber(selectedMacro.c) })} · {Math.round(selectedMacro.kcal)} kcal</p> : <p className="muted">{t(lang, "day_detail_no_macros")}</p>}
        </div>
        {(selectedWeight || selectedMeasurements.length > 0) && <div className="day-detail-row">
          <strong>{t(lang, "day_detail_measure_title")}</strong>
          <p className="muted">{[selectedWeight ? `${formatNumber(selectedWeight.kg)} kg` : null, ...selectedMeasurements.map((m) => `${t(lang, MEASURE_LABEL_KEY[m.key] ?? "day_detail_measure_title")} ${formatNumber(m.v)} cm`)].filter(Boolean).join(" · ")}</p>
        </div>}
      </div>}
    </Card>

    <Card>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "heatmap_eyebrow")}</span><h2>{t(lang, "heatmap_title")}</h2></div></div>
      <div className="heatmap">{dashboard.calendar.days.map((day) => <div className={heatmapClass(day)} key={day.date} title={`${day.date}${setsByDate.has(day.date) ? ` · ${setsByDate.get(day.date)} sets` : ` · ${day.s}`}`} />)}</div>
      <div className="heatmap-legend"><span>{t(lang, "heatmap_legend_less")}</span><div className="heatmap-cell" /><div className="heatmap-cell l1" /><div className="heatmap-cell l2" /><div className="heatmap-cell l3" /><div className="heatmap-cell l4" /><span>{t(lang, "heatmap_legend_more")}</span></div>
    </Card>

    <Card>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "strength_trend_eyebrow")}</span><h2>{t(lang, "strength_trend_title")}</h2></div></div>
      {!exercises.length ? <Empty title={t(lang, "strength_trend_title")} detail={t(lang, "strength_trend_empty")} /> : <>
        <div className="button-row"><label className="form-field" style={{ flex: 1 }}><span>{t(lang, "strength_pick_exercise_label")}</span><select value={activeExercise?.name ?? ""} onChange={(event) => setSelectedExercise(event.target.value)}>{exercises.map((e) => <option key={e.name} value={e.name}>{e.name} ({e.group})</option>)}</select></label></div>
        {activeExercise && <LineChart points={activeExercise.points.map((p) => ({ date: p.date, v: p.e1rm }))} color="var(--accent)" />}
      </>}
    </Card>

    <Card>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "measurements_eyebrow")}</span><h2>{t(lang, "measurements_title")}</h2></div></div>
      {!measurements.length ? <Empty title={t(lang, "measurements_title")} detail={t(lang, "measurements_empty")} /> : <>
        <div className="button-row"><label className="form-field" style={{ flex: 1 }}><span>{t(lang, "measurements_pick_key_label")}</span><select value={activeMeasurement?.key ?? ""} onChange={(event) => setSelectedMeasureKey(event.target.value)}>{measurements.map((m) => <option key={m.key} value={m.key}>{t(lang, MEASURE_LABEL_KEY[m.key] ?? "measurements_pick_key_label")}</option>)}</select></label></div>
        {activeMeasurement && <LineChart points={activeMeasurement.points} color="var(--good)" />}
      </>}
    </Card>

    <Card><div className="section-head"><div><span className="eyebrow">{t(lang, "quick_tracking_eyebrow")}</span><h2>{t(lang, "log_recovery_title")}</h2></div></div><div className="input-row"><input value={measure} placeholder={t(lang, "measure_ph")} onChange={(event) => setMeasure(event.target.value)} /><button className="button button-primary" disabled={!measure.trim() || busy === "measure"} onClick={() => void post("measure", { kind: "measure", text: measure.trim() })}>{busy === "measure" ? "…" : t(lang, "save_measure_btn")}</button></div><div className="button-row"><button className="button button-ghost" disabled={busy !== null} onClick={() => void post("water", { kind: "water", ml: 250 })}>+250 ml</button><button className="button button-ghost" disabled={busy !== null} onClick={() => void post("water", { kind: "water", ml: 500 })}>+500 ml</button><input className="compact-input" value={steps} inputMode="numeric" placeholder={t(lang, "steps_ph")} onChange={(event) => setSteps(event.target.value)} /><button className="button button-ghost" disabled={!steps || busy === "steps"} onClick={() => void post("steps", { kind: "steps", steps: Number(steps) })}>{t(lang, "save_steps_btn")}</button></div><div className="checkin-grid">{(["energy", "sleep", "stress"] as const).map((key) => <label className="form-field" key={key}><span>{t(lang, `${key}_label` as Parameters<typeof t>[1])}</span><select value={checkin[key]} onChange={(event) => setCheckin({ ...checkin, [key]: Number(event.target.value) })}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}/5</option>)}</select></label>)}</div><button className="button button-ghost button-wide" disabled={busy === "checkin"} onClick={() => void post("checkin", { kind: "checkin", ...checkin })}>{busy === "checkin" ? t(lang, "saving_ellipsis") : t(lang, "save_checkin_btn")}</button>{notice && <div className="save-note">{notice}</div>}</Card>

    <Card>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "macro_breakdown_eyebrow")}</span><h2>{t(lang, "macro_breakdown_title")}</h2></div></div>
      {!macroDonut || !todayMacro ? <Empty title={t(lang, "macro_breakdown_title")} detail={t(lang, "macro_breakdown_empty")} /> : <>
        <div className="macro-donut-row">
          <div className="ring" style={{ background: macroDonut.background }}><div><strong>{Math.round(todayMacro.kcal)}</strong><small>kcal</small></div></div>
          <div className="macro-donut-legend">
            <span><i style={{ background: "var(--good)" }} />{t(lang, "metric_protein")} · {formatNumber(todayMacro.p)} g</span>
            <span><i style={{ background: "var(--warn)" }} />{t(lang, "metric_fats")} · {formatNumber(todayMacro.f)} g</span>
            <span><i style={{ background: "var(--accent)" }} />{t(lang, "metric_carbs")} · {formatNumber(todayMacro.c)} g</span>
            {macroTargets && <span>{t(lang, "kcal_of_target", { n: Math.round(todayMacro.kcal), target: Math.round(macroTargets.calories) })}</span>}
          </div>
        </div>
      </>}
    </Card>

    <Card><div className="section-head"><div><span className="eyebrow">{t(lang, "macro_trend_eyebrow")}</span><h2>{t(lang, "macro_trend_title")}</h2></div></div>{dashboard.macros.days.length ? <div className="macro-history">{dashboard.macros.days.slice(-7).map((day) => <div className="macro-history-row" key={day.date}><span>{day.date.slice(5)}</span><div className="bar"><span style={{ width: `${dashboard.macros.targets ? Math.min(100, day.kcal / Math.max(1, dashboard.macros.targets.calories) * 100) : 0}%` }} /></div><strong>{Math.round(day.kcal)} kcal</strong></div>)}</div> : <p className="muted">{t(lang, "macro_empty")}</p>}</Card>

    <Card>
      <div className="section-head"><div><span className="eyebrow">{t(lang, "progress_photo_upload_eyebrow")}</span><h2>{t(lang, "progress_photo_upload_title")}</h2></div></div>
      <p className="muted">{t(lang, "progress_photo_upload_hint")}</p>
      <div className="input-row"><input ref={fileInputRef} type="file" accept="image/*" capture="environment" disabled={photoBusy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadPhoto(file); }} /></div>
      {photoBusy && <p className="muted">{t(lang, "saving_ellipsis")}</p>}
      {photoNotice && <div className="save-note">{photoNotice}</div>}
    </Card>

    <Card><div className="section-head"><div><span className="eyebrow">{t(lang, "weekly_volume_eyebrow")}</span><h2>{t(lang, "strength_load_title")}</h2></div><button className="text-button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>{t(lang, "top_btn")}</button></div>{dashboard.volume.length ? <div className="volume-list">{dashboard.volume.map((item) => <div className="volume-row" key={item.group}><div><strong>{item.group}</strong><small>{t(lang, "volume_row_detail", { n: item.sets, zone: item.zone })}</small></div><div className="bar"><span style={{ width: `${Math.min(100, (item.sets / Math.max(item.mav, 1)) * 100)}%` }} /></div></div>)}</div> : <Empty title={t(lang, "no_volume_title")} detail={t(lang, "no_volume_detail")} />}</Card>
  </div>;
}
