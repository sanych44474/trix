// Runs once per test FILE (storage isolation is per-file, not per-test — see
// isolation-and-concurrency in the Workers Vitest docs) before any test in that file. Applies
// every migration in migrations/ to the real D1 binding, the same way `wrangler d1 migrations
// apply --local` does for dev.
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll } from "vitest";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
