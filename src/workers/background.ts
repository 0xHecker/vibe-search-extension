const OFFSCREEN_DOCUMENT_PATH = "src/pages/offscreen/offscreen.html";

let creating: Promise<void> | null; // A promise that resolves when the offscreen document is created

async function setupOffscreenDocument(path: string) {
  const existingContexts = await (chrome.runtime as any).getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(path)],
  });

  if (existingContexts.length > 0) {
    return;
  }

  if (creating) {
    await creating;
  } else {
    creating = (chrome.offscreen as any).createDocument({
      url: path,
      reasons: ["WORKERS"],
      justification: "Persistent OPFS access for vector processing",
    });
    await creating;
    creating = null;
  }
}

// The main message handler for the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Do not process messages that are not targeted for the offscreen document.
  if (message.target !== "offscreen") {
    return;
  }

  // This is a forwarded message that the offscreen document should handle.
  // We can resolve the promise with `undefined` to avoid a warning.
  if (message.isForwarded) {
    return Promise.resolve(undefined);
  }

  (async () => {
    try {
      await setupOffscreenDocument(OFFSCREEN_DOCUMENT_PATH);

      // Forward the message to the offscreen document and await the response.
      const response = await chrome.runtime.sendMessage({
        ...message,
        isForwarded: true, // Add a flag to prevent re-processing
      });

      // Send the response back to the original sender (e.g., the UI tab).
      sendResponse(response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
      console.error("Error in background script message handler:", error);
      sendResponse({ success: false, error: errorMessage });
    }
  })();

  // Return true to indicate that the response will be sent asynchronously.
  return true;
});

console.log("Background script loaded with improved message handling.");
