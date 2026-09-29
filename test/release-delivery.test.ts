import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReleaseNote, releaseDueInApp, releaseRecipients } from "../src/domain/releaseDelivery";
import { latestRelease, RELEASE_NOTES } from "../src/releaseNotes";

const V = "2026-09-29";
const user = (extra: Record<string, unknown> = {}) => ({ onboarded: true, createdAt: new Date("2026-08-01T10:00:00Z"), ...extra });

test("in-app card: once per release, not after the chat got it, not for people who joined later", () => {
  assert.equal(releaseDueInApp(user(), V), true);
  assert.equal(releaseDueInApp(user({ reminders: { releaseSeen: V } }), V), false, "dismissed");
  assert.equal(releaseDueInApp(user({ reminders: { releaseSent: V } }), V), false, "already in the chat");
  assert.equal(releaseDueInApp(user({ reminders: { releaseSeen: "2026-09-09" } }), V), true, "an older dismissal doesn't count");
  assert.equal(releaseDueInApp(user({ createdAt: new Date("2026-09-30T08:00:00Z") }), V), false, "joined after the release");
  assert.equal(releaseDueInApp(user({ createdAt: new Date("2026-09-28T08:00:00Z") }), V), true, "joined on release day");
  assert.equal(releaseDueInApp(user({ onboarded: false }), V), false);
});

test("broadcast recipients: reachable, onboarded, not yet sent this version", () => {
  const users = [
    user({ id: 1 }),
    user({ id: 2, reminders: { releaseSent: V } }),
    user({ id: 3, blocked: true }),
    user({ id: 4, botBlocked: true }),
    user({ id: 5, onboarded: false }),
    user({ id: 6, reminders: { releaseSent: "2026-09-09", releaseSeen: V } }),
  ];
  assert.deepEqual(releaseRecipients(users, V).map((u) => (u as { id: number }).id), [1, 6], "seeing it in the app doesn't stop the chat message");
});

test("parseReleaseNote: one card per paragraph, greeting and bot-only closing line dropped", () => {
  const note = RELEASE_NOTES.find((n) => n.version === V)!;
  for (const text of [note.uk, note.en]) {
    const items = parseReleaseNote(text);
    assert.equal(items.length, 6);
    assert.ok(items.every((i) => i.icon && i.title && i.body), "every paragraph has the emoji *Title* — text shape");
    assert.ok(!items.some((i) => /\*/.test(i.title + i.body)), "markers stripped");
  }
  assert.equal(parseReleaseNote(note.uk)[0]!.title, "Бібліотека вправ");
  assert.equal(latestRelease().version, V);
  assert.deepEqual(parseReleaseNote("Hi\n\nPlain paragraph with no title."), [{ icon: "", title: "", body: "Plain paragraph with no title." }]);
});
