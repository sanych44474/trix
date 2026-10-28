import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { AuthGate } from "./AuthGate";
import { loadLang, type Lang } from "./i18n";
import { App } from "./App";
import { AUTH_ACCOUNT_KEY, clearAccountCache } from "./logic/accountCache";

type AuthSession = { authenticated: boolean; accountId?: number; method?: "email" | "google" | "telegram" | "debug"; email?: string | null; googleLinked?: boolean };

function alignLocalAccount(accountId: number, method: string): void {
  try {
    const previous = localStorage.getItem(AUTH_ACCOUNT_KEY);
    const next = String(accountId);
    if (previous !== next && (previous !== null || method === "email")) clearAccountCache(localStorage, sessionStorage);
    localStorage.setItem(AUTH_ACCOUNT_KEY, next);
  } catch { /* local cache is optional */ }
}

export function AuthShell({ initialLang }: { initialLang: Lang }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const setLang = (next: Lang) => {
    void loadLang(next).catch(() => {}).finally(() => setLangState(next));
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const current = await api<AuthSession>("/api/v2/auth/session", { credentials: "same-origin" });
      if (current.authenticated && typeof current.accountId === "number") alignLocalAccount(current.accountId, current.method ?? "email");
      setSession(current);
    } catch { setSession({ authenticated: false }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const onAuthChanged = () => { void refresh(); };
    window.addEventListener("trix:auth-changed", onAuthChanged);
    return () => window.removeEventListener("trix:auth-changed", onAuthChanged);
  }, [refresh]);

  if (loading || session === null) return <main className="auth-screen"><div className="auth-panel"><div className="auth-mark">T</div><div className="skeleton" /></div></main>;
  if (!session.authenticated) return <AuthGate lang={lang} onLangChange={setLang} onAuthenticated={(value) => {
    if (typeof value.accountId === "number") alignLocalAccount(value.accountId, value.method);
    setSession(value);
  }} />;
  return <App key={session.accountId} />;
}
