// Minimal entry point for the vitest-plugin pool's `main` (see vitest.config.ts). Deliberately
// NOT src/index.ts -- these tests exercise db/repos/* and the scheduler's Durable Objects
// directly, not the fetch/scheduled handlers or the webapp routes, so there's no reason to pull
// those in. Durable Object classes under test ARE re-exported here: Miniflare can only construct
// instances of a DO class defined in the `main` Worker.
export { UserSchedulerDO } from "../../src/durable/userScheduler";
export { SquadSchedulerDO } from "../../src/durable/squadScheduler";
export { GlobalSchedulerDO } from "../../src/durable/globalScheduler";

export default {
  async fetch() {
    return new Response("test stub", { status: 200 });
  },
};
