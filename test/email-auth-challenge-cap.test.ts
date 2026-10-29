// Email sign-in start: the per-email cap is durable (D1), so it holds even when the Rate Limiting
// binding is missing or fails open, and it is per email.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { handleEmailAuth } from "../src/webapp/emailAuth";
import type { Env } from "../src/types";

const host = "https://hl.example";
const START = `${host}/api/v2/auth/email/start`;

function env(db: ReturnType<typeof newDb>): Env {
  // No RL_AUTH binding on purpose: the cap must not depend on it.
  return {
    DB: db,
    AUTH_SECRET: "x".repeat(40),
    RESEND_API_KEY: "re_test",
    AUTH_EMAIL_FROM: "TRIX <auth@example.com>",
  } as unknown as Env;
}

function start(e: Env, email: string): Promise<Response> {
  const req = new Request(START, {
    method: "POST",
    headers: { origin: host, "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return handleEmailAuth(req, new URL(START), e) as Promise<Response>;
}

async function withResendStub<T>(fn: (sends: () => number) => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  let sends = 0;
  globalThis.fetch = (async () => { sends++; return new Response("{}", { status: 200 }); }) as typeof fetch;
  try {
    return await fn(() => sends);
  } finally {
    globalThis.fetch = realFetch;
  }
}

// The per-email "a code was sent recently" guard blocks back-to-back starts, so each challenge is
// marked consumed once sent. Consumed challenges still count toward the hourly cap.
async function consumeAll(db: ReturnType<typeof newDb>) {
  await db.prepare("UPDATE v2_auth_email_challenges SET consumedAt = ? WHERE consumedAt IS NULL").bind(new Date().toISOString()).run();
}

test("email start: the 6th code for one email within an hour is 429, with no rate-limit binding", async () => {
  const db = newDb();
  const e = env(db);
  await withResendStub(async (sends) => {
    for (let i = 0; i < 5; i++) {
      const res = await start(e, "victim@example.com");
      assert.equal(res.status, 200, `start #${i + 1} is allowed`);
      await consumeAll(db);
    }
    const sixth = await start(e, "victim@example.com");
    assert.equal(sixth.status, 429);
    assert.equal(((await sixth.json()) as { error: { code: string } }).error.code, "rate_limited");
    assert.equal(sends(), 5, "the blocked start sends no email");
  });
  const rows = await db.prepare("SELECT COUNT(*) AS n FROM v2_auth_email_challenges WHERE email = ?").bind("victim@example.com").first<{ n: number }>();
  assert.equal(rows?.n, 5, "the blocked start creates no challenge");
});

test("email start: the cap is per email, and only counts the last hour", async () => {
  const db = newDb();
  const e = env(db);
  const old = new Date(Date.now() - 2 * 3_600_000).toISOString();
  for (let i = 0; i < 5; i++) {
    await db.prepare("INSERT INTO v2_auth_email_challenges (id, email, codeHash, createdAt, expiresAt, consumedAt) VALUES (?, ?, 'h', ?, ?, ?)")
      .bind(`${String(i).padStart(32, "0")}`, "old@example.com", old, old, old).run();
  }
  await withResendStub(async () => {
    assert.equal((await start(e, "old@example.com")).status, 200, "challenges older than an hour do not count");
    assert.equal((await start(e, "other@example.com")).status, 200, "another email is unaffected");
  });
});
