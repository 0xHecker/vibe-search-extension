import { describe, expect, test } from "bun:test";
import {
  filterMetadataFetchableUrls,
  isLikelyDirectResourceUrl,
  isMetadataFetchableUrl,
} from "@src/utils/metadata-url";

describe("metadata URL classification", () => {
  test("allows normal web pages to enter the metadata pipeline", () => {
    expect(isMetadataFetchableUrl("https://example.com/article")).toBe(true);
    expect(isMetadataFetchableUrl("https://example.com/posts/42?ref=image.jpg")).toBe(true);
  });

  test("skips direct media and document resources", () => {
    expect(isLikelyDirectResourceUrl("https://cdn.example.com/cat.JPG?size=large")).toBe(true);
    expect(isMetadataFetchableUrl("https://cdn.example.com/cat.JPG?size=large")).toBe(false);
    expect(isMetadataFetchableUrl("https://videos.example.com/clip.mp4")).toBe(false);
    expect(isMetadataFetchableUrl("https://files.example.com/paper.pdf#page=2")).toBe(false);
  });

  test("filters invalid, extension, and blocked URLs", () => {
    expect(
      filterMetadataFetchableUrls(
        [
          "https://example.com/page",
          "https://example.com/file.pdf",
          "chrome://extensions",
          "https://local.vibesearch.invalid/import/web/1",
        ],
        { blockedHosts: ["local.vibesearch.invalid"] }
      )
    ).toEqual(["https://example.com/page"]);
  });
});
