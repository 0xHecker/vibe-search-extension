export const PUBLIC_SPACE_ID = "space_public_default";
export const PRIVATE_SPACE_ID = "space_private_default";

export const PUBLIC_SPACE_NAME = "Public";
export const PRIVATE_SPACE_NAME = "Private";

export const DEFAULT_PRIVATE_AUTO_LOCK_MS = 5 * 60 * 1000;
export const PRIVATE_PASSWORD_MIN_LENGTH = 8;

export const normalizeSpaceName = (value: string): string => {
  return value.trim().replace(/\s+/g, " ").slice(0, 80);
};

export const slugifySpaceName = (value: string): string => {
  return normalizeSpaceName(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
};
