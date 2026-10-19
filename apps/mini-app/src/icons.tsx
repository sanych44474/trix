// One icon family for the app chrome: 24px grid, 1.8px round strokes, currentColor. Replaces the
// mixed Unicode glyphs (⌂ ◈ ▤ ◌ ↗ ✦ ◎ ↻ ⚙), which rendered at different sizes and weights per
// platform font and read as decoration rather than as one set.
import type { JSX } from "react";

export type IconName =
  | "today" | "train" | "plan" | "fuel" | "progress" | "more" | "role" | "settings" | "library" | "inbox" | "coach"
  | "heart" | "drop" | "search" | "mic" | "camera" | "barcode" | "bell" | "gear" | "refresh" | "check" | "plus" | "minus" | "info" | "dots" | "timer" | "chevron" | "chat" | "close"
  | "medal" | "trophy" | "pencil" | "bug" | "bulb" | "star" | "sparkle" | "steps" | "frown";

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
  medal: <><circle cx="12" cy="15" r="5" /><path d="M9 10.5 6.5 3.5h4L12 7M15 10.5l2.5-7h-4L12 7" /><path d="m12 13 .9 1.6 1.7.3-1.3 1.2.3 1.8-1.6-.9-1.6.9.3-1.8-1.3-1.2 1.7-.3Z" /></>,
  trophy: <><path d="M8 4h8v5a4 4 0 0 1-8 0Z" /><path d="M8 6H4.5c0 3 1.5 4.5 3.7 4.8M16 6h3.5c0 3-1.5 4.5-3.7 4.8" /><path d="M12 13v3.5M8.5 20h7M9.5 20l.5-3.5h4l.5 3.5" /></>,
  pencil: <><path d="M15.5 4.5 19.5 8.5 9 19H5v-4Z" /><path d="m13 7 4 4" /></>,
  bug: <><rect x="7.5" y="8" width="9" height="11" rx="4.5" /><path d="M9.5 8a2.5 2.5 0 0 1 5 0M12 11v8M4 13h3.5M16.5 13H20M5 8.5l2.8 1.8M19 8.5l-2.8 1.8M5 18.5l2.8-1.8M19 18.5l-2.8-1.8" /></>,
  bulb: <><path d="M9 17.5h6M10 20.5h4" /><path d="M8.5 14.5a6 6 0 1 1 7 0c-.6.5-1 1.2-1 2v1h-5v-1c0-.8-.4-1.5-1-2Z" /></>,
  star: <path d="m12 4 2.4 5 5.4.7-4 3.7 1 5.4L12 16.2 7.2 18.8l1-5.4-4-3.7 5.4-.7Z" />,
  sparkle: <><path d="M12 4c.6 3.8 2.2 5.4 6 6-3.8.6-5.4 2.2-6 6-.6-3.8-2.2-5.4-6-6 3.8-.6 5.4-2.2 6-6Z" /><path d="M18.5 15.5c.2 1.4.8 2 2.2 2.2-1.4.2-2 .8-2.2 2.2-.2-1.4-.8-2-2.2-2.2 1.4-.2 2-.8 2.2-2.2Z" /></>,
  steps: <><path d="M7 15.5c-1.6-.3-2.6-2.3-2.3-5 .3-2.6 1.6-4.3 3.1-4.1 1.5.2 2.2 2.3 1.8 4.9-.3 2.5-1 4.4-2.6 4.2Z" /><path d="M6.5 18.5c.1 1.2 1 1.8 2 1.6 1-.2 1.3-1.1 1-2.2M16.5 11.5c1.6-.3 2.6-2.3 2.3-5-.3-2.6-1.6-4.3-3.1-4.1-1.5.2-2.2 2.3-1.8 4.9.3 2.5 1 4.4 2.6 4.2Z" /><path d="M17 14.5c-.1 1.2-1 1.8-2 1.6-1-.2-1.3-1.1-1-2.2" /></>,
  frown: <><circle cx="12" cy="12" r="8.5" /><path d="M9 9.5v.1M15 9.5v.1M8.5 16c1.8-1.8 5.2-1.8 7 0" /></>,
};

export function Icon({ name, size = 24, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={className ? `icon ${className}` : "icon"} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
