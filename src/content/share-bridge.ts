// Bridges the public share viewer page and the extension so a visitor can
// one-click import the shared snapshot. Injected only on the share viewer hosts
// (see manifest `content_scripts` matches). The content script and the page
// share the same `window`, so they communicate via `window.postMessage`.
//
// Security: the import always targets THIS page's own URL (the background reads
// `sender.url` and re-validates it against the share-host allowlist). The page
// cannot ask the extension to import an arbitrary URL — it can only ask to
// import the share it is currently displaying.

const ORIGIN = window.location.origin;
const FROM_EXTENSION = "vibesearch-extension";
const FROM_PAGE = "vibesearch-share-page";

const announcePresence = () => {
  window.postMessage({ source: FROM_EXTENSION, type: "EXTENSION_PRESENT" }, ORIGIN);
};

const postResult = (ok: boolean, error?: string) => {
  window.postMessage({ source: FROM_EXTENSION, type: "IMPORT_RESULT", ok, error }, ORIGIN);
};

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as { source?: string; type?: string } | null;
  if (!data || data.source !== FROM_PAGE) return;

  if (data.type === "PING") {
    announcePresence();
    return;
  }

  if (data.type === "IMPORT_SHARE") {
    try {
      chrome.runtime.sendMessage(
        { target: "background", type: "IMPORT_SHARED_LINK_FROM_PAGE" },
        (response?: { success?: boolean; error?: string }) => {
          const lastError = chrome.runtime.lastError?.message;
          const ok = !lastError && response?.success === true;
          postResult(ok, ok ? undefined : response?.error || lastError || "Import failed.");
        }
      );
    } catch (error) {
      postResult(false, error instanceof Error ? error.message : "Import failed.");
    }
  }
});

// Announce immediately; the page also PINGs on mount in case it loads later.
announcePresence();
