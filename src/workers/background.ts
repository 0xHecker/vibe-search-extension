import { scheduleForProcessing } from "@src/services/metadata-pipeline";
import { setupOffscreenDocument, OFFSCREEN_DOCUMENT_PATH } from "@src/services/offscreen-helper";

// --- Alarms ---
const SYNC_ALARM_NAME = "vector-sync-alarm";
const EMBEDDING_ALARM_NAME = "embedding-alarm";

// Create the alarms when the extension is installed or updated.
chrome.runtime.onInstalled.addListener(() => {
  // For periodic vector store compaction
  chrome.alarms.create(SYNC_ALARM_NAME, {
    periodInMinutes: 6 * 60, // Run every 6 hours
  });
  // For periodic embedding of new/dirty items
  chrome.alarms.create(EMBEDDING_ALARM_NAME, {
    periodInMinutes: 5, // Run every 5 minutes to catch any missed embeddings
  });
});

chrome.runtime.onStartup.addListener(() => {
  // Trigger embedding check on startup
  (async () => {
    await setupOffscreenDocument();
    chrome.runtime.sendMessage({
      type: "TRIGGER_EMBEDDING",
      target: "offscreen",
      isForwarded: true,
    });
  })();
});

// Listen for alarms and send messages to the offscreen document to trigger tasks.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM_NAME) {
    console.log("[Background] Periodic sync alarm triggered.");
    (async () => {
      await setupOffscreenDocument();
      chrome.runtime.sendMessage({
        service: "sync",
        type: "rebuildAndCompact",
        target: "offscreen",
        isForwarded: true,
      });
    })();
  } else if (alarm.name === EMBEDDING_ALARM_NAME) {
    console.log("[Background] Periodic embedding alarm triggered.");
    (async () => {
      await setupOffscreenDocument();
      chrome.runtime.sendMessage({
        type: "TRIGGER_EMBEDDING",
        target: "offscreen",
        isForwarded: true,
      });
    })();
  }
});

// The main message handler for the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === "background" && message.type === "FETCH_METADATA") {
    const { urls, revalidate } = message.payload || { urls: [], revalidate: false };
    scheduleForProcessing(urls, revalidate === true);
    return;
  }

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

      await setupOffscreenDocument();

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
