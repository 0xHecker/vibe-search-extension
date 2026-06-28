import { expect, test } from "bun:test";
import { getOcrOrtWasmPaths } from "@src/services/ocr-runtime";

test("OCR runtime points ONNX at the bundled asyncify files", () => {
  expect(getOcrOrtWasmPaths("chrome-extension://abc/ocr-ort/")).toEqual({
    mjs: "chrome-extension://abc/ocr-ort/ort-wasm-simd-threaded.asyncify.mjs",
    wasm: "chrome-extension://abc/ocr-ort/ort-wasm-simd-threaded.asyncify.wasm",
  });
});

test("OCR runtime normalizes a base URL without a trailing slash", () => {
  expect(getOcrOrtWasmPaths("chrome-extension://abc/ocr-ort")).toEqual({
    mjs: "chrome-extension://abc/ocr-ort/ort-wasm-simd-threaded.asyncify.mjs",
    wasm: "chrome-extension://abc/ocr-ort/ort-wasm-simd-threaded.asyncify.wasm",
  });
});
