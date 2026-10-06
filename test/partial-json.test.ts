import { test } from "node:test";
import assert from "node:assert/strict";
import { partialJsonString } from "../src/domain/partialJson";

test("partialJsonString: grows with the stream, decodes escapes, stops at a cut escape", () => {
  assert.equal(partialJsonString('{"rep', "reply"), null);
  assert.equal(partialJsonString('{"reply": "Bench went', "reply"), "Bench went");
  assert.equal(partialJsonString('{"reply":"Line 1\\nLine \\"2\\"', "reply"), 'Line 1\nLine "2"');
  assert.equal(partialJsonString('{"reply":"Жим \\u0436', "reply"), "Жим ж");
  assert.equal(partialJsonString('{"reply":"cut \\', "reply"), "cut ");
  assert.equal(partialJsonString('{"reply":"cut \\u04', "reply"), "cut ");
  assert.equal(partialJsonString('{"reply":"done.","actions":[]}', "reply"), "done.");
});
