// D1 repository barrel. The actual queries live in db/repos/*.ts, split by concept (users,
// trainer, plans, workouts, catalog, nutrition, tracking, admin); this file re-exports all of
// them so every existing `from "../db/repos"` / `from "./db/repos"` import across the codebase
// keeps working unchanged. See db/repos/shared.ts for the small dependency-free helpers
// (nowIso, buildUpdate) the split files use to avoid importing back through this barrel.
export * from "./repos/shared";
export * from "./repos/users";
export * from "./repos/trainer";
export * from "./repos/plans";
export * from "./repos/workouts";
export * from "./repos/catalog";
export * from "./repos/nutrition";
export * from "./repos/tracking";
export * from "./repos/admin";
