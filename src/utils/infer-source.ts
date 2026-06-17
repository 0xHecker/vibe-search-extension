import type { ItemDocType } from "@src/schemas/item_schema";

const getHostname = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    try {
      return new URL(`https://${url}`).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
};

// Classify an item's source from its URL host. Single source of truth for all save flows.
export const inferSource = (url: string | null | undefined): ItemDocType["source"] => {
  const host = getHostname(url);
  if (!host) return "web";
  if (host.includes("x.com") || host.includes("twitter.com")) return "twitter";
  if (host.includes("reddit.com")) return "reddit";
  if (host.includes("youtube.com") || host.includes("youtu.be")) return "youtube";
  if (host.includes("instagram.com")) return "instagram";
  if (host.includes("tiktok.com")) return "tiktok";
  if (host.includes("substack.com")) return "substack";
  if (host.includes("linkedin.com")) return "linkedin";
  if (host.includes("github.com")) return "github";
  if (host.includes("medium.com") || host.includes("dev.to")) return "article";
  return "web";
};
