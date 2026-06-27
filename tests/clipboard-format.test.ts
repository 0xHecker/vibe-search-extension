import { describe, expect, test } from "bun:test";
import {
  clipboardFormatPreview,
  formatTabsForClipboard,
} from "@src/pages/search/components/settings/clipboard-format";

describe("clipboard format", () => {
  const tabs = [
    { title: "A", url: "https://a.com" },
    { title: "B", url: "https://b.com" },
  ];

  test("plain text is one url per line", () => {
    expect(formatTabsForClipboard(tabs, "plain")).toBe("https://a.com\nhttps://b.com");
  });

  test("markdown is a link list", () => {
    expect(formatTabsForClipboard(tabs, "markdown")).toBe("[A](https://a.com)\n[B](https://b.com)");
  });

  test("html is an anchor list", () => {
    expect(formatTabsForClipboard(tabs, "html")).toBe(
      '<a href="https://a.com">A</a>\n<a href="https://b.com">B</a>'
    );
  });

  test("json is an array of {title,url,tags}", () => {
    expect(JSON.parse(formatTabsForClipboard(tabs, "json"))).toEqual([
      { title: "A", url: "https://a.com", tags: [] },
      { title: "B", url: "https://b.com", tags: [] },
    ]);
  });

  test("html escapes the title", () => {
    expect(formatTabsForClipboard([{ title: "a & <b>", url: "https://x.com" }], "html")).toBe(
      '<a href="https://x.com">a &amp; &lt;b&gt;</a>'
    );
  });

  test("preview reflects the chosen format", () => {
    expect(clipboardFormatPreview("markdown")).toContain("[title-0](https://example.com/0)");
    expect(JSON.parse(clipboardFormatPreview("json"))[0]).toEqual({
      title: "title-0",
      url: "https://example.com/0",
      tags: [],
    });
  });
});
