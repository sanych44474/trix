// The dashboard the whole app renders from: its load, the offline copy and the wait for a plan being
// built. Moved out of App() unchanged; App keeps only what is about SCREENS.
import { useEffect, useState } from "react";
import { api } from "./api";
import type { Lang } from "./i18n";
import { registerLearnedMuscles } from "./logic/exerciseMuscles";
import type { Dashboard } from "./types";

/** The last dashboard, kept so the app opens instantly and works offline. Also read for the language. */
export const DASHBOARD_CACHE_KEY = "trix:v2:dashboard";

/** How often to re-check while the plan is being built after onboarding. */
const PLAN_POLL_MS = 4000;

// main.tsx starts the first dashboard request while the language chunk is still loading, instead
// of after the first render; the hook's first load() picks that request up.
let prefetched: Promise<Dashboard> | null = null;
export function prefetchDashboard(): void {
  prefetched = api<Dashboard>("/api/v2/dashboard");
  prefetched.catch(() => {}); // a failure surfaces when load() awaits it
}

export function useDashboard(setLang: (lang: Lang) => void) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [onboardingPending, setOnboardingPending] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    const request = prefetched ?? api<Dashboard>("/api/v2/dashboard");
    prefetched = null;
    request
      .then((data) => {
        registerLearnedMuscles(data.calendar?.learnedMuscles ?? []);
        setDashboard(data);
        setLang(data.lang);
        try { localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify(data)); } catch { /* cache is optional */ }
      })
      .catch(setError)
      .finally(() => setLoading(false));
  };

  // Show the cached dashboard at once, then refresh it.
  useEffect(() => {
    try {
      const cached = localStorage.getItem(DASHBOARD_CACHE_KEY);
      if (cached) {
        const data = JSON.parse(cached) as Dashboard;
        if (data?.viewer && data?.today) {
          registerLearnedMuscles(data.calendar?.learnedMuscles ?? []);
          setDashboard(data);
          setLang(data.lang);
          setLoading(false);
        }
      }
    } catch {
      try { localStorage.removeItem(DASHBOARD_CACHE_KEY); } catch { /* storage is optional */ }
    }
    load();
  }, []);

  // While the plan is being built, re-check every few seconds and switch over by itself.
  const waitingForPlan = !!dashboard && !dashboard.viewer.onboarded && (onboardingPending || !!dashboard.viewer.planPending);
  useEffect(() => {
    if (!waitingForPlan) return;
    const id = setInterval(() => {
      api<Dashboard>("/api/v2/dashboard")
        .then((data) => { if (data.viewer.onboarded) { setOnboardingPending(false); setDashboard(data); } })
        .catch(() => {});
    }, PLAN_POLL_MS);
    return () => clearInterval(id);
  }, [waitingForPlan]);

  return { dashboard, error, loading, onboardingPending, setOnboardingPending, load };
}
