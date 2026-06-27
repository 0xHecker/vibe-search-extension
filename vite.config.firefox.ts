import { defineConfig, mergeConfig } from "vite";
import { crx, ManifestV3Export } from "@crxjs/vite-plugin";
import { resolve } from "path";

import baseConfig from "./vite.config.base";
import baseManifest from "./manifest.base.json";
import chromeManifest from "./manifest.chrome.json";
import { copyOrtWasm } from "./custom-vite-plugins";
import pkg from "./package.json";

const isDev = process.env.NODE_ENV !== "production";

const manifest: ManifestV3Export = {
  ...baseManifest,
  ...chromeManifest,
  version: pkg.version,
};

if (isDev) {
  manifest.name = "Vibesearch (Dev)";
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

const firefoxConfig = defineConfig({
  build: {
    outDir: resolve(__dirname, "dist_firefox"),
    sourcemap: isDev,
    emptyOutDir: !isDev,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        search: resolve(__dirname, "src/pages/search/index.html"),
        offscreen: resolve(__dirname, "src/pages/offscreen/offscreen.html"),
        ocrSandbox: resolve(__dirname, "src/pages/ocr-sandbox/index.html"),
      },
    },
  },
  plugins: [
    crx({
      manifest,
      // NOTE: intentionally still "chrome". A true Firefox MV3 build needs a
      // Firefox manifest (background.scripts instead of service_worker, plus
      // browser_specific_settings.gecko.id); crxjs errors trying to convert the
      // Chrome service_worker manifest. Until that exists this produces a
      // Chrome-target build in its own dir (no longer clobbering dist_chrome).
      browser: "chrome",
    }),
    copyOrtWasm(),
  ],
});

export default mergeConfig(baseConfig, firefoxConfig);
