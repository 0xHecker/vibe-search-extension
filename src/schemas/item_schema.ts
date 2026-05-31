import { RxJsonSchema } from "rxdb";

export type ItemDocType = {
  id: string;
  userId: string | null;
  title: string;
  textContent: string;
  url: string;
  source:
    | "web"
    | "twitter"
    | "reddit"
    | "note"
    | "youtube"
    | "instagram"
    | "tiktok"
    | "substack"
    | "linkedin"
    | "github"
    | "article";
  folderId: string;
  spaceId: string;
  isFavorite: boolean;
  authorUsername?: string;
  likes?: number;
  upvotes?: number;
  media?: {
    type: "image" | "video" | "audio";
    originalUrl: string;
    storageType: "hotlink" | "opfs" | "s3";
    opfsPath?: string;
    s3Url?: string;
    expiresAt?: number;
    altText?: string;
    titleText?: string;
    ariaLabel?: string;
    pageUrl?: string;
    pageTitle?: string;
    siteName?: string;
    faviconUrl?: string;
    width?: number;
    height?: number;
    capturedAt?: number;
  }[];
  iconUrl?: string;
  displayImageUrl?: string;
  parentId: string | null;
  chunkOrder?: number;
  vector_index?: number;
  isEmbedded: boolean;
  isMetaFetched: boolean;
  isDirty: boolean;
  serverVersion: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number;
};

export const itemSchema: RxJsonSchema<ItemDocType> = {
  title: "item schema",
  version: 3,
  description: "Describes a single saved item (bookmark, note, social media post)",
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    userId: { type: "string", default: null, maxLength: 1000 },
    title: { type: "string" },
    textContent: { type: "string" },
    url: { type: "string" },
    source: {
      type: "string",
      enum: [
        "web",
        "twitter",
        "reddit",
        "note",
        "youtube",
        "instagram",
        "tiktok",
        "substack",
        "linkedin",
        "github",
        "article",
      ],
      maxLength: 20,
    },
    folderId: { type: "string", ref: "folders", maxLength: 1000 },
    spaceId: { type: "string", default: "space_public_default", maxLength: 1000 },
    isFavorite: { type: "boolean", default: false },
    // Social media specific fields
    authorUsername: { type: "string" },
    likes: { type: "number" },
    upvotes: { type: "number" },
    media: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["image", "video", "audio"] },
          originalUrl: { type: "string" },
          storageType: {
            type: "string",
            enum: ["hotlink", "opfs", "s3"],
          },
          opfsPath: { type: "string" },
          s3Url: { type: "string" },
          expiresAt: { type: "number" },
          altText: { type: "string" },
          titleText: { type: "string" },
          ariaLabel: { type: "string" },
          pageUrl: { type: "string" },
          pageTitle: { type: "string" },
          siteName: { type: "string" },
          faviconUrl: { type: "string" },
          width: { type: "number" },
          height: { type: "number" },
          capturedAt: { type: "number" },
        },
      },
    },
    // Content Chunking
    parentId: { type: ["string", "null"], ref: "items", default: null, maxLength: 100 },
    chunkOrder: { type: "number" },
    vector_index: {
      type: "number",
      multipleOf: 1,
      minimum: -1,
      maximum: 10000000,
    },
    // AI and Sync fields
    isEmbedded: { type: "boolean", default: false },
    isMetaFetched: { type: "boolean", default: false },
    isDirty: { type: "boolean", default: false },
    serverVersion: { type: "number", default: 0 },
    iconUrl: { type: "string" },
    displayImageUrl: { type: "string" },
    // Timestamps
    createdAt: {
      type: "integer",
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER - 1,
      multipleOf: 1,
    },
    updatedAt: {
      type: "integer",
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER - 1,
      multipleOf: 1,
    },
    deletedAt: {
      type: "number",
      default: 0,
      multipleOf: 1,
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER - 1,
    },
  },
  required: [
    "id",
    "source",
    "createdAt",
    "updatedAt",
    "isFavorite",
    "isEmbedded",
    "isMetaFetched",
    "isDirty",
    "folderId",
    "spaceId",
    "vector_index",
    "userId",
    "deletedAt",
  ],
  indexes: [
    "createdAt",
    "updatedAt",
    "source",
    "folderId",
    "spaceId",
    "isFavorite",
    "isEmbedded",
    "isMetaFetched",
    "isDirty",
    "userId",
    "vector_index",
    "deletedAt",
  ],
  attachments: {},
};
