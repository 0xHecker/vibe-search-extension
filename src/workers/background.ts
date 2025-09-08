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

// --- Periodic Sync Alarm ---
const SYNC_ALARM_NAME = "vector-sync-alarm";

// Create the alarm when the extension is installed or updated.
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(SYNC_ALARM_NAME, {
    periodInMinutes: 6 * 60, // Run every 6 hours
  });
});

// Listen for the alarm and send a message to the offscreen document to trigger the sync.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM_NAME) {
    console.log("Periodic sync alarm triggered. Sending message to offscreen document.");
    (async () => {
      await setupOffscreenDocument(OFFSCREEN_DOCUMENT_PATH);
      chrome.runtime.sendMessage({
        service: "sync",
        type: "rebuildAndCompact",
        target: "offscreen",
        isForwarded: true,
      });
    })();
  }
});

// The main message handler for the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Ignore messages that are not targeted for the offscreen document or that have already been forwarded.
  if (message.target !== "offscreen" || message.isForwarded) {
    return;
  }

  (async () => {
    try {
      // In development, ensure the offscreen document is fresh so updated services are available
      try {
        if ((import.meta as any)?.env?.MODE === "development") {
          await (chrome.offscreen as any).closeDocument?.();
        }
      } catch (e) {
        // ignore if not supported
      }

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
