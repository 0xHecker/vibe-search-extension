export type MetadataPreferenceKey = "title" | "description" | "image";

export type DomainMetadataPreference = Partial<Record<MetadataPreferenceKey, string[]>>;

const stripWhitespace = (value: string): string => value.trim();

export const DEFAULT_METADATA_PREFERENCES: Record<MetadataPreferenceKey, string[]> = {
  title: ["ogTitle", "twitterTitle", "title"],
  description: ["ogDescription", "twitterDescription", "description"],
  image: ["twitterImage", "ogImage", "image"],
};

const DOMAIN_METADATA_PREFERENCES: Record<string, DomainMetadataPreference> = {
  "instagram.com": {
    title: ["twitterTitle", "ogTitle", "title"],
    description: ["twitterDescription", "ogDescription", "description"],
    image: ["twitterImage", "ogImage", "image"],
  },
};

const normalizeHostname = (host: string): string => host.toLowerCase().replace(/^www\./, "");

const getBaseDomain = (host: string): string => {
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  return parts.slice(-2).join(".");
};

export const getPreferencesForHost = (host: string): DomainMetadataPreference => {
  const normalized = normalizeHostname(host);
  return (
    DOMAIN_METADATA_PREFERENCES[normalized] ||
    DOMAIN_METADATA_PREFERENCES[getBaseDomain(normalized)] ||
    {}
  );
};

export const pickStringField = (
  entry: Record<string, any>,
  fields: string[]
): string | undefined => {
  for (const field of fields) {
    const value = entry[field];
    if (typeof value === "string") {
      const trimmed = stripWhitespace(value);
      if (trimmed) return trimmed;
    }
  }
  return undefined;
};

const getImageUrl = (val: any): string | undefined => {
  if (!val) return undefined;
  if (Array.isArray(val) && val.length > 0 && val[0] && typeof val[0].url === "string") {
    return val[0].url;
  }
  if (typeof val === "object" && !Array.isArray(val) && val.url && typeof val.url === "string") {
    return val.url;
  }
  if (typeof val === "string") {
    return val;
  }
  return undefined;
};

export const pickImageField = (
  entry: Record<string, any>,
  fields: string[]
): string | undefined => {
  for (const field of fields) {
    const candidate = getImageUrl(entry[field]);
    if (candidate) return candidate;
  }
  return undefined;
};

export const registerDomainMetadataPreference = (
  domain: string,
  preference: DomainMetadataPreference
) => {
  DOMAIN_METADATA_PREFERENCES[normalizeHostname(domain)] = preference;
};
