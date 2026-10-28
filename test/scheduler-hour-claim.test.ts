// The hourly pass stamps `last_user_pass` before it runs (so a slow pass is not restarted every
// minute). A pass that then fails must give its hour back, or that hour's reminders are lost.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { runSchedule } from "../src/scheduler";
import { getSetting } from "../src/adapters/d1/v2Admin";
import type { Env } from "../src/types";

test("runSchedule: an hourly pass that fails after claiming its hour releases the claim", async () => {
  const db = newDb();
  let claimed = false;
  // D1 goes down right after the pass stamps its hour: every statement except settings fails.
  const flaky = new Proxy(db, {
    get(target, prop) {
      if (prop !== "prepare") return Reflect.get(target, prop).bind?.(target) ?? Reflect.get(target, prop);
      return (sql: string) => {
        if (claimed && !sql.includes("v2_settings") && !sql.includes("schedule_lock")) throw new Error("D1_ERROR: network");
        const stmt = target.prepare(sql);
        if (!sql.startsWith("INSERT INTO v2_settings (key, value) VALUES (?, ?)")) return stmt;
        return { bind: (key: string, value: string) => ({ run: async () => { if (key === "last_user_pass") claimed = true; return stmt.bind(key, value).run(); } }) };
      };
    },
  });
  const env = { DB: flaky, TELEGRAM_BOT_TOKEN: "1:test" } as unknown as Env;

  await assert.rejects(runSchedule(env));

  assert.equal(claimed, true, "the pass never reached its hour claim");
  assert.equal(await getSetting(db as never, "last_user_pass"), "");
});
