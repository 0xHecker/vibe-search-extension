import { expect, test } from "bun:test";
import { collectMetadataPendingUrls } from "@src/services/local-extension-migration";

test("collectMetadataPendingUrls selects only unfetched http(s) items", () => {
  const urls = collectMetadataPendingUrls([
    { url: "https://example.com/a", isMetaFetched: false },
    { url: "https://example.com/b", isMetaFetched: true }, // already enriched -> skip
    { url: "http://example.com/c", isMetaFetched: false },
    { url: "chrome://extensions", isMetaFetched: false }, // non-http -> skip
    { url: "", isMetaFetched: false }, // empty -> skip
    { isMetaFetched: false }, // no url -> skip
  ]);
  expect(urls).toEqual(["https://example.com/a", "http://example.com/c"]);
});

test("collectMetadataPendingUrls dedupes repeated URLs", () => {
  const urls = collectMetadataPendingUrls([
    { url: "https://dup.com/x", isMetaFetched: false },
    { url: "https://dup.com/x", isMetaFetched: false },
  ]);
  expect(urls).toEqual(["https://dup.com/x"]);
});

test("collectMetadataPendingUrls treats missing isMetaFetched as pending", () => {
  const urls = collectMetadataPendingUrls([{ url: "https://nometa.com" }]);
  expect(urls).toEqual(["https://nometa.com"]);
});

test("collectMetadataPendingUrls skips direct resources", () => {
  const urls = collectMetadataPendingUrls([
    { url: "https://cdn.example.com/image.png", isMetaFetched: false },
    { url: "https://files.example.com/report.pdf", isMetaFetched: false },
    { url: "https://example.com/article", isMetaFetched: false },
  ]);
  expect(urls).toEqual(["https://example.com/article"]);
});
