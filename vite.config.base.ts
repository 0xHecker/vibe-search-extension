// import react from "@vitejs/plugin-react";
// import { resolve } from "path";
// import { ManifestV3Export } from "@crxjs/vite-plugin";
// import tailwindcss from "@tailwindcss/vite";
// import { defineConfig, BuildOptions } from "vite";
// import tsconfigPaths from "vite-tsconfig-paths";
// import { stripDevIcons, crxI18n } from "./custom-vite-plugins";
// import manifest from "./manifest.json";
// import devManifest from "./manifest.dev.json";
// import pkg from "./package.json";

// const isDev = process.env.__DEV__ === "true";
// // set this flag to true, if you want localization support
// const localize = false;

// export const baseManifest = {
//   ...manifest,
//   version: pkg.version,
//   ...(isDev
//     ? {
//         ...devManifest,
//         content_security_policy: {
//           extension_pages: manifest.content_security_policy.extension_pages,
//         },
//       }
//     : ({} as ManifestV3Export)),
//   ...(localize
//     ? {
//         name: "__MSG_extName__",
//         description: "__MSG_extDescription__",
//         default_locale: "en",
//       }
//     : {}),
// } as ManifestV3Export;

// export const baseBuildOptions: BuildOptions = {
//   sourcemap: isDev,
//   emptyOutDir: !isDev,
// };

// export default defineConfig({
//   plugins: [
//     tailwindcss(),
//     tsconfigPaths(),
//     react(),
//     stripDevIcons(isDev),
//     crxI18n({ localize, src: "./src/locales" }),
//   ],
//   optimizeDeps: {
//     include: ["@xenova/transformers"],
//   },
//   publicDir: resolve(__dirname, "public"),
//   resolve: {
//     alias: {
//       "@src": resolve(__dirname, "src"),
//       "@assets/*": "src/assets/*",
//       "@locales/*": "src/locales/*",
//       "@pages/*": "src/pages/*",
//     },
//   },
// });

// // build: {
// //   rollupOptions: {
// //     input: {
// //       mainPage: resolve(__dirname, "src/pages/main/index.html"),
// //       main: resolve(__dirname, "src/main.ts"),
// //       search: resolve(__dirname, "src/pages/search/index.html"),
// //       "vector-processing-worker": resolve(
// //         __dirname,
// //         "src/workers/vector-processing.worker.ts"
// //       ),
// //     },
// //     output: {
// //       entryFileNames: (chunkInfo) => {
// //         if (chunkInfo.name.includes("worker")) {
// //           return `src/workers/[name].js`;
// //         }
// //         return `src/pages/[name]/index.js`;
// //       },
// //       chunkFileNames: `assets/js/[name].js`,
// //       assetFileNames: `assets/css/[name].[ext]`,
// //     },
// //   },
// // },

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { resolve } from "path";
import { stripDevIcons, crxI18n } from "./custom-vite-plugins";

const isDev = process.env.NODE_ENV !== "production";
const localize = false;

export default defineConfig({
  plugins: [
    tailwindcss(),
    tsconfigPaths(),
    react(),
    stripDevIcons(isDev),
    crxI18n({ localize, src: "./src/locales" }),
  ],
  optimizeDeps: {
    include: ["@xenova/transformers"],
  },
  publicDir: resolve(__dirname, "public"),
  resolve: {
    alias: {
      "@src": resolve(__dirname, "src"),
      "@assets/*": "src/assets/*",
      "@locales/*": "src/locales/*",
      "@pages/*": "src/pages/*",
    },
  },
});
