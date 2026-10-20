export type AuthProviderConfig = { googleClientId: string | null; telegramAvailable: boolean };
export type TelegramLoginChallenge = { challengeId: string; completionToken: string; matchCode: string; telegramUrl: string; expiresInSeconds: number };

export function openTelegramLogin(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
