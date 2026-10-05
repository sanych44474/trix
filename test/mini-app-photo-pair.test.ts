import { test } from "node:test";
import assert from "node:assert/strict";
import { pickPhotoPair, weightNear } from "../apps/mini-app/src/logic/photoPair";

test("pickPhotoPair: newest vs the one closest to a month before it", () => {
  const photos = [{ id: 1, takenAt: "2026-07-01" }, { id: 2, takenAt: "2026-09-04" }, { id: 3, takenAt: "2026-09-20" }, { id: 4, takenAt: "2026-10-05" }];
  assert.deepEqual(pickPhotoPair(photos), { before: photos[1], after: photos[3], days: 31 });
  assert.equal(pickPhotoPair([photos[0]!]), null);
  assert.equal(pickPhotoPair([{ id: 1, takenAt: "2026-10-05" }, { id: 2, takenAt: "2026-10-05T10:00:00Z" }]), null); // same day
});

test("weightNear: closest weigh-in within 3 days", () => {
  const pts = [{ date: "2026-09-02", kg: 76 }, { date: "2026-09-05", kg: 75.6 }, { date: "2026-10-04", kg: 74.1 }];
  assert.equal(weightNear(pts, "2026-09-04"), 75.6);
  assert.equal(weightNear(pts, "2026-10-05"), 74.1);
  assert.equal(weightNear(pts, "2026-09-20"), undefined);
});
