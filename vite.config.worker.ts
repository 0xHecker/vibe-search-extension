// vite.config.worker.ts (NEW FILE)

import { defineConfig } from "vite";
import { resolve } from "path";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  build: {
    outDir: resolve(__dirname, "dist_chrome/src/workers"),
    lib: {
      entry: resolve(__dirname, "src/workers/vector-processing.worker.ts"),
      formats: ["iife"],
      name: "VectorProcessingWorker",
      fileName: () => "vector-processing.worker.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
    emptyOutDir: false,
  },
});
