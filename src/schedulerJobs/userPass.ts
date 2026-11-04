// What one user's scheduler pass (processUser, scheduler.ts) knows and can do, handed to the
// reminder blocks that live in their own modules. Built once per pass; each block destructures
// only what it uses. A block returns true when it sent the one user-facing message of the tick.
import type { BodyLogDoc, Env, Lang, PlanDoc, UserDoc, Weekday, WorkoutLogDoc } from "../types";
import type { DeliveryResult } from "../schedulerOutbox";
import type { SharedPass } from "../scheduler";
import type { Sender } from "./shared";
import type { InlineKeyboard } from "grammy";
import type { AppButton } from "../notify/appKeyboard";

type SendExtra = Parameters<Sender["api"]["sendMessage"]>[2];

/**
 * The outbox idempotency key for a reminder to the pass's user. A reminder that repeats within a
 * day (water every N hours) must name its slot: keyed on the text alone, "0/2500 ml" at 11:00 was
 * the same key as at 09:00, so the outbox answered "duplicate", nothing was sent, and the duplicate
 * still counted as delivered and used up that pass's one reminder.
 */
export function reminderKey(date: string, text: string, key?: string): string {
  return key ? `${date}:${key}` : `${date}:${text.slice(0, 200)}`;
}

export interface UserPass {
  env: Env;
  bot: Sender;
  user: UserDoc;
  pass: SharedPass;
  db: D1Database;
  lang: Lang;
  tz: string;
  date: string;
  weekday: Weekday;
  hour: number;
  reminderHour: number;
  activePlan: PlanDoc | null;
  planDays: Set<number>;
  trainsOn: (wd: Weekday) => boolean;
  isTrainingDay: boolean;
  loggedToday: WorkoutLogDoc | null;
  sent: Record<string, string>;
  already: (key: string) => boolean;
  markSent: (key: string) => void;
  /** Store a dedup key with a value other than today's date (e.g. the date a miss happened). */
  setSent: (key: string, value: string) => void;
  remOff: (key: string) => boolean;
  /** `key` names the reminder (and its slot) for outbox dedup; without it the text is the key. */
  send: (text: string, extra?: SendExtra, key?: string) => Promise<DeliveryResult>;
  sendTo: (target: { _id: number; chatId: number }, kind: string, text: string, extra?: SendExtra) => Promise<DeliveryResult>;
  sendAndMark: (key: string, text: string, extra?: SendExtra) => Promise<DeliveryResult>;
  durable: (r: DeliveryResult) => boolean;
  appView: (view: string) => string | undefined;
  /** Notification buttons that open the Mini App (callback fallbacks without one), see notify/appKeyboard. */
  appKb: (rows: AppButton[][]) => InlineKeyboard | undefined;
  workouts21: () => Promise<WorkoutLogDoc[]>;
  bodyAll: () => Promise<BodyLogDoc[]>;
}
