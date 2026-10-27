// GET /app used to serve the legacy vanilla-JS Mini App shell from src/webapp/client/*. That
// source was removed after /app-v2 became the only live surface. This script emits a small
// redirect so old bookmarks and cached links still land in the React app. Restoring the legacy
// app would require restoring its source from Git history and redeploying; it is not a live
// rollback path.
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
<title>Hack Limits</title>
<script>location.replace("/app-v2" + location.search + location.hash);</script>
</head>
<body>
<p>This page has moved. <a href="/app-v2">Open Hack Limits</a>.</p>
</body>
</html>
`;

const outDir = join(root, "public");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "app.html"), page);
console.log(`built public/app.html (${page.length} bytes) -- redirect to /app-v2, legacy UI retired`);
