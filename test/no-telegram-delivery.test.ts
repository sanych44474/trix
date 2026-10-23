// Accounts without a Telegram chat (email / Google sign-in): the data export comes back as a file in
// the response, and "send it to my chat" actions say there is no chat instead of failing silently.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, updateUser } from "../src/adapters/d1/v2Users";
import { handleSettingsApi } from "../src/webapp/settingsApi";
import { handleExtrasApi } from "../src/webapp/extrasApi";
import { handleV2Api } from "../src/webapp/v2Api";

type Db = ReturnType<typeof newDb>;
const env = (db: Db) => ({ DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "t" }) as never;

async function seed(db: Db, id: number, telegram: boolean) {
  await getOrCreateUser(db, id, id, "en", "Ann");
  if (!telegram) await updateUser(db, id, { botBlocked: true });
  const t = "2026-10-01T09:00:00.000Z";
  await db.prepare("INSERT INTO v2_workout_sessions (accountId, date, weekday, completed, rawText, createdAt, updatedAt) VALUES (?, '2026-10-01', 3, 1, 'Squat 3x5 100kg', ?, ?)").bind(id, t, t).run();
}

function exportReq(db: Db, id: number, body: Record<string, unknown>) {
  const p = `/api/settings?debugUser=${id}`;
  return handleSettingsApi(new Request(`https://x${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), new URL(`https://x${p}`), env(db));
}

test("export: an account without Telegram gets the file in the response", async () => {
  const db = newDb();
  await seed(db, 41, false);
  for (const [action, type, name] of [["export", "text/markdown", "hack-limits-export.md"], ["export_json", "application/json", "hack-limits-export.json"]] as const) {
    const res = await exportReq(db, 41, { action });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", new RegExp(type));
    assert.match(res.headers.get("content-disposition") ?? "", new RegExp(`attachment; filename="${name}"`));
    assert.ok((await res.text()).length > 10, `${action} has content`);
  }
});

test("export: the native app can ask for the file even when the account has Telegram", async () => {
  const db = newDb();
  await seed(db, 42, true);
  const res = await exportReq(db, 42, { action: "export_json", delivery: "download" });
  assert.match(res.headers.get("content-disposition") ?? "", /attachment/);
});

test("photo comparison: no chat to send to -> 409 no_telegram_chat (the client shares the image itself)", async () => {
  const db = newDb();
  await seed(db, 43, false);
  const form = new FormData();
  form.append("photo", new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])]), "c.png");
  form.append("from", "2026-09-01");
  form.append("to", "2026-10-01");
  const p = "/api/photocompare?debugUser=43";
  const res = await handleExtrasApi(new Request(`https://x${p}`, { method: "POST", body: form }), new URL(`https://x${p}`), env(db));
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: "no_telegram_chat", code: "conflict", retryable: false });
});

test("export through /api/v2/settings arrives as the file, not wrapped in { data }", async () => {
  const db = newDb();
  await seed(db, 44, false);
  const p = "/api/v2/settings?debugUser=44";
  const res = await handleV2Api(new Request(`https://x${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "export" }) }), new URL(`https://x${p}`), env(db));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition") ?? "", /attachment; filename="hack-limits-export.md"/);
  const text = await res.text();
  assert.ok(!text.startsWith("{"), "the markdown itself, not a JSON envelope");
  assert.ok(text.length > 10);
});
