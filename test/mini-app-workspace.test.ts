import { test } from "node:test";
import assert from "node:assert/strict";
import { noteFieldKey, OWNER_REPORT_SECTIONS, OWNER_TABS, plainReport, showWhen, statusKey, toInstant, workspaceSpaces } from "../apps/mini-app/src/logic/workspace";
import { en } from "../apps/mini-app/src/i18n/en";

test("workspace spaces: every role keeps every surface it qualifies for, owner first", () => {
  assert.deepEqual(workspaceSpaces("client", false).map((s) => s.id), ["social"]);
  assert.deepEqual(workspaceSpaces("trainer", false).map((s) => s.id), ["trainer", "social"]);
  assert.deepEqual(workspaceSpaces("client", true).map((s) => s.id), ["owner", "social"]);
  assert.deepEqual(workspaceSpaces("trainer", true).map((s) => s.id), ["owner", "trainer", "social"]);
});

test("session status maps to its label, unknown status reads as planned", () => {
  assert.equal(statusKey("done"), "session_status_done");
  assert.equal(statusKey("cancelled"), "session_status_cancelled");
  assert.equal(statusKey("no_show"), "session_status_no_show");
  assert.equal(statusKey("planned"), "session_status_planned");
  assert.equal(statusKey("whatever"), "session_status_planned");
});

test("schedule times: a datetime-local value becomes an ISO instant and shows back as minutes", () => {
  const iso = toInstant("2026-10-06T18:30");
  assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
  assert.equal(new Date(iso).getTime(), new Date("2026-10-06T18:30").getTime());
  assert.equal(showWhen("2026-10-06T18:30:00.000Z"), "2026-10-06 18:30");
});

test("owner reports: Telegram HTML is flattened to plain text, entities decoded", () => {
  assert.equal(plainReport("<b>Users</b>&nbsp;12 &amp; <i>3</i> new"), " Users  12 &  3  new");
  assert.equal(plainReport("<pre>a\n b</pre>"), " a\n b ");
});

test("note history: known fields map to their labels, unknown fields stay raw", () => {
  assert.equal(noteFieldKey("healthNotes"), "field_health_notes");
  assert.equal(noteFieldKey("personalNotes"), "field_personal_notes");
  assert.equal(noteFieldKey("note"), "coach_note_title");
  assert.equal(noteFieldKey("goal"), null);
});

test("owner console: every report section has a tab, tab ids are unique, labels exist", () => {
  const tabIds = OWNER_TABS.map((t) => t.id);
  assert.equal(new Set(tabIds).size, tabIds.length);
  for (const s of OWNER_REPORT_SECTIONS) assert.ok(tabIds.includes(s.id), `no tab for ${s.id}`);
  for (const t of OWNER_TABS) assert.ok(t.id === "roster" || t.id === "feedback" || OWNER_REPORT_SECTIONS.some((s) => s.id === t.id), `tab ${t.id} has no section`);
  const keys = new Set(Object.keys(en));
  for (const s of OWNER_REPORT_SECTIONS) for (const k of [s.tab, s.eyebrow, s.title]) assert.ok(keys.has(k), `missing i18n key ${k}`);
  for (const t of OWNER_TABS) assert.ok(keys.has(t.tab), `missing i18n key ${t.tab}`);
});
