// What one user's scheduler pass (processUser, scheduler.ts) knows and can do, handed to the
// reminder blocks that live in their own modules. Built once per pass; each block destructures
// only what it uses. A block returns true when it sent the one user-facing message of the tick.
import type { BodyLogDoc, Env, Lang, PlanDoc, UserDoc, Weekday, WorkoutLogDoc } from "../types";
import type { DeliveryResult } from "../schedulerOutbox";
import type { SharedPass } from "../scheduler";
import type { Sender } from "./shared";

type SendExtra = Parameters<Sender["api"]["sendMessage"]>[2];

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
  send: (text: string, extra?: SendExtra) => Promise<DeliveryResult>;
  sendTo: (target: { _id: number; chatId: number }, kind: string, text: string, extra?: SendExtra) => Promise<DeliveryResult>;
  sendAndMark: (key: string, text: string, extra?: SendExtra) => Promise<DeliveryResult>;
  durable: (r: DeliveryResult) => boolean;
  appView: (view: string) => string | undefined;
  workouts21: () => Promise<WorkoutLogDoc[]>;
  bodyAll: () => Promise<BodyLogDoc[]>;
}
