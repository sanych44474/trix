// Every notification the Android app posts must open the app when tapped. The "rest is over"
// notification (RestOverWorker) was built without a content intent, so tapping it did nothing
// (tester report). Android's Gradle cannot run here, so this checks the source wiring.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dir = "mobile/androidApp/src/main/kotlin/app/hacklimits/android";

test("the rest-over notification opens the workout when tapped", () => {
  const src = readFileSync(`${dir}/AndroidStores.kt`, "utf8");
  const worker = src.slice(src.indexOf("class RestOverWorker"));
  assert.match(worker, /\.setContentIntent\(openIntent\(applicationContext, "train", REST_NOTIFICATION_ID\)\)/);
});

test("every notification builder in the app sets a content intent", () => {
  for (const file of ["AndroidStores.kt", "Push.kt"]) {
    const src = readFileSync(`${dir}/${file}`, "utf8");
    const builders = src.match(/NotificationCompat\.Builder\(/g)?.length ?? 0;
    const intents = src.match(/\.setContentIntent\(/g)?.length ?? 0;
    assert.equal(intents, builders, `${file}: ${builders} builders, ${intents} content intents`);
  }
});

test("the view the rest notification opens is a known route", () => {
  const app = readFileSync("mobile/shared/src/commonMain/kotlin/app/hacklimits/shared/App.kt", "utf8");
  assert.match(app, /"train" -> LoggerRoute/);
});
