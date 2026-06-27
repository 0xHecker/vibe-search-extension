import { describe, expect, test } from "bun:test";
import {
  chunkUrlsForMetadataRequest,
  getMetadataPipelineStats,
  scheduleForProcessing,
} from "../src/services/metadata-pipeline";

const withFakeChrome = async (
  run: (messages: any[]) => void | Promise<void>
): Promise<void> => {
  const previousChrome = (globalThis as any).chrome;
  const messages: any[] = [];
  (globalThis as any).chrome = {
    runtime: {
      getContexts: async () => [],
      getURL: (path: string) => `chrome-extension://test/${path}`,
      sendMessage: async (message: any) => {
        messages.push(message);
        return { success: true };
      },
    },
    offscreen: {
      createDocument: async () => undefined,
    },
  };

  try {
    await run(messages);
  } finally {
    if (previousChrome === undefined) {
      delete (globalThis as any).chrome;
    } else {
      (globalThis as any).chrome = previousChrome;
    }
  }
};

describe("metadata pipeline batching safeguards", () => {
  test("keeps a very long URL instead of dropping it for a cache-key limit", () => {
    const normalUrl = "https://example.com/article";
    const oversizedUrl = `https://example.com/search?${"q=".repeat(7_000)}`;
    const batches = chunkUrlsForMetadataRequest([normalUrl, oversizedUrl]);

    expect(batches.flat()).toEqual([normalUrl, oversizedUrl]);
    expect(batches).toEqual([[normalUrl], [oversizedUrl]]);
  });

  test("isolates long URLs so they cannot inflate a normal request batch", () => {
    const urls = [
      "https://example.com/a",
      `https://example.com/search?${"long-param=".repeat(1_500)}`,
      "https://example.com/b",
    ];
    const batches = chunkUrlsForMetadataRequest(urls);

    expect(batches).toEqual([[urls[0]], [urls[1]], [urls[2]]]);
    expect(batches.flat()).toEqual(urls);
  });

  test("skips direct resources while marking matching local records metadata-complete", async () => {
    await withFakeChrome(async (messages) => {
      const before = getMetadataPipelineStats().scheduledUrls;
      scheduleForProcessing([
        "https://cdn.example.com/image.png",
        "https://files.example.com/report.pdf",
      ]);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(getMetadataPipelineStats().scheduledUrls).toBe(before);
      expect(messages).toHaveLength(1);
      expect(messages[0].payload.metaMap).toEqual({
        "https://cdn.example.com/image.png": { isMetaFetched: true },
        "https://files.example.com/report.pdf": { isMetaFetched: true },
      });
    });
  });
});
