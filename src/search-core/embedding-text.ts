import type { ItemDocType } from "@src/schemas/item_schema";

type EmbeddingTextSource = Pick<
  ItemDocType,
  "title" | "textContent" | "url" | "source" | "authorUsername" | "media"
>;

export const EMBEDDING_TEXT_VERSION = "v2-canonical";

const MAX_CONTENT_CHARS = 2200;
const MAX_QUERY_CHARS = 320;
const PATH_TOKEN_STOPWORDS = new Set([
  "amp",
  "api",
  "html",
  "htm",
  "index",
  "php",
  "aspx",
  "www",
  "utm",
  "ref",
  "src",
  "m",
]);
const URL_LIKE_TOKEN_REGEX = /(https?:\/\/[^\s]+|www\.[^\s]+)/i;

const normalizeWhitespace = (input: string): string =>
  input
    .replace(/\s+/g, " ")
    .trim();

const safeLower = (input: string): string => normalizeWhitespace(input).toLowerCase();

const tokenizePath = (pathname: string): string[] =>
  Array.from(
    new Set(
      pathname
        .replace(/\/+/g, "/")
        .replace(/\/$/, "")
        .toLowerCase()
        .split(/[\/._\-?&=+%#:]+/)
        .map((token) => token.trim())
        .filter(
          (token) =>
            token.length > 1 &&
            token.length <= 40 &&
            !/^\d+$/.test(token) &&
            !PATH_TOKEN_STOPWORDS.has(token)
        )
    )
  ).slice(0, 10);

const normalizeUrlParts = (
  rawUrl: string
): { hostname: string; pathname: string; pathTokens: string[] } => {
  if (!rawUrl) {
    return { hostname: "", pathname: "", pathTokens: [] };
  }

  const normalizedInput = normalizeWhitespace(rawUrl);
  const parse = (value: string): { hostname: string; pathname: string; pathTokens: string[] } => {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = parsed.pathname.replace(/\/+/g, "/").replace(/\/$/, "").toLowerCase();
    return {
      hostname,
      pathname,
      pathTokens: tokenizePath(pathname),
    };
  };

  try {
    return parse(normalizedInput);
  } catch {
    try {
      return parse(
        normalizedInput.startsWith("http://") || normalizedInput.startsWith("https://")
          ? normalizedInput
          : `https://${normalizedInput}`
      );
    } catch {
      return { hostname: "", pathname: "", pathTokens: tokenizePath(normalizedInput) };
    }
  }
};

const composeMediaHints = (media: ItemDocType["media"] | undefined): string =>
  Array.from(
    new Set(
      (media || [])
        .map((entry) => entry?.type)
        .filter((type): type is "image" | "video" | "audio" =>
          type === "image" || type === "video" || type === "audio"
        )
    )
  ).join(" ");

const trimContent = (input: string, limit: number): string => {
  const normalized = normalizeWhitespace(input);
  if (normalized.length <= limit) {
    return normalized;
  }
  return normalizeWhitespace(normalized.slice(0, limit));
};

const stripUrlLikeToken = (input: string): string =>
  normalizeWhitespace(input.replace(URL_LIKE_TOKEN_REGEX, " "));

const extractUrlLikeToken = (input: string): string | null => {
  const match = input.match(URL_LIKE_TOKEN_REGEX);
  return match?.[0] || null;
};

const composeHostnameTokens = (hostname: string): string => {
  if (!hostname) return "";
  const hostnameTokens = hostname
    .split(".")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 1 && !["com", "org", "net", "io", "co", "app", "dev"].includes(part));
  return Array.from(new Set(hostnameTokens)).join(" ");
};

export const composeQueryEmbeddingText = (query: string): string => {
  const normalized = trimContent(query || "", MAX_QUERY_CHARS);
  if (!normalized) return "";

  const urlToken = extractUrlLikeToken(normalized);
  const queryText = stripUrlLikeToken(normalized);
  const urlParts = urlToken ? normalizeUrlParts(urlToken) : { hostname: "", pathname: "", pathTokens: [] };

  return [
    queryText ? `query: ${queryText}` : "",
    urlParts.hostname ? `domain: ${urlParts.hostname}` : "",
    urlParts.pathTokens.length > 0 ? `path_terms: ${urlParts.pathTokens.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
};

export const composeEmbeddingText = (item: EmbeddingTextSource): string => {
  const title = trimContent(item.title || "", 220);
  const textContent = trimContent(item.textContent || "", MAX_CONTENT_CHARS);
  const author = safeLower((item.authorUsername || "").replace(/^@+/, ""));
  const source = safeLower(item.source || "");
  const { hostname, pathTokens } = normalizeUrlParts(item.url || "");
  const hostnameTerms = composeHostnameTokens(hostname);
  const mediaHints = composeMediaHints((item.media || []) as NonNullable<ItemDocType["media"]>);

  return [
    title ? `title: ${title}` : "",
    textContent ? `content: ${textContent}` : "",
    hostname ? `domain: ${hostname}` : "",
    hostnameTerms ? `domain_terms: ${hostnameTerms}` : "",
    pathTokens.length > 0 ? `path_terms: ${pathTokens.join(" ")}` : "",
    source ? `source: ${source}` : "",
    author ? `author: ${author}` : "",
    mediaHints ? `media: ${mediaHints}` : "",
  ]
    .filter(Boolean)
    .join("\n");
};
