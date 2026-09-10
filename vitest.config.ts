// Second, independent test pool that runs against REAL D1 inside workerd (via Miniflare),
// instead of the hand-rolled in-memory harness `test/harness.ts` builds on node:sqlite. That
// harness is close to D1's semantics but isn't D1 -- it can't promise `res.meta.changes` on an
// INSERT/DELETE or `db.batch()` atomicity actually match. Reach for THIS pool specifically when
// a test depends on real-D1 behavior the harness can't guarantee; the two pools coexist on
// purpose (`npm test` vs `npm run test:workers`) rather than a wholesale migration of the
// existing 480+ node:test tests, which don't need workerd fidelity to be correct.
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
      return {
        // A minimal stub, NOT src/index.ts: these tests bind D1 directly and never call a
        // handler, so there's no reason to drag the whole app (every AI provider, every webapp
        // route) into the test isolate.
        main: path.join(import.meta.dirname, "test/vitest/worker-stub.ts"),
        miniflare: {
          // Deliberately NOT `wrangler: { configPath: "./wrangler.toml" }` here, even though
          // that's the usual "don't hand-copy config" move (src/types.ts's Env does exactly
          // that). Loading the real wrangler.toml pulls in its `[ai]` binding, and Workers AI
          // has no full local simulator -- Miniflare opens a REMOTE, authenticated proxy
          // session for it even when a test never touches env.AI, which fails outright without
          // CLOUDFLARE_API_TOKEN (and must never require prod credentials to run in CI). Only
          // the one binding these tests actually need is declared; compat date/flags below are
          // hand-kept in sync with wrangler.toml instead.
          d1Databases: ["DB"],
          durableObjects: {
            USER_SCHEDULER: { className: "UserSchedulerDO", useSQLite: true },
            SQUAD_SCHEDULER: { className: "SquadSchedulerDO", useSQLite: true },
            GLOBAL_SCHEDULER: { className: "GlobalSchedulerDO", useSQLite: true },
          },
          compatibilityDate: "2026-09-10", // keep in sync with wrangler.toml's compatibility_date
          compatibilityFlags: ["nodejs_compat"],
          // A syntactically-plausible but fake token: only the cutover ("real") branch of
          // each DO constructs a Bot with it, and only to prove the write path runs for
          // real -- the actual Telegram API call is expected to fail (invalid token), which
          // processUser/postSquadDigest/checkOwnerAlerts already catch and log, same as any
          // other delivery failure.
          bindings: { TEST_MIGRATIONS: migrations, TELEGRAM_BOT_TOKEN: "0:TEST" },
        },
      };
    }),
  ],
  test: {
    include: ["test/vitest/**/*.test.ts"],
    setupFiles: ["./test/vitest/apply-migrations.ts"],
    // Vitest's defaults (5s test / 10s hook) size for plain JS tests, not this pool: each of the
    // 8 test files spins up its OWN workerd/Miniflare instance (storage isolation is per file --
    // see the pool config comment above), and the apply-migrations.ts setup hook has to wait for
    // that boot before it can run applyD1Migrations. A cold CI runner comfortably clears the
    // defaults locally but can blow past them under load -- this is the leading suspect for a
    // deploy.yml run that failed this exact step while the identical commit passed it seconds
    // earlier in ci.yml. Generous, still bounded: a genuine hang still times out, just later.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
