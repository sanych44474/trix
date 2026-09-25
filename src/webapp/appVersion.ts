// Mini App cache-bust version — bumped whenever the served HTML changes so the ?v= in the
// dashboard button URL forces Telegram's 24h webview cache to refetch. Kept in its OWN tiny
// module so the Worker can import the version without pulling any HTML into its bundle — the
// page at /app is a static redirect stub emitted by scripts/build-webapp.mjs into
// public/app.html at deploy time, and is never referenced by the Worker runtime. (It used to be
// assembled from src/webapp/client/*, deleted once /app-v2 became the only served surface.)
export const APP_VERSION = 51;
