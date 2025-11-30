export const getCurrentWindowId = async (): Promise<number | undefined> => {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs?.[0]?.windowId;
  } catch {
    return undefined;
  }
};

export const openUrlsInNewWindow = async (urls: string[]): Promise<void> => {
  const validUrls = urls.filter(Boolean);
  if (validUrls.length === 0) return;
  await chrome.windows.create({ url: validUrls });
};

export const openUrlsInCurrentWindow = async (urls: string[]): Promise<void> => {
  const windowId = await getCurrentWindowId();
  const validUrls = urls.filter(Boolean);
  if (!windowId || validUrls.length === 0) return;
  await Promise.all(
    validUrls.map((url, idx) => chrome.tabs.create({ url, windowId, active: idx === 0 }))
  );
};

export const openUrlsInNewTabGroup = async (urls: string[], title?: string): Promise<void> => {
  const windowId = await getCurrentWindowId();
  const validUrls = urls.filter(Boolean);
  if (!windowId || validUrls.length === 0) return;
  const createdTabs = await Promise.all(
    validUrls.map((url, idx) => chrome.tabs.create({ url, windowId, active: idx === 0 }))
  );
  const tabIds = createdTabs.map((t) => t.id).filter((id): id is number => typeof id === "number");
  if (tabIds.length > 0) {
    const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
    try {
      const safeTitle =
        title && title.trim().length > 0 ? title.trim() : `${validUrls.length} tabs`;
      console.log("updating tab group title", groupId, safeTitle);
      await chrome.tabGroups?.update?.(groupId, { title: safeTitle });
    } catch {
      // ignore if tabGroups API not available
    }
  }
};
