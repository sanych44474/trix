import { useEffect, useState } from "react";
import { api, jsonBody } from "./api";
import type { Lang } from "./i18n";

type AuthSession = { authenticated: boolean; accountId?: number; method?: "email" | "google" | "telegram" | "debug"; email?: string | null; googleLinked?: boolean };
const words = {
  uk: { title: "Способи входу", detail: "Додай електронну пошту, щоб повертатися до цього акаунта в застосунку Hack Limits та на інших пристроях.", email: "Електронна пошта", send: "Надіслати код", code: "Код із листа", verify: "Підтвердити пошту", linked: "Пошту прив’язано до цього акаунта.", googleLinked: "Google прив’язано до цього акаунта.", retry: "Не вдалося виконати запит. Спробуй ще раз.", logout: "Вийти з акаунта на цьому пристрої", signedIn: "Вхід через електронну пошту", expires: "Код діє 10 хвилин." },
  en: { title: "Sign-in methods", detail: "Add an email so you can return to this same account in the Hack Limits app and on other devices.", email: "Email address", send: "Send code", code: "Code from email", verify: "Verify email", linked: "Email linked to this account.", googleLinked: "Google linked to this account.", retry: "The request failed. Try again.", logout: "Sign out on this device", signedIn: "Signed in with email", expires: "The code expires in 10 minutes." },
} as const;

export function AuthMethodsCard({ lang }: { lang: Lang }) {
  const text = words[lang];
  const [session, setSession] = useState<AuthSession | null>(null);
  const [email, setEmail] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    api<AuthSession>("/api/v2/auth/session").then(setSession).catch(() => setSession({ authenticated: false }));
  }, []);
  const start = async () => {
    setBusy(true); setMessage("");
    try {
      const result = await api<{ challengeId: string }>("/api/v2/auth/email/start", { method: "POST", body: jsonBody({ email: email.trim().toLowerCase(), lang }) });
      setChallengeId(result.challengeId); setMessage(text.expires);
    } catch { setMessage(text.retry); } finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true); setMessage("");
    try {
      await api("/api/v2/auth/email/verify", { method: "POST", body: jsonBody({ email: email.trim().toLowerCase(), challengeId, code, lang }) });
      setSession((current) => current ? { ...current, email: email.trim().toLowerCase() } : current);
      setChallengeId(""); setCode(""); setMessage(text.linked);
    } catch { setMessage(text.retry); } finally { setBusy(false); }
  };
  const logout = async () => {
    setBusy(true);
    try { await api("/api/v2/auth/logout", { method: "POST", body: jsonBody({}) }); window.dispatchEvent(new Event("trix:auth-changed")); }
    catch { setMessage(text.retry); } finally { setBusy(false); }
  };

  return <section className="card">
    <div className="section-head"><div><span className="eyebrow">TRIX ID</span><h2>{text.title}</h2></div></div>
    <p className="muted">{text.detail}</p>
    {session?.googleLinked && <p className="save-note">{text.googleLinked}</p>}
    {session?.method === "email" ? <><p>{text.signedIn}: <strong>{session.email}</strong></p><button className="button button-ghost" disabled={busy} onClick={() => void logout()}>{text.logout}</button></>
      : session?.email ? <p className="save-note">{text.linked} <strong>{session.email}</strong></p>
      : <>
        <label className="form-field"><span>{text.email}</span><input type="email" autoComplete="email" inputMode="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        {!challengeId ? <button className="button button-primary" disabled={busy || !email.trim()} onClick={() => void start()}>{busy ? "…" : text.send}</button> : <>
          <label className="form-field"><span>{text.code}</span><input type="text" autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></label>
          <button className="button button-primary" disabled={busy || code.length !== 6} onClick={() => void verify()}>{busy ? "…" : text.verify}</button>
        </>}
      </>}
    {message && <p className={message === text.retry ? "save-note error-note" : "muted"}>{message}</p>}
  </section>;
}
