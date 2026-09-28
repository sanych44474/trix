/// <reference types="vite/client" />

interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: { user?: { language_code?: string } };
  colorScheme?: "light" | "dark";
  ready(): void;
  expand(): void;
  close(): void;
  showConfirm?(message: string, callback: (ok: boolean) => void): void; // Bot API 6.2+
  version?: string;
  isVersionAtLeast?(version: string): boolean;
  // Native bottom button (6.0+; setParams/showProgress are 6.0 too).
  MainButton?: {
    isVisible: boolean;
    setParams(params: { text?: string; is_active?: boolean; is_visible?: boolean; color?: string; text_color?: string }): void;
    onClick(callback: () => void): void;
    offClick(callback: () => void): void;
    showProgress(leaveActive?: boolean): void;
    hideProgress(): void;
  };
  shareToStory?(mediaUrl: string, params?: { text?: string; widget_link?: { url: string; name?: string } }): void; // 7.8+
  addToHomeScreen?(): void; // 8.0+
  checkHomeScreenStatus?(callback: (status: "unsupported" | "unknown" | "added" | "missed") => void): void; // 8.0+
  requestFullscreen?(): void; // 8.0+
  exitFullscreen?(): void; // 8.0+
  isFullscreen?: boolean;
  openInvoice?(url: string, callback?: (status: "paid" | "cancelled" | "failed" | "pending") => void): void; // 6.1+
  openLink?(url: string, options?: { try_instant_view?: boolean }): void;
  onEvent?(event: string, handler: () => void): void;
  offEvent?(event: string, handler: () => void): void;
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
