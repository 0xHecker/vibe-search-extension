import { describe, expect, test } from "bun:test";
import manifest from "../manifest.base.json";

describe("extension CSP", () => {
  test("allows bundled local WASM data in the extension and OCR sandbox", () => {
    const csp = manifest.content_security_policy;

    expect(csp.extension_pages).toContain("connect-src 'self' data:");
    expect(csp.sandbox).toContain("connect-src 'self' data:");
  });
});
