import { describe, expect, test } from "bun:test";
import { ocrService } from "@src/services/ocr.service";
import type { ItemDocType } from "@src/schemas/item_schema";

const makeItem = (overrides: Partial<ItemDocType>): ItemDocType =>
  ({
    id: "item-1",
    folderId: "folder-1",
    url: "https://example.com/page",
    title: "Example",
    textContent: "",
    source: "web",
    media: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }) as ItemDocType;

describe("OCR image candidates", () => {
  test("uses the stored S3 copy instead of OCRing both S3 and original image URLs", () => {
    const item = makeItem({
      displayImageUrl: "https://metadata-worker.watermelons.workers.dev/r2/images/copy.png",
      media: [
        {
          type: "image",
          storageType: "s3",
          s3Url: "https://metadata-worker.watermelons.workers.dev/r2/images/copy.png",
          originalUrl: "https://example.com/image.png",
        },
      ],
    });

    expect(ocrService.getImageCandidates(item).map((candidate) => candidate.source)).toEqual(["s3"]);
  });

  test("prefers OPFS over uploaded and hotlink representations for a saved screenshot", () => {
    const item = makeItem({
      media: [
        {
          type: "image",
          storageType: "opfs",
          opfsPath: "media/item-1/screenshot.png",
          s3Url: "https://metadata-worker.watermelons.workers.dev/r2/images/screenshot.png",
          originalUrl: "screenshot.png",
        },
      ],
    });

    expect(ocrService.getImageCandidates(item)).toEqual([
      expect.objectContaining({
        source: "opfs",
        url: "media/item-1/screenshot.png",
      }),
    ]);
  });

  test("keeps a display image candidate when media entries are absent", () => {
    const item = makeItem({
      displayImageUrl: "https://example.com/preview.png",
      media: [],
    });

    expect(ocrService.getImageCandidates(item)).toEqual([
      expect.objectContaining({
        source: "display",
        url: "https://example.com/preview.png",
      }),
    ]);
  });
});
