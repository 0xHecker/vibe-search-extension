/**
 * Preference for opening VibeSearch on the browser's new-tab page. Stored in
 * chrome.storage.local so the background service worker can read it too. We do
 * NOT override the new tab in the manifest — a background redirect lets the
 * native new tab stay intact when this is turned off.
 */
export const OPEN_ON_NEW_TAB_STORAGE_KEY = "vibesearch:openOnNewTab";

export const isOpenOnNewTabEnabled = async (): Promise<boolean> => {
  try {
    const result = await chrome.storage.local.get(OPEN_ON_NEW_TAB_STORAGE_KEY);
    return result?.[OPEN_ON_NEW_TAB_STORAGE_KEY] === true;
  } catch {
    return false;
  }
};

export const setOpenOnNewTab = async (enabled: boolean): Promise<void> => {
  try {
    await chrome.storage.local.set({ [OPEN_ON_NEW_TAB_STORAGE_KEY]: enabled });
  } catch {
    /* ignore */
  }
};
