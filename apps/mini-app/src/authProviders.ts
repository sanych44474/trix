export type AuthProviderConfig = { googleClientId: string | null; telegramAvailable: boolean };
export type GoogleNonceChallenge = { challengeId: string; nonce: string; clientId: string; expiresInSeconds: number };
export type TelegramLoginChallenge = { challengeId: string; completionToken: string; telegramUrl: string; expiresInSeconds: number };

declare global {
  interface Window {
    __trixGoogleAuthCallback?: (result: { idToken?: string; error?: string }) => void;
  }
}

export function isTrixAndroid(): boolean {
  return navigator.userAgent.includes("TrixAndroid");
}

export function beginNativeGoogleSignIn(challenge: GoogleNonceChallenge): boolean {
  if (!isTrixAndroid()) return false;
  const query = new URLSearchParams({ challengeId: challenge.challengeId, nonce: challenge.nonce, clientId: challenge.clientId });
  window.location.href = `trix-auth://google?${query.toString()}`;
  return true;
}

export function openTelegramLogin(url: string): void {
  if (isTrixAndroid()) {
    window.location.href = `trix-auth://open?url=${encodeURIComponent(url)}`;
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export function subscribeToNativeGoogleAuth(callback: (result: { idToken?: string; error?: string }) => void): () => void {
  window.__trixGoogleAuthCallback = callback;
  return () => { delete window.__trixGoogleAuthCallback; };
}
