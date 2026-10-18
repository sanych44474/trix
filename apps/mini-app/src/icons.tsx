// One icon family for the app chrome: 24px grid, 1.8px round strokes, currentColor. Replaces the
// mixed Unicode glyphs (⌂ ◈ ▤ ◌ ↗ ✦ ◎ ↻ ⚙), which rendered at different sizes and weights per
// platform font and read as decoration rather than as one set.
import type { JSX } from "react";

export type IconName =
  | "today" | "train" | "plan" | "fuel" | "progress" | "more" | "role" | "settings" | "library" | "inbox" | "coach"
  | "heart" | "drop" | "search" | "mic" | "camera" | "barcode" | "bell" | "gear" | "refresh" | "check" | "plus" | "minus" | "info" | "dots" | "timer" | "chevron" | "chat" | "close";

const PATHS: Record<IconName, JSX.Element> = {
  today: <><path d="M4 10.5 12 4l8 6.5" /><path d="M6 9v10h12V9" /><path d="M10 19v-5h4v5" /></>,
  train: <><path d="M3 12h18" /><rect x="5" y="8" width="3" height="8" rx="1" /><rect x="16" y="8" width="3" height="8" rx="1" /><path d="M2.5 10.5v3M21.5 10.5v3" /></>,
  plan: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 9.5h16M8 3v4M16 3v4M8 13.5h3M8 16.5h6" /></>,
  fuel: <><path d="M12 7c-1-2.5-4.5-3-6-.5-2 3.2.5 8.7 3 11 1.2 1.1 2 .9 3 .3 1 .6 1.8.8 3-.3 2.5-2.3 5-7.8 3-11-1.5-2.5-5-2-6 .5Z" /><path d="M12 7c0-1.7.7-3 2-4" /></>,
  progress: <><path d="M4 19h16" /><path d="m5 15 4.5-4.5 3.5 3 6-6.5" /><path d="M15 7h4v4" /></>,
  more: <><rect x="4" y="4" width="6.5" height="6.5" rx="1.6" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" /></>,
  role: <><circle cx="9" cy="8.5" r="3" /><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" /><circle cx="17" cy="9.5" r="2.4" /><path d="M16 14.2c2.3-.3 4 1.2 4.5 4.3" /></>,
  settings: <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2.2" /><circle cx="9" cy="17" r="2.2" /></>,
  gear: <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2.2" /><circle cx="9" cy="17" r="2.2" /></>,
  library: <><path d="M5 4h4v16H5zM10 4h4v16h-4z" /><path d="m15.5 5.2 3.6-1 3 15.3-3.7.9z" /></>,
  inbox: <><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>,
  bell: <><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>,
  coach: <><path d="M5 5h14v10H10l-4 4v-4H5Z" /><path d="M9 9.5h6M9 12h4" /></>,
  chat: <><path d="M5 5h14v10H10l-4 4v-4H5Z" /><path d="M9 9.5h6M9 12h4" /></>,
  refresh: <><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M19.5 4.5v4h-4" /></>,
  heart: <path d="M12 19s-7-4.3-7-9.5A3.8 3.8 0 0 1 12 7a3.8 3.8 0 0 1 7 2.5C19 14.7 12 19 12 19Z" />,
  drop: <path d="M12 4s5.5 6 5.5 10a5.5 5.5 0 0 1-11 0C6.5 10 12 4 12 4Z" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>,
  mic: <><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" /></>,
  camera: <><path d="M4 8.5h3.5L9 6h6l1.5 2.5H20V18H4Z" /><circle cx="12" cy="13" r="3.2" /></>,
  barcode: <path d="M4 7V5h3M17 5h3v2M20 17v2h-3M7 19H4v-2M8 9v6M11 9v6M14 9v6M17 9v6" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.6v.1" /></>,
  dots: <><circle cx="5.5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="18.5" cy="12" r="1.2" /></>,
  timer: <><circle cx="12" cy="13" r="7.5" /><path d="M12 9v4.2l2.6 1.6M9.5 2.8h5" /></>,
  chevron: <path d="m9 6 6 6-6 6" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
};

export function Icon({ name, size = 24, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={className ? `icon ${className}` : "icon"} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
