import { describe, expect, test } from "bun:test";
import { composeEmbeddingTexts, EMBEDDING_TEXT_VERSION } from "@src/search-core/embedding-text";

describe("embedding text composition", () => {
  test("includes saved text, top-level OCR, and media OCR/metadata", () => {
    const [text] = composeEmbeddingTexts({
      title: "Captured post",
      textContent: "Saved note from the page",
      ocrText: "Top-level screenshot OCR",
      url: "https://x.com/example/status/123",
      source: "twitter",
      authorUsername: "alice",
      media: [
        {
          type: "image",
          originalUrl: "https://cdn.example.com/image.png",
          storageType: "hotlink",
          altText: "Chart showing revenue",
          pageTitle: "Quarterly update",
          siteName: "Example",
          ocr: {
            status: "done",
            text: "Media-level OCR table",
          },
        },
      ],
    });

    expect(text).toContain("Captured post");
    expect(text).toContain("Saved note from the page");
    expect(text).toContain("Top-level screenshot OCR");
    expect(text).toContain("Chart showing revenue");
    expect(text).toContain("Quarterly update");
    expect(text).toContain("Media-level OCR table");
  });

  test("dedupes media OCR already present in top-level OCR", () => {
    const chunks = composeEmbeddingTexts({
      title: "Image text",
      textContent: "",
      ocrText: "Repeated OCR text",
      url: "https://example.com/image.png",
      source: "web",
      authorUsername: "",
      media: [
        {
          type: "image",
          originalUrl: "https://example.com/image.png",
          storageType: "hotlink",
          ocr: {
            status: "done",
            text: "Repeated OCR text",
          },
        },
      ],
    });

    expect(chunks.join("\n").match(/Repeated OCR text/g)).toHaveLength(1);
  });

  test("version bump schedules existing records for the expanded embedding text", () => {
    expect(EMBEDDING_TEXT_VERSION).toBe("v7-mdbr-leaf-ir-media-text");
  });
});
