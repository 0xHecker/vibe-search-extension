import { RxJsonSchema } from "rxdb";

export type FolderDocType = {
  id: string;
  name: string;
  spaceId: string;
  parentId: string | null;
  type: "folder" | "tab_group";
  sortOrder: number;
  isLocked: boolean;
  isPinned: boolean;
  isCollapsed: boolean;
  encryptionKey?: string;
  isDirty: boolean;
  serverVersion: number;
  createdAt: number;
  updatedAt: number;
  userId: string;
};

export const folderSchema: RxJsonSchema<FolderDocType> = {
  title: "folder schema",
  version: 6,
  description: "Describes a folder for organizing items or a group of tabs",
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    userId: { type: "string", default: "", maxLength: 1000 },
    name: { type: "string" },
    spaceId: { type: "string", default: "space_public_default", maxLength: 1000 },
    parentId: {
      type: ["string", "null"],
      ref: "folders",
      default: null,
      maxLength: 1000,
    },
    isPinned: { type: "boolean", default: false },
    isCollapsed: { type: "boolean", default: false },
    type: {
      type: "string",
      enum: ["folder", "tab_group"],
      default: "folder",
      maxLength: 50,
    },
    sortOrder: {
      type: "integer",
      multipleOf: 1,
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER - 1,
      default: 0,
    },
    // Security
    isLocked: { type: "boolean", default: false },
    encryptionKey: { type: "string" }, // Stores a derived key, not the raw password
    // Sync fields
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
    "name",
    "spaceId",
    "type",
    "createdAt",
    "updatedAt",
    "isDirty",
    "parentId",
    "userId",
    "isPinned",
    "isCollapsed",
    "sortOrder",
  ],
  indexes: ["isDirty", "userId", "spaceId", "type", "isPinned", "isCollapsed", "sortOrder"],
};
