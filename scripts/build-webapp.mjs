// GET /app used to serve the legacy vanilla-JS Mini App shell, assembled from
// src/webapp/client/* (see git history for the assembly logic this replaced). The React Mini
// App at /app-v2 is now the sole live surface (V2_APP_ENABLED=1 is the committed default; every
// bot link/notification already points at /app-v2 -- see src/bot.ts's dashboardUrl() and
// src/scheduler.ts's appView()). This script now emits a tiny static redirect instead of
// building the legacy shell, so an old bookmark, cached deep link, or stale notification still
// lands the user in the app instead of a dead page -- rather than deleting src/webapp/client/*
// outright, which stays as the rollback path (restore this file's previous assembly logic from
// git history if /app-v2 ever needs to be rolled back).
//
// Query string is preserved (?view=... / ?startapp=...): App.tsx's viewFromLocation() reads the
// same "view"/"startapp" params the legacy shell used, with the same alias table, so an old deep
// link resolves to the equivalent v2 screen.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>trix</title>
<script>location.replace("/app-v2" + location.search + location.hash);</script>
</head>
<body>
<p>This page has moved. <a href="/app-v2">Open trix</a>.</p>
</body>
</html>
`;

const outDir = join(root, "public");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "app.html"), page);
console.log(`built public/app.html (${page.length} bytes) -- redirect to /app-v2, legacy UI retired`);
