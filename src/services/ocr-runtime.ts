const OCR_ORT_WASM_FILE = "ort-wasm-simd-threaded.asyncify.wasm";
const OCR_ORT_MJS_FILE = "ort-wasm-simd-threaded.asyncify.mjs";

export const getOcrOrtWasmPaths = (baseUrl: string): { mjs: string; wasm: string } => {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return {
    mjs: `${base}${OCR_ORT_MJS_FILE}`,
    wasm: `${base}${OCR_ORT_WASM_FILE}`,
  };
};
