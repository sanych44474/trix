// The evening checklist on Today: what is still unlogged today (food, water, steps, check-in), each
// one a link to the screen that logs it. The bot's 21:00 survey is the same list (GET /api/v2/survey).
// Renders nothing once the day is complete or when the list cannot be loaded.
import { useEffect, useState } from "react";
import { api } from "./api";
import { t, type Lang } from "./i18n";
import type { View } from "./logic/navigation";
import { Card } from "./train/ui";
import type { Dashboard } from "./types";

type SurveyKey = "food" | "water" | "steps" | "checkin";
type Survey = { date: string; items: Array<{ key: SurveyKey; label: string }> };

export function EveningChecklistCard({ lang, dashboard, onOpen, onWaterSteps }: { lang: Lang; dashboard: Dashboard; onOpen: (view: View) => void; onWaterSteps: () => void }) {
  const [survey, setSurvey] = useState<Survey | null>(null);
  // Re-read whenever the dashboard reloads, which happens after every log on Today.
  useEffect(() => {
    api<Survey>("/api/v2/survey").then(setSurvey).catch(() => setSurvey(null));
  }, [dashboard]);

  if (!survey || survey.items.length === 0) return null;
  // Water and steps are logged in the Today card below; food and check-in live on their own screens.
  const go = (key: SurveyKey) => {
    if (key === "water" || key === "steps") onWaterSteps();
    else onOpen(key === "food" ? "fuel" : "progress");
  };

  return <Card>
    <h2 className="card-title">{t(lang, "evening_checklist_title")}</h2>
    <p className="muted">{t(lang, "evening_checklist_hint", { n: survey.items.length })}</p>
    <div className="list">
      {survey.items.map((item) => <button type="button" className="list-item" key={item.key} onClick={() => go(item.key)}>
        <span className="grow">{item.label}</span>
        <span className="row-value">{t(lang, "evening_checklist_open")}</span>
      </button>)}
    </div>
  </Card>;
}
