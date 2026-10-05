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

export default defineConfig({
  root,
  plugins: [react(), serviceWorker()],
  base: "/app-v2/",
  build: {
    outDir: "../../public/app-v2",
    emptyOutDir: true,
    sourcemap: false,
  },
});
