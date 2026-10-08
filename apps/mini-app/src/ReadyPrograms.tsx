// Ready programs: 45 plans (gym, dumbbells at home, no equipment) for men, women or everyone,
// each at three loads. Filter, open one to see its days, apply it to yourself -- the server adapts
// it to your body, records and training days and makes it your active plan.
import { useEffect, useMemo, useState } from "react";
import { api, ApiError, typedBody } from "./api";
import { t, type Lang } from "./i18n";
import { track } from "./logic/track";
import type { ReadyProgram } from "./types";

type Place = ReadyProgram["place"];
type Level = ReadyProgram["level"];
type Audience = "men" | "women" | "any";

const PLACES: Place[] = ["gym", "dumbbells", "bodyweight"];
const LEVELS: Level[] = ["beginner", "intermediate", "advanced"];

export function ReadyPrograms({ lang, onApplied }: { lang: Lang; onApplied?: () => void }) {
  const [data, setData] = useState<{ role: string; programs: ReadyProgram[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [place, setPlace] = useState<Place>("gym");
  const [level, setLevel] = useState<Level | "any">("any");
  const [audience, setAudience] = useState<Audience>("any");
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => { api<{ role: string; programs: ReadyProgram[] }>("/api/v2/programs").then(setData).catch(() => setFailed(true)); }, []);

  const shown = useMemo(() => (data?.programs ?? []).filter((p) =>
    p.place === place && (level === "any" || p.level === level) && (audience === "any" || p.audience === audience || p.audience === "all")), [data, place, level, audience]);

  const apply = async (p: ReadyProgram) => {
    setBusy(true); setNote(null);
    try {
      await api("/api/v2/programs", { method: "POST", idempotencyKey: crypto.randomUUID(), body: typedBody<"applyReadyProgram">({ id: p.id }) });
      setNote(t(lang, "rp_applied", { name: p.name }));
      setConfirm(null);
      track("app_program_applied");
      onApplied?.();
    } catch (err) {
      setNote(t(lang, err instanceof ApiError && err.status === 403 ? "rp_trainer_managed" : "generic_error"));
    } finally { setBusy(false); }
  };

  if (failed) return <p className="muted">{t(lang, "generic_error")}</p>;
  if (!data) return <div className="skeleton" />;
  const client = data.role === "client";

  return <div className="ready-programs">
    <div className="button-row tabs">{PLACES.map((p) => <button key={p} type="button" className={`rest-chip${place === p ? " selected" : ""}`} onClick={() => { setPlace(p); setOpen(null); }}>{t(lang, `rp_place_${p}`)}</button>)}</div>
    <div className="button-row">
      {(["any", "women", "men"] as Audience[]).map((a) => <button key={a} type="button" className={`rest-chip${audience === a ? " selected" : ""}`} onClick={() => setAudience(a)}>{t(lang, `rp_aud_${a}`)}</button>)}
    </div>
    <div className="button-row">
      {(["any", ...LEVELS] as Array<Level | "any">).map((l) => <button key={l} type="button" className={`rest-chip${level === l ? " selected" : ""}`} onClick={() => setLevel(l)}>{t(lang, `rp_level_${l}`)}</button>)}
    </div>
    {client && <p className="muted">{t(lang, "rp_trainer_managed")}</p>}
    <div className="plan-list">
      {shown.map((p) => <div className="rp-item" key={p.id}>
        <button type="button" className="rp-head" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}>
          <span><strong>{p.name}</strong><small>{t(lang, "rp_meta", { days: p.daysPerWeek, min: p.minutes })} · {t(lang, `rp_aud_${p.audience === "all" ? "any" : p.audience}`)}</small></span>
          <span className="tag">{t(lang, `rp_level_${p.level}`)}</span>
        </button>
        {open === p.id && <div className="rp-body">
          <p className="muted">{p.summary}</p>
          {p.days.map((d, i) => <div className="rp-day" key={i}>
            <strong>{t(lang, "rp_day_n", { n: i + 1 })} · {d.title}</strong>
            <ul className="factor-list">{d.exercises.map((e, j) => <li key={j}>{e.name} — {e.sets}</li>)}</ul>
          </div>)}
          {!client && <div className="button-row">
            {confirm === p.id
              ? <><button type="button" className="button button-primary" disabled={busy} onClick={() => void apply(p)}>{busy ? "…" : t(lang, "rp_apply_confirm")}</button><button type="button" className="button button-ghost" disabled={busy} onClick={() => setConfirm(null)}>{t(lang, "close")}</button></>
              : <button type="button" className="button button-primary" onClick={() => setConfirm(p.id)}>{t(lang, "rp_apply_btn")}</button>}
          </div>}
          {confirm === p.id && <small className="muted">{t(lang, "rp_apply_hint")}</small>}
        </div>}
      </div>)}
    </div>
    {note && <div className="save-note">{note}</div>}
  </div>;
}
