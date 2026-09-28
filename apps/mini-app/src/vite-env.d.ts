/// <reference types="vite/client" />

interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: { user?: { language_code?: string } };
  colorScheme?: "light" | "dark";
  ready(): void;
  expand(): void;
  close(): void;
  showConfirm?(message: string, callback: (ok: boolean) => void): void; // Bot API 6.2+
  HapticFeedback?: {
    impactOccurred(style: "light" | "medium" | "heavy"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
  };
  BackButton?: {
    show(): void;
    hide(): void;
    onClick(callback: () => void): void;
    offClick(callback: () => void): void;
  };
}

interface Window {
  Telegram?: { WebApp: TelegramWebApp };
}
