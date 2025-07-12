import { defineConfig, mergeConfig } from "vite";
import { crx, ManifestV3Export } from "@crxjs/vite-plugin";
import { resolve } from "path";

import baseConfig from "./vite.config.base";
import baseManifest from "./manifest.base.json";
import chromeManifest from "./manifest.chrome.json";
import pkg from "./package.json";

const isDev = process.env.NODE_ENV !== "production";

const manifest: ManifestV3Export = {
  ...baseManifest,
  ...chromeManifest,
  version: pkg.version,
};

if (isDev) {
  manifest.name = "Cooperhire (Dev)";
  manifest.action = {
    ...manifest.action,
    default_icon: {
      "32": "public/dev-icon-32.png",
    },
  };
  manifest.icons = {
    "128": "public/dev-icon-128.png",
  };
}

const chromeConfig = defineConfig({
  build: {
    outDir: resolve(__dirname, "dist_chrome"),
    sourcemap: isDev,
    emptyOutDir: !isDev,
  },
  plugins: [
    crx({
      manifest,
      browser: "chrome",
    }),
  ],
});

export default mergeConfig(baseConfig, chromeConfig);
