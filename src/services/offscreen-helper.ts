export const OFFSCREEN_DOCUMENT_PATH = "src/pages/offscreen/offscreen.html";

let creating: Promise<void> | null = null;

export async function setupOffscreenDocument(): Promise<void> {
  const existingContexts = await (chrome.runtime as any).getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
  });

  if (existingContexts.length > 0) {
    return;
  }

  if (creating) {
    await creating;
  } else {
    creating = (chrome.offscreen as any).createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ["WORKERS"],
      justification: "Persistent OPFS access for vector processing",
    });
    await creating;
    creating = null;
  }
}
