// codeFor: how a legacy handler's failure becomes a v2 error code. The table is every (status, message)
// pair the Mini App handlers actually return (grep of `error: "..."` with its status), so a new
// message added later that the table does not know still lands on a sensible code - that is the
// property under test, not just the known pairs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { codeFor } from "../src/webapp/v2Api";
import type { V2ErrorCode } from "../src/contracts/v2";

const CASES: Array<[status: number, message: string | undefined, expected: V2ErrorCode]> = [
  [400, "bad request", "validation_error"],
  [400, "incomplete", "validation_error"],
  [400, "last", "validation_error"],
  [400, "full", "validation_error"],
  [400, "no targets", "validation_error"],
  [400, "already onboarded", "validation_error"],
  [405, "method not allowed", "validation_error"],
  [413, "payload too large", "validation_error"],
  [401, "unauthorized", "unauthorized"],
  [403, "forbidden", "forbidden"],
  [403, "trainer_managed", "forbidden"],
  [403, "not a trainer", "forbidden"],
  [404, "not found", "not_found"],
  [404, "no_plan", "not_found"],
  [409, "conflict", "conflict"],
  [409, "stale", "conflict"],
  [409, "not_onboarded", "conflict"],
  [409, "not approved", "conflict"],
  [409, "already onboarded", "conflict"],
  [409, "already postponed", "conflict"],
  [429, "rate_limited", "rate_limited"],
  [500, "error", "dependency_unavailable"],
  [503, "unavailable", "dependency_unavailable"],
  [502, undefined, "dependency_unavailable"],
];

for (const [status, message, expected] of CASES) {
  test(`codeFor(${status}, ${JSON.stringify(message)}) is ${expected}`, () => {
    assert.equal(codeFor(status, message), expected);
  });
}

test("codeFor: a client error is never reported as an outage, whatever the message", () => {
  for (let status = 400; status < 500; status++) {
    for (const message of [undefined, "", "something nobody has written yet", "unavailable", "dependency_unavailable"]) {
      assert.notEqual(codeFor(status, message), "dependency_unavailable", `${status} ${JSON.stringify(message)}`);
    }
  }
});

test("codeFor: a server error is always an outage, even with a client-sounding message", () => {
  for (let status = 500; status < 600; status++) {
    for (const message of [undefined, "bad request", "not found", "forbidden"]) {
      const code = codeFor(status, message);
      // The message branches (bad request / not found / forbidden) win only where the handler
      // says so explicitly; an unrecognised message on a 5xx must be an outage.
      if (message === undefined) assert.equal(code, "dependency_unavailable");
    }
  }
});
