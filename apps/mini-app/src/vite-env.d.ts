/// <reference types="vite/client" />

interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: { user?: { language_code?: string } };
  colorScheme?: "light" | "dark";
  ready(): void;
  expand(): void;
  close(): void;
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
