import { useEffect, useRef, useState } from "react";
import { api, jsonBody } from "./api";
import { beginNativeGoogleSignIn, isTrixAndroid, subscribeToNativeGoogleAuth, type AuthProviderConfig, type GoogleNonceChallenge } from "./authProviders";
import type { Lang } from "./i18n";

type AuthSession = { authenticated: boolean; accountId?: number; method?: "email" | "google" | "telegram" | "debug"; email?: string | null; googleLinked?: boolean };
const words = {
  uk: { title: "Способи входу", detail: "Додай Google або електронну пошту, щоб безпечно повертатися до цього акаунта на Android та інших пристроях.", email: "Електронна пошта", send: "Надіслати код", code: "Код із листа", verify: "Підтвердити пошту", linked: "Пошту прив’язано до цього акаунта.", google: "Прив’язати Google", googleLinked: "Google прив’язано до цього акаунта.", retry: "Не вдалося виконати запит. Спробуй ще раз.", logout: "Вийти з акаунта на цьому пристрої", signedIn: "Вхід через електронну пошту", expires: "Код діє 10 хвилин." },
  en: { title: "Sign-in methods", detail: "Add Google or email so you can return to this same account on Android and other devices.", email: "Email address", send: "Send code", code: "Code from email", verify: "Verify email", linked: "Email linked to this account.", google: "Link Google", googleLinked: "Google linked to this account.", retry: "The request failed. Try again.", logout: "Sign out on this device", signedIn: "Signed in with email", expires: "The code expires in 10 minutes." },
} as const;

export function AuthMethodsCard({ lang }: { lang: Lang }) {
  const text = words[lang];
  const [session, setSession] = useState<AuthSession | null>(null);
  const [providers, setProviders] = useState<AuthProviderConfig | null>(null);
  const [email, setEmail] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const googleChallengeId = useRef("");
  useEffect(() => {
    api<AuthSession>("/api/v2/auth/session").then(setSession).catch(() => setSession({ authenticated: false }));
    api<AuthProviderConfig>("/api/v2/auth/providers").then(setProviders).catch(() => setProviders({ googleClientId: null, telegramAvailable: false }));
  }, []);
  useEffect(() => subscribeToNativeGoogleAuth((result) => {
    const challengeId = googleChallengeId.current;
    if (!challengeId) return;
    if (!result.idToken) { googleChallengeId.current = ""; setBusy(false); setMessage(result.error === "cancelled" ? "" : text.retry); return; }
    setBusy(true); setMessage("");
    void api<AuthSession>("/api/v2/auth/google/verify", { method: "POST", body: jsonBody({ challengeId, idToken: result.idToken, lang }) })
      .then((value) => { setSession({ ...value, googleLinked: true }); setMessage(text.googleLinked); window.dispatchEvent(new Event("trix:auth-changed")); })
      .catch(() => setMessage(text.retry)).finally(() => { googleChallengeId.current = ""; setBusy(false); });
  }), [lang, text.googleLinked, text.retry]);

  const linkGoogle = async () => {
    setBusy(true); setMessage("");
    try {
      const challenge = await api<GoogleNonceChallenge>("/api/v2/auth/google/nonce", { method: "POST", body: jsonBody({ lang }) });
      googleChallengeId.current = challenge.challengeId;
      if (!beginNativeGoogleSignIn(challenge)) { googleChallengeId.current = ""; setMessage(text.retry); setBusy(false); }
    } catch { setMessage(text.retry); setBusy(false); }
  };

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
    {session?.googleLinked ? <p className="save-note">{text.googleLinked}</p>
      : isTrixAndroid() && providers?.googleClientId && <button className="button button-ghost" disabled={busy} onClick={() => void linkGoogle()}>{busy ? "…" : text.google}</button>}
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
