/**
 * Cloudflare Worker composition root.
 *
 * The implementation stays in `src/` during the staged migration so legacy tests and the
 * Telegram adapter keep their stable imports. This file is the deploy seam for the target
 * `apps/worker` layout; all runtime exports are still assembled by the existing Worker root.
 */
export { default, GlobalSchedulerDO, SquadSchedulerDO, UserSchedulerDO } from "../../src/index";
