import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, setOwnerChatId, updateUser } from "../src/db/repos";
import { handleOwnerApi } from "../src/webapp/ownerApi";

function req(method: string, path: string, body?: unknown) {
  return new Request(`https://x${path}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}),
  });
}
async function call(db: ReturnType<typeof newDb>, userId: number | null, method: string, path: string, body?: unknown) {
  const full = userId ? `${path}${path.includes("?") ? "&" : "?"}debugUser=${userId}` : path;
  return handleOwnerApi(req(method, full, body), new URL(`https://x${full}`), { DB: db, TELEGRAM_BOT_TOKEN: "t" } as never);
}

test("handleOwnerApi: unauthorized without a resolvable user", async () => {
  const db = newDb();
  const res = await call(db, null, "GET", "/api/owner/users");
  assert.equal(res.status, 401);
});

test("handleOwnerApi: a non-owner gets an opaque 404, never 403 (no owner-existence leak)", async () => {
  const db = newDb();
  await getOrCreateUser(db, 1, 1, "en", "Regular");
  const res = await call(db, 1, "GET", "/api/owner/users");
  assert.equal(res.status, 404);
});

test("handleOwnerApi: the claimed owner can read the users table and report sections", async () => {
  const db = newDb();
  await getOrCreateUser(db, 5, 5, "en", "Owner");
  await setOwnerChatId(db, 5); // chatId, not user id — matches getOwnerChatId's contract
  await getOrCreateUser(db, 6, 6, "en", "Someone");

  const users = await call(db, 5, "GET", "/api/owner/users");
  assert.equal(users.status, 200);

  const overview = await call(db, 5, "GET", "/api/owner/report");
  assert.equal(overview.status, 200);
  const overviewBody = (await overview.json()) as { html: string };
  assert.ok(overviewBody.html.length > 0);

  const errors = await call(db, 5, "GET", "/api/owner/report?section=errors");
  assert.equal(errors.status, 200);
});

test("handleOwnerApi: a user whose chatId differs from the owner's is still refused", async () => {
  const db = newDb();
  await getOrCreateUser(db, 5, 55, "en", "Owner"); // chatId 55
  await setOwnerChatId(db, 55);
  await getOrCreateUser(db, 7, 77, "en", "Impostor"); // different chatId
  const res = await call(db, 7, "GET", "/api/owner/users");
  assert.equal(res.status, 404);
});

test("handleOwnerApi: unknown path under owner auth still 404s", async () => {
  const db = newDb();
  await getOrCreateUser(db, 5, 5, "en", "Owner");
  await setOwnerChatId(db, 5);
  const res = await call(db, 5, "GET", "/api/owner/nope");
  assert.equal(res.status, 404);
});

test("handleOwnerApi: ask-inactive is a no-op when nobody qualifies", async () => {
  const db = newDb();
  await getOrCreateUser(db, 5, 5, "en", "Owner");
  await setOwnerChatId(db, 5);
  await getOrCreateUser(db, 6, 6, "en", "Recent");
  await updateUser(db, 6, { lastSeenAt: new Date() }); // active today → not a target
  const res = await call(db, 5, "POST", "/api/owner/ask-inactive");
  const body = (await res.json()) as { sent: number; total: number };
  assert.equal(res.status, 200);
  assert.equal(body.total, 0);
  assert.equal(body.sent, 0);
});
