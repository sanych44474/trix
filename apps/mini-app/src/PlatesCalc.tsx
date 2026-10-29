// Plate calculator: what to load per side for a target weight, plus a warm-up ramp. Opened from
// the Training screen (it used to sit on More).
import { useState } from "react";
import { api } from "./api";
import type { PlatesResponse } from "./types";
import { t, type Lang } from "./i18n";

export function PlatesTool({ lang }: { lang: Lang }) {
  const [platesKg, setPlatesKg] = useState("");
  const [plates, setPlates] = useState<PlatesResponse | null>(null);
  const [platesBusy, setPlatesBusy] = useState(false);
  const calcPlates = async () => {
    const kg = Number(platesKg);
    if (!Number.isFinite(kg) || kg <= 0) return;
    setPlatesBusy(true);
    try { setPlates(await api<PlatesResponse>(`/api/v2/plates?kg=${kg}`)); } catch { setPlates(null); } finally { setPlatesBusy(false); }
  };

  return <>
    <div className="input-row">
      <input type="number" inputMode="decimal" value={platesKg} placeholder={t(lang, "plates_kg_ph")} onChange={(event) => setPlatesKg(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void calcPlates(); }} />
      <button className="button button-ghost" onClick={() => void calcPlates()} disabled={platesBusy}>{platesBusy ? "…" : t(lang, "plates_calc_btn")}</button>
    </div>
    {plates && <div style={{ marginTop: 10 }}>
      {plates.plan ? <p className="muted"><strong>{plates.plan.loaded} {t(lang, "unit_kg")}</strong> · {t(lang, "plates_per_side")}: {plates.plan.perSide.length ? plates.plan.perSide.join(" + ") : "—"}{plates.plan.leftover ? ` · ${t(lang, "plates_leftover", { n: plates.plan.leftover })}` : ""}</p> : null}
      {plates.ramp.length > 0 && <><p className="muted" style={{ marginTop: 8 }}>{t(lang, "plates_warmup_title")}</p><ul className="factor-list">{plates.ramp.map((w, i) => <li key={i}>{w.weight} {t(lang, "unit_kg")} × {w.reps}{w.pct ? ` (${w.pct}%)` : ""}</li>)}</ul></>}
    </div>}
  </>;
}
