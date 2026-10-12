import { defineConfig, type Plugin } from "vite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

/** Emits sw.js with this build's file list (the precache) and a version derived from it, so a
 *  new deploy installs a new cache and drops the old one (sw.template.js). */
function serviceWorker(): Plugin {
  return {
    name: "trix-service-worker",
    apply: "build",
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith(".map")).sort();
      const version = createHash("sha256").update(files.join("|")).digest("hex").slice(0, 12);
      const source = readFileSync(new URL("./sw.template.js", import.meta.url), "utf8")
        .replace("__VERSION__", version)
        .replace("__ASSETS__", JSON.stringify(files));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

/** Preloads the Ukrainian strings chunk (most users) next to the entry, so the first render doesn't
 *  wait for a second round trip after main.tsx asks for the language. English users fetch theirs
 *  on demand as before; the extra ~24 KB for them downloads in parallel and is cached. */
function preloadDefaultLang(): Plugin {
  return {
    name: "trix-preload-lang",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const uk = Object.keys(bundle).find((f) => /^assets\/uk-[\w-]+\.js$/.test(f));
      const html = bundle["index.html"];
      if (!uk || !html || html.type !== "asset") return;
      html.source = String(html.source).replace("</head>", `  <link rel="modulepreload" crossorigin href="/app-v2/${uk}">\n  </head>`);
    },
  };
}

export default defineConfig({
  root,
  plugins: [react(), preloadDefaultLang(), serviceWorker()],
  base: "/app-v2/",
  // Preact's React-compatible layer instead of react-dom in the shipped bundle: ~55 KB gzip less on
  // the critical path (react-dom alone was ~60 of the entry's 80 KB). Only the build is aliased --
  // type-checking and the node tests keep the real React types and packages.
  resolve: {
    alias: [
      { find: /^react-dom\/client$/, replacement: "preact/compat/client" },
      { find: /^react-dom$/, replacement: "preact/compat" },
      { find: /^react\/jsx-runtime$/, replacement: "preact/jsx-runtime" },
      { find: /^react\/jsx-dev-runtime$/, replacement: "preact/jsx-dev-runtime" },
      { find: /^react$/, replacement: "preact/compat" },
    ],
  },
  build: {
    outDir: "../../public/app-v2",
    emptyOutDir: true,
    sourcemap: false,
  },
});
