// Wake helpers for the three scheduler Durable Objects. They live apart from the DO modules
// because those import "cloudflare:workers", which plain node:test cannot resolve; callers
// (scheduler.ts, bot/squad.ts) only need to address a DO by name, not load the class.
import type { Env } from "../types";

const GLOBAL_SCHEDULER_NAME = "global";

/** Wake (or re-wake) a user's scheduler DO. Idempotent — see UserSchedulerDO's fetch() doc. */
export async function wakeUserScheduler(env: Env, userId: number): Promise<void> {
  const id = env.USER_SCHEDULER.idFromName(String(userId));
  const stub = env.USER_SCHEDULER.get(id);
  await stub.fetch(`https://do/wake?userId=${userId}`);
}

export async function wakeSquadScheduler(env: Env, chatId: number): Promise<void> {
  const id = env.SQUAD_SCHEDULER.idFromName(String(chatId));
  const stub = env.SQUAD_SCHEDULER.get(id);
  await stub.fetch(`https://do/wake?chatId=${chatId}`);
}

/** Wake the singleton GlobalSchedulerDO. Idempotent — safe to call every health-check tick. */
export async function wakeGlobalScheduler(env: Env): Promise<void> {
  const id = env.GLOBAL_SCHEDULER.idFromName(GLOBAL_SCHEDULER_NAME);
  const stub = env.GLOBAL_SCHEDULER.get(id);
  await stub.fetch("https://do/wake");
}
