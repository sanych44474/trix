// Squads in the Mini App: create, invite by code (app and bot deep link), the caps, leaving, and
// that an app squad never reaches Telegram (its id is not a chat) -- boards and PRs go to the feed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { getOrCreateUser, updateUser } from "../src/adapters/d1/v2Users";
import { getSquad, isAppSquad, squadsForUser } from "../src/adapters/d1/v2Gamification";
import { announceSquadPr, postSquadDigest } from "../src/bot/squad";
import { handleSquadsApi, joinByInviteCode, MAX_SQUAD_MEMBERS } from "../src/webapp/squadApi";
import { inviteCodeFrom } from "../apps/mini-app/src/Squads";

const env = (db: ReturnType<typeof newDb>) => ({ DB: db, ALLOW_DEBUG_USER: "1", TELEGRAM_BOT_TOKEN: "t", BOT_USERNAME: "trixbot" }) as never;

async function call(db: ReturnType<typeof newDb>, id: number, method: string, body?: unknown) {
  const p = `/api/squads?debugUser=${id}`;
  const req = new Request(`https://x${p}`, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });
  return handleSquadsApi(req, new URL(`https://x${p}`), env(db));
}

async function users(db: ReturnType<typeof newDb>, ids: number[]) {
  for (const id of ids) { await getOrCreateUser(db, id, id, "en", `U${id}`); await updateUser(db, id, { onboarded: true }); }
}

type Squads = { squads: Array<{ id: number; app: boolean; inviteLink: string | null; title: string; memberCount: number }> };

test("app squad: create, invite link carries a code, a friend joins with it", async () => {
  const db = newDb();
  await users(db, [1, 2]);
  const created = (await (await call(db, 1, "POST", { action: "create", title: "Gym bros" })).json()) as { ok: boolean; id: number };
  assert.equal(created.ok, true);
  assert.ok(isAppSquad(created.id), "app squad ids are positive (never a Telegram group id)");

  const list = (await (await call(db, 1, "GET")).json()) as Squads;
  assert.equal(list.squads.length, 1);
  assert.equal(list.squads[0].app, true);
  const link = list.squads[0].inviteLink ?? "";
  assert.match(link, /t\.me\/trixbot\?start=sq_[a-z0-9]{8}$/);

  const joined = (await (await call(db, 2, "POST", { action: "join", code: inviteCodeFrom(link) })).json()) as { ok: boolean; reason: string };
  assert.deepEqual(joined, { ok: true, reason: "joined" });
  assert.equal(await joinByInviteCode(db, 2, inviteCodeFrom(link)), "already");
  assert.equal(((await (await call(db, 2, "GET")).json()) as Squads).squads[0].memberCount, 2);
});

test("app squad: unknown codes, full squads and the per-user cap are refused", async () => {
  const db = newDb();
  const ids = Array.from({ length: MAX_SQUAD_MEMBERS + 1 }, (_, i) => 100 + i);
  await users(db, ids);
  assert.equal(await joinByInviteCode(db, 100, "nosuchcode"), "not_found");
  const { id } = (await (await call(db, 100, "POST", { action: "create", title: "Big" })).json()) as { id: number };
  const code = (await getSquad(db, id))?.inviteCode ?? "";
  for (const uid of ids.slice(1, MAX_SQUAD_MEMBERS)) assert.equal(await joinByInviteCode(db, uid, code), "joined");
  assert.equal(await joinByInviteCode(db, ids[MAX_SQUAD_MEMBERS], code), "full");

  for (let i = 0; i < 4; i++) await call(db, 100, "POST", { action: "create", title: `S${i}` });
  const sixth = (await (await call(db, 100, "POST", { action: "create", title: "One too many" })).json()) as { ok: boolean; reason: string };
  assert.deepEqual(sixth, { ok: false, reason: "too_many" });
});

test("app squad: the last one out closes it", async () => {
  const db = newDb();
  await users(db, [1]);
  const { id } = (await (await call(db, 1, "POST", { action: "create", title: "Solo" })).json()) as { id: number };
  assert.equal((await call(db, 1, "POST", { action: "leave", id })).status, 200);
  assert.equal(await getSquad(db, id), null);
  assert.deepEqual(await squadsForUser(db, 1), []);
  assert.equal((await call(db, 1, "POST", { action: "leave", id })).status, 404);
});

test("app squad: boards and PRs go to members' feeds, never to Telegram", async () => {
  const db = newDb();
  await users(db, [1, 2]);
  const { id } = (await (await call(db, 1, "POST", { action: "create", title: "Crew" })).json()) as { id: number };
  await joinByInviteCode(db, 2, (await getSquad(db, id))?.inviteCode ?? "");
  const sent: number[] = [];
  const api = { sendMessage: (async (chatId: number) => { sent.push(chatId); return {} as never; }) as never };

  assert.equal(await postSquadDigest(db, api, id, { weekStart: "2026-10-05" }), true);
  await announceSquadPr(db, api, 1, "Bench Press", "100 kg × 5");
  assert.deepEqual(sent, [], "an app squad id is not a chat");

  const feed = db.dump<{ accountId: number; kind: string }>("SELECT accountId, kind FROM v2_inbox ORDER BY id");
  assert.deepEqual(feed.filter((r) => r.kind === "squad_week").map((r) => r.accountId).sort(), [1, 2]);
  assert.deepEqual(feed.filter((r) => r.kind === "squad_pr").map((r) => r.accountId), [2], "not to the one who set it");
});
