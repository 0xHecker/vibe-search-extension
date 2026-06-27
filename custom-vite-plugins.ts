import fs from "fs";
import { resolve } from "path";
import type { PluginOption } from "vite";

// plugin to remove dev icons from prod build
export function stripDevIcons(isDev: boolean) {
  if (isDev) return null;

  return {
    name: "strip-dev-icons",
    resolveId(source: string) {
      return source === "virtual-module" ? source : null;
    },
    renderStart(outputOptions: any, inputOptions: any) {
      const outDir = outputOptions.dir;
      fs.rm(resolve(outDir, "dev-icon-32.png"), () =>
        console.log(`Deleted dev-icon-32.png from prod build`)
      );
      fs.rm(resolve(outDir, "dev-icon-128.png"), () =>
        console.log(`Deleted dev-icon-128.png from prod build`)
      );
    },
  };
}

// plugin to support i18n
export function crxI18n(options: {
  localize: boolean;
  src: string;
}): PluginOption {
  if (!options.localize) return null;

  const getJsonFiles = (dir: string): Array<string> => {
    const files = fs.readdirSync(dir, { recursive: true }) as string[];
    return files.filter((file) => !!file && file.endsWith(".json"));
  };
  const entry = resolve(__dirname, options.src);
  const localeFiles = getJsonFiles(entry);
  const files = localeFiles.map((file) => {
    const json = JSON.parse(fs.readFileSync(resolve(entry, file), "utf-8"));
    const source = Object.entries(json).reduce((acc, [key, value]) => {
      return {
        ...acc,
        [key]: {
          message: value,
        },
      };
    }, {});

    return {
      id: "",
      fileName: file,
      source: JSON.stringify(source),
    };
  });
  return {
    name: "crx-i18n",
    enforce: "pre",
    buildStart: {
      order: "post",
      handler() {
        files.forEach((file) => {
          const refId = this.emitFile({
            type: "asset",
            source: file.source,
            fileName: "_locales/" + file.fileName,
          });
          file.id = refId;
        });
      },
    },
  };
}

// Ship onnxruntime-web's wasm assets same-origin (chrome-extension://<id>/ort/).
// The embedding worker pins device "wasm", so only the asyncify build is loaded.
// Without same-origin assets, transformers.js fetches the ORT factory from the
// jsdelivr CDN and wraps it in a blob: URL, which the MV3 extension CSP
// (script-src 'self') blocks — breaking model init in the offscreen worker.
export function copyOrtWasm(): PluginOption {
  const ORT_FILES = [
    "ort-wasm-simd-threaded.asyncify.mjs",
    "ort-wasm-simd-threaded.asyncify.wasm",
  ];
  let outDir = "";
  return {
    name: "copy-ort-wasm",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    writeBundle() {
      const srcDir = resolve(__dirname, "node_modules/onnxruntime-web/dist");
      const destDir = resolve(outDir, "ort");
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of ORT_FILES) {
        const from = resolve(srcDir, file);
        if (!fs.existsSync(from)) {
          this.warn(`[copy-ort-wasm] missing source file: ${from}`);
          continue;
        }
        fs.copyFileSync(from, resolve(destDir, file));
      }
      // Do not prune the ORT wasm files Vite emits into /assets. The OCR
      // sandbox's bundled onnxruntime code contains concrete hashed references
      // to those files; deleting any of them can surface as "no available
      // backend / wasm fetch failed" when PaddleOCR initializes.
    },
  };
}
