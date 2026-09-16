import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  base: "/app-v2/",
  build: {
    outDir: "../../public/app-v2",
    emptyOutDir: true,
    sourcemap: false,
  },
});
