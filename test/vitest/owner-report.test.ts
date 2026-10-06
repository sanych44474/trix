// The owner report runs ~40 hand-written SQL queries against the v2 schema. The node:sqlite
// harness cannot run several of them (db.batch() with results), so this builds every section
// against REAL D1: a query that drifts from the schema fails here instead of showing the owner
// an empty or half-built report.
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { buildErrorReport, buildOwnerMetrics, buildOwnerReport } from "../../src/bot/ownerReport";
import { aiCallStmt, recordError } from "../../src/adapters/d1/v2Admin";

async function seedAccount(id: number, role = "solo"): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO v2_accounts (id, legacyUserId, chatId, role, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, 'active', ?, ?)",
  ).bind(id, id, id, role, now, now).run();
}

describe("owner report against real D1", () => {
  it("builds on an empty database without throwing", async () => {
    const report = await buildOwnerReport(env.DB);
    expect(report.length).toBeGreaterThan(0);
    expect(await buildErrorReport(env.DB)).toBeNull();
    const metrics = await buildOwnerMetrics(env.DB);
    expect(metrics).toBeTypeOf("object");
  });

  it("reflects seeded AI calls and errors in the report and the 24h error digest", async () => {
    await seedAccount(901);
    await seedAccount(902, "trainer");
    await env.DB.batch([
      aiCallStmt(env.DB, { userId: 901, provider: "gemini", kind: "coach", latencyMs: 800, tokens: 120, wasFallback: false }),
      aiCallStmt(env.DB, { userId: 901, provider: "groq", kind: "coach", latencyMs: 300, tokens: 90, wasFallback: true }),
    ]);
    await recordError(env.DB, { userId: 901, kind: "coach", errorType: "timeout", message: "gemini: timeout" });

    const report = await buildOwnerReport(env.DB);
    expect(report).toContain("────────────");

    const digest = await buildErrorReport(env.DB);
    expect(digest).toContain("AI errors (24h): 1");
    expect(digest).toContain("timeout 1");
    expect(digest).toContain("AI calls (24h): 2 · fallback rate 50%");
  });
});
