import type { ItemDocType } from "@src/schemas/item_schema";

type EmbeddingTextSource = Pick<
  ItemDocType,
  "title" | "textContent" | "ocrText" | "url" | "source" | "authorUsername" | "media"
>;

export const EMBEDDING_TEXT_VERSION = "v7-mdbr-leaf-ir-media-text";

const MAX_CONTENT_CHARS = 2200;
const MAX_OCR_CHARS = 12000;
const MAX_MEDIA_TEXT_CHARS = 6000;
const MAX_QUERY_CHARS = 320;
// mdbr-leaf-ir is a BERT model with a hard 512-token context; the tokenizer
// truncates anything longer, so each composed chunk stays comfortably under it.
const EMBEDDING_MODEL_MAX_TOKENS = 512;
const EMBEDDING_CHUNK_TOKEN_BUDGET = Math.floor(EMBEDDING_MODEL_MAX_TOKENS * 0.25);
// Body chunk size in "token-like" units (words + punctuation). Kept below the
// model's 512 sub-word limit once the prefix and WordPiece expansion are added,
// so passages are embedded without silent tail truncation.
const MIN_BODY_CHUNK_TOKEN_BUDGET = 300;
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
const TOKEN_LIKE_REGEX = /[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu;

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

const trimContent = (input: string, limit: number): string => {
  const normalized = normalizeWhitespace(input);
  if (normalized.length <= limit) {
    return normalized;
  }
  return normalizeWhitespace(normalized.slice(0, limit));
};

const splitTokenLike = (input: string): string[] => normalizeWhitespace(input).match(TOKEN_LIKE_REGEX) || [];

const countTokenLike = (input: string): number => splitTokenLike(input).length;

const chunkTextByTokenBudget = (input: string, budget: number): string[] => {
  const normalized = normalizeWhitespace(input);
  if (!normalized) return [];

  const maxTokens = Math.max(1, Math.floor(budget));
  const paragraphs = normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  const flush = () => {
    const text = normalizeWhitespace(current.join("\n\n"));
    if (text) chunks.push(text);
    current = [];
    currentTokens = 0;
  };

  const pushPart = (part: string) => {
    const tokens = countTokenLike(part);
    if (tokens <= maxTokens) {
      if (currentTokens > 0 && currentTokens + tokens > maxTokens) flush();
      current.push(part);
      currentTokens += tokens;
      return;
    }

    flush();
    const words = part.split(/\s+/).filter(Boolean);
    let segment: string[] = [];
    let segmentTokens = 0;
    for (const word of words) {
      const wordTokens = Math.max(1, countTokenLike(word));
      if (segmentTokens > 0 && segmentTokens + wordTokens > maxTokens) {
        chunks.push(normalizeWhitespace(segment.join(" ")));
        segment = [];
        segmentTokens = 0;
      }
      segment.push(word);
      segmentTokens += wordTokens;
    }
    if (segment.length > 0) chunks.push(normalizeWhitespace(segment.join(" ")));
  };

  for (const paragraph of paragraphs.length > 0 ? paragraphs : [normalized]) {
    pushPart(paragraph);
  }
  flush();

  return chunks;
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

const collectUniqueTextParts = (parts: Array<string | undefined>, limit: number): string[] => {
  const out: string[] = [];
  const keys: string[] = [];
  for (const part of parts) {
    const text = trimContent(part || "", limit);
    if (!text) continue;
    const key = safeLower(text);
    if (keys.some((existing) => existing.includes(key) || key.includes(existing))) continue;
    keys.push(key);
    out.push(text);
  }
  return out;
};

const composeMediaEmbeddingText = (media: EmbeddingTextSource["media"]): string => {
  const parts: Array<string | undefined> = [];
  for (const entry of media || []) {
    parts.push(entry.altText, entry.titleText, entry.ariaLabel, entry.pageTitle, entry.siteName);
    if (entry.ocr?.status === "done") parts.push(entry.ocr.text);
  }
  return collectUniqueTextParts(parts, MAX_MEDIA_TEXT_CHARS).join("\n\n");
};

// mdbr-leaf-ir is an asymmetric IR model: queries are prefixed with the
// retrieval prompt below, while passages/documents are embedded with no prefix
// (see composeEmbeddingTexts). Both still share a single representation space,
// so the prompt is the only query/passage difference.
export const QUERY_EMBEDDING_PROMPT =
  "Represent this sentence for searching relevant passages: ";

export const composeQueryEmbeddingText = (query: string): string => {
  const normalized = trimContent(query || "", MAX_QUERY_CHARS);
  if (!normalized) return "";

  const urlToken = extractUrlLikeToken(normalized);
  const queryText = stripUrlLikeToken(normalized);
  const urlParts = urlToken ? normalizeUrlParts(urlToken) : { hostname: "", pathname: "", pathTokens: [] };
  const hostnameTerms = composeHostnameTokens(urlParts.hostname);

  const composed = [queryText, hostnameTerms, urlParts.pathTokens.join(" ")]
    .filter(Boolean)
    .join("\n");
  return composed ? `${QUERY_EMBEDDING_PROMPT}${composed}` : "";
};

// Content-first, no field labels. `source`/media are hard filters elsewhere,
// not semantic signal; including them as repeated tokens on every document
// inflated baseline cosine similarity and collapsed result separation.
export const composeEmbeddingText = (item: EmbeddingTextSource): string => {
  return composeEmbeddingTexts(item)[0] || "";
};

export const composeEmbeddingTexts = (item: EmbeddingTextSource): string[] => {
  const title = trimContent(item.title || "", 220);
  const textContent = trimContent(item.textContent || "", MAX_CONTENT_CHARS);
  const ocrText = trimContent(item.ocrText || "", MAX_OCR_CHARS);
  const mediaText = composeMediaEmbeddingText(item.media);
  const author = safeLower((item.authorUsername || "").replace(/^@+/, ""));
  const { hostname, pathTokens } = normalizeUrlParts(item.url || "");
  const hostnameTerms = composeHostnameTokens(hostname);
  const prefix = [title, hostnameTerms, pathTokens.join(" "), author].filter(Boolean).join("\n");
  const body = collectUniqueTextParts([textContent, ocrText, mediaText], MAX_OCR_CHARS).join("\n\n");
  const bodyBudget = Math.max(
    MIN_BODY_CHUNK_TOKEN_BUDGET,
    EMBEDDING_CHUNK_TOKEN_BUDGET - countTokenLike(prefix)
  );
  const bodyChunks = chunkTextByTokenBudget(body, bodyBudget);

  if (bodyChunks.length === 0) {
    const fallback = [prefix, item.url || ""].filter(Boolean).join("\n");
    return fallback ? [fallback] : [];
  }

  return bodyChunks.map((chunk) => [prefix, chunk].filter(Boolean).join("\n"));
};
