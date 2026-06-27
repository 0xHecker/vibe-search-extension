/** Clipboard copy format, configured in Settings → Misc. */
export type ClipboardFormat = "plain" | "markdown" | "json" | "html";

export const CLIPBOARD_FORMAT_STORAGE_KEY = "vibesearch:clipboardFormat";

export const CLIPBOARD_FORMATS: { value: ClipboardFormat; label: string }[] = [
  { value: "plain", label: "Plain text" },
  { value: "markdown", label: "Markdown" },
  { value: "json", label: "JSON" },
  { value: "html", label: "HTML" },
];

export const getClipboardFormat = (): ClipboardFormat => {
  try {
    const value = localStorage.getItem(CLIPBOARD_FORMAT_STORAGE_KEY);
    if (value === "plain" || value === "markdown" || value === "json" || value === "html") {
      return value;
    }
  } catch {
    /* ignore */
  }
  return "plain";
};

export const setClipboardFormat = (format: ClipboardFormat) => {
  try {
    localStorage.setItem(CLIPBOARD_FORMAT_STORAGE_KEY, format);
  } catch {
    /* ignore */
  }
};

export type ClipboardTab = { title?: string; url: string; tags?: string[] };

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Render tabs for the clipboard in the user's chosen format. */
export const formatTabsForClipboard = (tabs: ClipboardTab[], format: ClipboardFormat): string => {
  const rows = tabs.filter((tab) => tab && tab.url);
  switch (format) {
    case "markdown":
      return rows.map((tab) => `[${tab.title || tab.url}](${tab.url})`).join("\n");
    case "json":
      return JSON.stringify(
        rows.map((tab) => ({ title: tab.title || "", url: tab.url, tags: tab.tags || [] })),
        null,
        2
      );
    case "html":
      return rows.map((tab) => `<a href="${tab.url}">${escapeHtml(tab.title || tab.url)}</a>`).join("\n");
    case "plain":
    default:
      return rows.map((tab) => tab.url).join("\n");
  }
};

/** Sample output for the format preview popover. */
export const clipboardFormatPreview = (format: ClipboardFormat): string =>
  formatTabsForClipboard(
    [0, 1, 2].map((i) => ({ title: `title-${i}`, url: `https://example.com/${i}`, tags: [] })),
    format
  );
