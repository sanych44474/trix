// Accountability buddy pairing asks the link's owner first. Opening t.me/<bot>?start=buddy_<A>
// used to pair the opener with A at once, so anyone could type any id and attach themselves to a
// stranger. Now the opener (B) sends a request, and only A's Accept pairs them.
//
// These tests drive real Telegram updates through createBot(): the middleware, launcherGate (with
// the app URL set, as in production) and the router. Outgoing Bot API calls are captured by an API
// transformer instead of going to the network.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { newDb } from "./harness";
import { createBot } from "../src/bot/router";
import { getOrCreateUser, getUser, updateUser } from "../src/adapters/d1/v2Users";
import { setAppUrl } from "../src/notify/appLinks";
import { buddyRequestIsFor, previousBuddies, BUDDY_REQUEST_TTL_MS } from "../src/domain/buddyRequest";
import type { Env, UserDoc } from "../src/types";

afterEach(() => setAppUrl(undefined));

interface Call { method: string; payload: Record<string, unknown> }

function harness(db: ReturnType<typeof newDb>) {
  const env = { DB: db, TELEGRAM_BOT_TOKEN: "test", BOT_ID: "999", BOT_USERNAME: "trixbot", WORKER_URL: "https://trix.example", V2_APP_ENABLED: "1" } as unknown as Env;
  const pending: Promise<unknown>[] = [];
  const bot = createBot(env, { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, passThroughOnException: () => {} } as unknown as ExecutionContext);
  const calls: Call[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    const chatId = (payload as { chat_id?: number }).chat_id ?? 0;
    return { ok: true, result: { message_id: 1, date: 0, chat: { id: chatId, type: "private" }, text: "" } } as never;
  });
  let updateId = 1;
  const from = (id: number) => ({ id, is_bot: false, first_name: `U${id}`, language_code: "en" });
  const chat = (id: number) => ({ id, type: "private" as const, first_name: `U${id}` });
  const run = async (update: Record<string, unknown>) => {
    await bot.handleUpdate({ update_id: updateId++, ...update } as never);
    await Promise.all(pending.splice(0));
  };
  return {
    calls,
    /** `id` opens /start <payload>. */
    start: (id: number, payload: string) => {
      const text = `/start ${payload}`;
      return run({ message: { message_id: updateId, date: 0, chat: chat(id), from: from(id), text, entities: [{ type: "bot_command", offset: 0, length: 6 }] } });
    },
    /** `id` taps an inline button carrying `data`. */
    tap: (id: number, data: string) =>
      run({ callback_query: { id: String(updateId), from: from(id), chat_instance: "ci", data, message: { message_id: 5, date: 0, chat: chat(id), text: "x" } } }),
    sentTo: (chatId: number) => calls.filter((c) => (c.method === "sendMessage" || c.method === "editMessageText") && c.payload.chat_id === chatId),
  };
}

async function athlete(db: ReturnType<typeof newDb>, id: number, name: string) {
  await getOrCreateUser(db, id, id, "en", name);
  await updateUser(db, id, { onboarded: true, profile: { name, chatRetired: true } });
}
const profileOf = async (db: ReturnType<typeof newDb>, id: number) => (await getUser(db, id))!.profile;
const buttons = (c: Call) =>
  ((c.payload.reply_markup as { inline_keyboard?: Array<Array<{ callback_data?: string }>> })?.inline_keyboard ?? []).flat().map((b) => b.callback_data).filter(Boolean);

test("B opens buddy_A: nobody is paired, A gets the request with Accept and Decline, B's request is stored", async () => {
  const db = newDb();
  await athlete(db, 1, "Anna");
  await athlete(db, 2, "Bohdan");
  const h = harness(db);
  await h.start(2, "buddy_1");

  assert.equal((await profileOf(db, 1)).buddyId, undefined);
  assert.equal((await profileOf(db, 2)).buddyId, undefined);
  const toA = h.sentTo(1);
  assert.equal(toA.length, 1, "A gets exactly one message");
  assert.match(String(toA[0]!.payload.text), /Bohdan/);
  assert.deepEqual(buttons(toA[0]!), ["bdy:ok:2", "bdy:no:2"]);
  const req = (await profileOf(db, 2)).buddyRequest;
  assert.equal(req?.to, 1);
  assert.ok(req && Date.now() - Date.parse(req.at) < 60_000);
  assert.ok(h.sentTo(2).some((c) => /Request sent/.test(String(c.payload.text))), "B is told the request was sent");
});

test("A accepts: both are paired, B's request is cleared and B is notified; old buddies are unlinked only when they point back", async () => {
  const db = newDb();
  await athlete(db, 1, "Anna");
  await athlete(db, 2, "Bohdan");
  await athlete(db, 3, "Olha"); // A's old buddy, pointing back at A
  await athlete(db, 4, "Petro"); // B's old buddy, already paired with someone else
  await athlete(db, 5, "Iryna");
  await updateUser(db, 1, { profile: { ...(await profileOf(db, 1)), buddyId: 3 } });
  await updateUser(db, 3, { profile: { ...(await profileOf(db, 3)), buddyId: 1 } });
  await updateUser(db, 2, { profile: { ...(await profileOf(db, 2)), buddyId: 4 } });
  await updateUser(db, 4, { profile: { ...(await profileOf(db, 4)), buddyId: 5 } });
  const h = harness(db);
  await h.start(2, "buddy_1");
  assert.equal((await profileOf(db, 1)).buddyId, 3, "the request alone touches nobody's buddy");
  assert.equal((await profileOf(db, 2)).buddyId, 4);

  await h.tap(1, "bdy:ok:2");
  assert.equal((await profileOf(db, 1)).buddyId, 2);
  assert.equal((await profileOf(db, 2)).buddyId, 1);
  assert.equal((await profileOf(db, 2)).buddyRequest, undefined);
  assert.equal((await profileOf(db, 3)).buddyId, undefined, "A's old buddy pointed back: unlinked");
  assert.equal((await profileOf(db, 4)).buddyId, 5, "B's old buddy had moved on: untouched");
  assert.ok(h.sentTo(2).some((c) => /accountability buddies with/.test(String(c.payload.text)) && /Anna/.test(String(c.payload.text))), "B is notified");
  assert.ok(h.sentTo(1).some((c) => /accountability buddies with/.test(String(c.payload.text)) && /Bohdan/.test(String(c.payload.text))), "A sees the confirmation");

  // The same button tapped again does nothing: the request is gone.
  await h.tap(1, "bdy:ok:2");
  assert.match(String(h.sentTo(1).at(-1)!.payload.text), /no longer valid/);
});

test("A declines: nobody is paired, the request is cleared and B is told", async () => {
  const db = newDb();
  await athlete(db, 1, "Anna");
  await athlete(db, 2, "Bohdan");
  const h = harness(db);
  await h.start(2, "buddy_1");
  await h.tap(1, "bdy:no:2");
  assert.equal((await profileOf(db, 1)).buddyId, undefined);
  assert.equal((await profileOf(db, 2)).buddyId, undefined);
  assert.equal((await profileOf(db, 2)).buddyRequest, undefined);
  assert.ok(h.sentTo(2).some((c) => /declined/.test(String(c.payload.text))), "B is told it was declined");
});

test("an Accept with an id that has no matching request pairs nobody", async () => {
  const db = newDb();
  await athlete(db, 1, "Anna");
  await athlete(db, 2, "Bohdan");
  await athlete(db, 3, "Olha");
  const h = harness(db);
  // No request at all: forged callback data.
  await h.tap(1, "bdy:ok:2");
  // A request that names someone else: 2 asked 3, but 1 taps Accept for 2.
  await h.start(2, "buddy_3");
  await h.tap(1, "bdy:ok:2");
  // An unknown account.
  await h.tap(1, "bdy:ok:777");
  for (const id of [1, 2, 3]) assert.equal((await profileOf(db, id)).buddyId, undefined, `user ${id}`);
  assert.equal((await profileOf(db, 2)).buddyRequest?.to, 3, "2's request to 3 is left alone");
  assert.match(String(h.sentTo(1).at(-1)!.payload.text), /no longer valid/);
});

test("B opens the same link twice: A gets one message, B is told it is already sent", async () => {
  const db = newDb();
  await athlete(db, 1, "Anna");
  await athlete(db, 2, "Bohdan");
  const h = harness(db);
  await h.start(2, "buddy_1");
  await h.start(2, "buddy_1");
  assert.equal(h.sentTo(1).length, 1);
  assert.ok(h.sentTo(2).some((c) => /already sent/.test(String(c.payload.text))));
});

test("an account the bot cannot message gets no request; B is told", async () => {
  const db = newDb();
  await athlete(db, 1, "Anna");
  await athlete(db, 2, "Bohdan");
  await updateUser(db, 1, { chatId: -4_000_000_000_001, botBlocked: true }); // email/Google sign-in
  const h = harness(db);
  await h.start(2, "buddy_1");
  assert.equal(h.calls.filter((c) => c.payload.chat_id === -4_000_000_000_001).length, 0);
  assert.equal((await profileOf(db, 2)).buddyRequest, undefined);
  assert.ok(h.sentTo(2).some((c) => /can't be reached/.test(String(c.payload.text))));
});

test("buddies already: B is told so and A is not asked", async () => {
  const db = newDb();
  await athlete(db, 1, "Anna");
  await athlete(db, 2, "Bohdan");
  await updateUser(db, 1, { profile: { ...(await profileOf(db, 1)), buddyId: 2 } });
  await updateUser(db, 2, { profile: { ...(await profileOf(db, 2)), buddyId: 1 } });
  const h = harness(db);
  await h.start(2, "buddy_1");
  assert.equal(h.sentTo(1).length, 0);
  assert.ok(h.sentTo(2).some((c) => /already buddies/.test(String(c.payload.text))));
});

test("buddyRequestIsFor: only a fresh request naming that account counts", () => {
  const now = new Date("2026-11-16T12:00:00Z");
  const at = (msAgo: number) => new Date(now.getTime() - msAgo).toISOString();
  assert.equal(buddyRequestIsFor({ to: 1, at: at(1000) }, 1, now), true);
  assert.equal(buddyRequestIsFor({ to: 1, at: at(1000) }, 3, now), false);
  assert.equal(buddyRequestIsFor(undefined, 1, now), false);
  assert.equal(buddyRequestIsFor({ to: 1, at: at(BUDDY_REQUEST_TTL_MS - 1000) }, 1, now), true);
  assert.equal(buddyRequestIsFor({ to: 1, at: at(BUDDY_REQUEST_TTL_MS + 1000) }, 1, now), false, "older than 7 days is gone");
  assert.equal(buddyRequestIsFor({ to: 1, at: "garbage" }, 1, now), false);
});

test("previousBuddies: each side's old buddy, never the new pair itself", () => {
  const p = (id: number, buddyId?: number) => ({ _id: id, profile: { buddyId } }) as unknown as UserDoc;
  assert.deepEqual(previousBuddies(p(1, 3), p(2, 4)), [{ oldId: 3, of: 1 }, { oldId: 4, of: 2 }]);
  assert.deepEqual(previousBuddies(p(1), p(2)), []);
  assert.deepEqual(previousBuddies(p(1, 2), p(2, 5)), [{ oldId: 5, of: 2 }], "a link to the new partner is not an old buddy");
});
