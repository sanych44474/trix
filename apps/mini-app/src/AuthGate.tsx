import { useEffect, useRef, useState } from "react";
import { api, jsonBody } from "./api";
import { beginNativeGoogleSignIn, isTrixAndroid, openTelegramLogin, subscribeToNativeGoogleAuth, type AuthProviderConfig, type GoogleNonceChallenge, type TelegramLoginChallenge } from "./authProviders";
import type { Lang } from "./i18n";

type AuthSession = { authenticated: true; accountId: number; method: "email" | "google" | "telegram" | "debug"; email: string | null; googleLinked?: boolean };
type EmailChallenge = { challengeId: string; expiresInSeconds: number };
type TelegramLoginState = TelegramLoginChallenge;

const copy = {
  uk: {
    eyebrow: "TRIX · ТРЕНУВАННЯ З РОЗУМОМ", title: "Увійти до свого простору", detail: "Увійдіть через Google або підтвердьте вхід у Telegram. Електронна пошта залишається запасним способом.", google: "Продовжити з Google", telegram: "Увійти через Telegram", telegramOpen: "Відкрити Telegram і натиснути Start", telegramWait: "Чекаємо на підтвердження в Telegram…", telegramCode: "Підтверджуй лише якщо бот показує код", telegramExpired: "Посилання застаріло. Створіть нове.", emailDivider: "або через електронну пошту", email: "Електронна пошта", send: "Надіслати код", code: "Код із листа", verify: "Увійти", change: "Змінити адресу", sent: "Якщо адреса введена правильно, лист із кодом уже в дорозі.", expired: "Код діє 10 хвилин.", retry: "Не вдалося виконати запит. Перевірте з’єднання та спробуйте ще раз.", invalidEmail: "Введіть коректну адресу електронної пошти.", lang: "English",
  },
  en: {
    eyebrow: "TRIX · TRAIN SMARTER", title: "Sign in to your space", detail: "Continue with Google or confirm in Telegram. Email remains available as a backup.", google: "Continue with Google", telegram: "Continue with Telegram", telegramOpen: "Open Telegram and tap Start", telegramWait: "Waiting for Telegram confirmation…", telegramCode: "Confirm only if the bot shows code", telegramExpired: "This link expired. Start again.", emailDivider: "or continue with email", email: "Email address", send: "Send code", code: "Code from email", verify: "Sign in", change: "Change email", sent: "If the address is valid, your sign-in code is on its way.", expired: "The code expires in 10 minutes.", retry: "The request failed. Check your connection and try again.", invalidEmail: "Enter a valid email address.", lang: "Українська",
  },
} as const;

export function AuthGate({ lang, onLangChange, onAuthenticated }: { lang: Lang; onLangChange: (lang: Lang) => void; onAuthenticated: (session: AuthSession) => void }) {
  const text = copy[lang];
  const [email, setEmail] = useState("");
  const [challenge, setChallenge] = useState<EmailChallenge | null>(null);
  const [telegram, setTelegram] = useState<TelegramLoginState | null>(null);
  const [code, setCode] = useState("");
  const [providers, setProviders] = useState<AuthProviderConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const googleChallengeId = useRef("");

  useEffect(() => { api<AuthProviderConfig>("/api/v2/auth/providers").then(setProviders).catch(() => setProviders({ googleClientId: null, telegramAvailable: false })); }, []);

  useEffect(() => subscribeToNativeGoogleAuth((result) => {
    const challengeId = googleChallengeId.current;
    if (!challengeId) return;
    if (!result.idToken) {
      googleChallengeId.current = "";
      setBusy(false);
      if (result.error !== "cancelled") setError(text.retry);
      return;
    }
    setBusy(true); setError("");
    void api<AuthSession>("/api/v2/auth/google/verify", {
      method: "POST", credentials: "same-origin", body: jsonBody({ challengeId, idToken: result.idToken, lang }),
    }).then(onAuthenticated).catch(() => setError(text.retry)).finally(() => { googleChallengeId.current = ""; setBusy(false); });
  }), [lang, onAuthenticated, text.retry]);

  useEffect(() => {
    if (!telegram) return;
    let active = true;
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const status = await api<{ verified: boolean; expired: boolean }>(`/api/v2/auth/telegram/status?challengeId=${telegram.challengeId}`);
        if (!active) return;
        if (status.expired) { setTelegram(null); setError(text.telegramExpired); return; }
        if (!status.verified) return;
        const result = await api<AuthSession>("/api/v2/auth/telegram/complete", {
          method: "POST", credentials: "same-origin", body: jsonBody({ challengeId: telegram.challengeId, completionToken: telegram.completionToken }),
        });
        if (active) onAuthenticated(result);
      } catch {
        // A temporary polling failure should not invalidate an otherwise live Telegram link.
      } finally { checking = false; }
    };
    void check();
    const timer = window.setInterval(() => { void check(); }, 2_500);
    return () => { active = false; window.clearInterval(timer); };
  }, [telegram?.challengeId, telegram?.completionToken, onAuthenticated, text.telegramExpired]);

  const startEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) { setError(text.invalidEmail); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<EmailChallenge>("/api/v2/auth/email/start", { method: "POST", credentials: "same-origin", body: jsonBody({ email: normalizedEmail, lang }) });
      setEmail(normalizedEmail); setChallenge(result); setNotice(text.sent);
    } catch { setError(text.retry); } finally { setBusy(false); }
  };

  const verifyEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!challenge || !/^\d{6}$/.test(code)) return;
    setBusy(true); setError("");
    try {
      const result = await api<AuthSession>("/api/v2/auth/email/verify", { method: "POST", credentials: "same-origin", body: jsonBody({ email: email.trim().toLowerCase(), challengeId: challenge.challengeId, code, lang }) });
      onAuthenticated(result);
    } catch { setError(text.retry); } finally { setBusy(false); }
  };

  const startGoogle = async () => {
    setBusy(true); setError("");
    try {
      const response = await api<GoogleNonceChallenge>("/api/v2/auth/google/nonce", { method: "POST", credentials: "same-origin", body: jsonBody({ lang }) });
      googleChallengeId.current = response.challengeId;
      if (!beginNativeGoogleSignIn(response)) { googleChallengeId.current = ""; setError(text.retry); setBusy(false); }
    } catch { setError(text.retry); setBusy(false); }
  };

  const startTelegram = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<TelegramLoginChallenge>("/api/v2/auth/telegram/start", { method: "POST", credentials: "same-origin", body: jsonBody({}) });
      setTelegram(result); setNotice(text.telegramWait);
    } catch { setError(text.retry); } finally { setBusy(false); }
  };

  return <main className="auth-screen">
    <div className="auth-panel">
      <div className="auth-mark">T</div>
      <div className="eyebrow">{text.eyebrow}</div>
      <button className="auth-language" type="button" onClick={() => onLangChange(lang === "uk" ? "en" : "uk")}>{text.lang}</button>
      <h1>{text.title}</h1>
      <p className="auth-detail">{text.detail}</p>
      {(isTrixAndroid() && providers?.googleClientId) && <button className="button button-ghost button-wide button-tall" disabled={busy} onClick={() => void startGoogle()}>{busy ? "…" : text.google}</button>}
      {providers?.telegramAvailable && <button className="button button-ghost button-wide button-tall" disabled={busy || !!telegram} onClick={() => void startTelegram()}>{busy && !telegram ? "…" : text.telegram}</button>}
      {telegram && <div className="auth-message auth-provider-message">{text.telegramWait}<p>{text.telegramCode} <strong>{telegram.matchCode}</strong></p><button className="button button-primary button-wide" type="button" onClick={() => openTelegramLogin(telegram.telegramUrl)}>{text.telegramOpen}</button></div>}
      {(isTrixAndroid() && providers?.googleClientId) || providers?.telegramAvailable ? <div className="auth-divider"><span>{text.emailDivider}</span></div> : null}
      {!challenge ? <form className="auth-form" onSubmit={startEmail}>
        <label className="form-field">{text.email}<input type="email" autoComplete="email" inputMode="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <button className="button button-primary button-wide button-tall" disabled={busy}>{busy ? "…" : text.send}</button>
      </form> : <form className="auth-form" onSubmit={verifyEmail}>
        <div className="auth-message">{notice}<br /><small>{text.expired}</small></div>
        <label className="form-field">{text.code}<input type="text" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></label>
        <button className="button button-primary button-wide button-tall" disabled={busy || code.length !== 6}>{busy ? "…" : text.verify}</button>
        <button className="button button-quiet button-wide" type="button" onClick={() => { setChallenge(null); setCode(""); setError(""); setNotice(""); }}>{text.change}</button>
      </form>}
      {error && <p className="auth-error" role="alert">{error}</p>}
    </div>
  </main>;
}
