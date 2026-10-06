// Bring workout history over from Strong or Hevy: pick the CSV export, the server writes every
// date that has no log yet (never overwrites one) and says how many came in.
import { useRef, useState } from "react";
import { apiForm } from "../api";
import { t, type Lang } from "../i18n";
import { track } from "../logic/track";

type Result = { ok: boolean; reason?: "too_big" | "wrong_format" | "failed"; imported?: number; skipped?: number; capped?: boolean; cap?: number };

export function ImportCsv({ lang }: { lang: Lang }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const send = async (file: File) => {
    setBusy(true); setNote(null);
    try {
      const form = new FormData();
      form.append("file", file, file.name || "export.csv");
      const r = await apiForm<Result>("/api/v2/media/import-csv", form);
      if (r.ok) {
        setNote(t(lang, r.capped ? "import_app_done_capped" : "import_app_done", { imported: r.imported ?? 0, skipped: r.skipped ?? 0, cap: r.cap ?? 200 }));
        track("app_csv_import");
      } else setNote(t(lang, `import_app_${r.reason ?? "failed"}`));
    } catch { setNote(t(lang, "generic_error")); } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return <div className="form-check">
    <p className="muted">{t(lang, "import_app_detail")}</p>
    <input ref={input} type="file" accept=".csv,text/csv,text/comma-separated-values" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void send(f); }} />
    <button type="button" className="button button-ghost" disabled={busy} onClick={() => input.current?.click()}>{busy ? t(lang, "saving_ellipsis") : t(lang, "import_app_btn")}</button>
    {note && <div className="save-note">{note}</div>}
  </div>;
}
