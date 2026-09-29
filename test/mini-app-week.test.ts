import { test } from "node:test";
import assert from "node:assert/strict";
import { unseenBadges } from "../apps/mini-app/src/logic/badgesSeen";

test("badge celebration: first run records silently, later runs show only new badges", () => {
  assert.deepEqual(unseenBadges(["first_workout", "streak_4"], null), { show: [], seen: ["first_workout", "streak_4"] });
  const later = unseenBadges(["first_workout", "streak_4", "all_in_range"], JSON.stringify(["first_workout", "streak_4"]));
  assert.deepEqual(later.show, ["all_in_range"]);
  assert.deepEqual(later.seen, ["first_workout", "streak_4", "all_in_range"]);
  assert.deepEqual(unseenBadges(["a"], JSON.stringify(["a"])).show, []);
  assert.deepEqual(unseenBadges(["a"], "{not json").show, [], "corrupt storage counts as a first run");
});
