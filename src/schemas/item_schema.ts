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
    | "github";
  folderId: string;
  isFavorite: boolean;
  authorUsername?: string;
  likes?: number;
  upvotes?: number;
  media?: {
    type: "image" | "video";
    originalUrl: string;
    storageType: "hotlink" | "opfs" | "s3";
    opfsPath?: string;
    s3Url?: string;
    expiresAt?: number;
  }[];
  parentId: string | null;
  chunkOrder?: number;
  vector_index?: number;
  isEmbedded: boolean;
  isDirty: boolean;
  serverVersion: number;
  createdAt: number;
  updatedAt: number;
};

export const itemSchema: RxJsonSchema<ItemDocType> = {
  title: "item schema",
  version: 0,
  description:
    "Describes a single saved item (bookmark, note, social media post)",
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
      ],
      maxLength: 20,
    },
    folderId: { type: "string", ref: "folders", maxLength: 1000 },
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
          type: { type: "string", enum: ["image", "video"] },
          originalUrl: { type: "string" },
          storageType: {
            type: "string",
            enum: ["hotlink", "opfs", "s3"],
          },
          opfsPath: { type: "string" },
          s3Url: { type: "string" },
          expiresAt: { type: "number" },
        },
      },
    },
    // Content Chunking
    parentId: { type: "string", ref: "items", default: null, maxLength: 100 },
    chunkOrder: { type: "number" },
    vector_index: {
      type: "number",
      multipleOf: 1,
      minimum: -1,
      maximum: 10000000,
    },
    // AI and Sync fields
    isEmbedded: { type: "boolean", default: false },
    isDirty: { type: "boolean", default: false },
    serverVersion: { type: "number", default: 0 },
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
  },
  required: [
    "id",
    "source",
    "createdAt",
    "updatedAt",
    "isFavorite",
    "isEmbedded",
    "isDirty",
    "folderId",
    "vector_index",
    "userId",
    "parentId",
  ],
  indexes: [
    "createdAt",
    "updatedAt",
    "source",
    "folderId",
    "isFavorite",
    "isEmbedded",
    "isDirty",
    "userId",
    "parentId",
    "vector_index",
  ],
  attachments: {},
};
