import { useEffect } from "react";

/**
 * While `active` is true, intercepts a tab reload/close with the browser's
 * native "Leave site?" confirmation.
 *
 * Bulk imports (bookmarks, GitHub stars, JSON/Drive restore) run in the
 * offscreen document and background service worker, so the data write itself
 * survives a page reload. But reloading still abandons this page's progress UI
 * and completion toast, and fully closing the tab/browser can interrupt
 * in-flight offscreen writes and the background metadata pass. This guard turns
 * an accidental reload into a deliberate choice.
 *
 * Note: browsers intentionally ignore custom text here and show their own
 * generic message; only triggering the prompt is under our control.
 */
export const useBeforeUnloadGuard = (active: boolean): void => {
  useEffect(() => {
    if (!active) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome/Safari require a returnValue to be set for the prompt to show.
      event.returnValue = "";
      return "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [active]);
};
