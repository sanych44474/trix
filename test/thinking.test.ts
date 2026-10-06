import { test } from "node:test";
import assert from "node:assert/strict";
import { startThinking } from "../src/adapters/telegram/thinking";

const ctxWith = (api: Record<string, unknown>, type = "private") => ({ chat: { id: 7, type }, api } as never);

test("startThinking: shows the native draft placeholder (empty text) once, then stops", async () => {
  const calls: unknown[][] = [];
  const stop = startThinking(ctxWith({ sendMessageDraft: async (...a: unknown[]) => { calls.push(a); return true; }, sendChatAction: async () => true }));
  await new Promise((r) => setTimeout(r, 10));
  stop.stop();
  assert.equal(calls.length, 1);
  assert.equal(calls[0]![0], 7);
  assert.ok((calls[0]![1] as number) > 0);
  assert.equal(calls[0]![2], "");
});

test("startThinking: falls back to typing when drafts fail; nothing in group chats", async () => {
  let typing = 0;
  const stop = startThinking(ctxWith({ sendMessageDraft: async () => { throw new Error("400"); }, sendChatAction: async () => { typing++; return true; } }));
  await new Promise((r) => setTimeout(r, 10));
  stop.stop();
  assert.equal(typing, 1);
  let any = 0;
  startThinking(ctxWith({ sendMessageDraft: async () => { any++; return true; } }, "group")).stop();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(any, 0);
});

test("startThinking: update() streams the text into the same draft, throttled", async () => {
  const drafts: Array<[number, string]> = [];
  const t = startThinking(ctxWith({ sendMessageDraft: async (_c: number, id: number, text: string) => { drafts.push([id, text]); return true; }, sendChatAction: async () => true }));
  await new Promise((r) => setTimeout(r, 10));
  t.update("Bench");
  t.update("Bench went");
  t.update("Bench went well");
  await new Promise((r) => setTimeout(r, 900));
  t.stop();
  assert.equal(drafts[0]![1], ""); // Thinking… placeholder first
  assert.equal(drafts.at(-1)![1], "Bench went well"); // latest text wins, intermediate ones coalesced
  assert.ok(drafts.length <= 3);
  assert.ok(drafts.every(([id]) => id === drafts[0]![0])); // one draft, animated in place
});
