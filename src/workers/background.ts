const OFFSCREEN_DOCUMENT_PATH = "src/pages/offscreen/offscreen.html";

let creating: Promise<void> | null; // A promise that resolves when the offscreen document is created

// Function to create the offscreen document
async function setupOffscreenDocument(path: string) {
  // Check if we have an existing offscreen document
  const existingContexts = await (chrome.runtime as any).getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(path)],
  });

  if (existingContexts.length > 0) {
    return;
  }

  // create offscreen document
  if (creating) {
    await creating;
  } else {
    creating = (chrome.offscreen as any).createDocument({
      url: path,
      reasons: ["WORKERS"],
      justification: "Vector processing for search",
    });
    await creating;
    creating = null;
  }
}

// The main message handler for the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "offscreen") {
    return;
  }

  (async () => {
    await setupOffscreenDocument(OFFSCREEN_DOCUMENT_PATH);
    const response = await chrome.runtime.sendMessage(message);
    sendResponse(response);
  })();

  return true; // Indicates that the response will be sent asynchronously
});

console.log("Background script loaded.");
