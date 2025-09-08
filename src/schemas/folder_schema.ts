import { RxJsonSchema } from "rxdb";

export type FolderDocType = {
  id: string;
  name: string;
  parentId: string | null;
  type: "folder" | "tab_group";
  isLocked: boolean;
  encryptionKey?: string;
  isDirty: boolean;
  serverVersion: number;
  createdAt: number;
  updatedAt: number;
  userId: string | null;
};

export const folderSchema: RxJsonSchema<FolderDocType> = {
  title: "folder schema",
  version: 0,
  description: "Describes a folder for organizing items or a group of tabs",
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    userId: { type: "string", default: null, maxLength: 1000 },
    name: { type: "string" },
    parentId: {
      type: ["string", "null"],
      ref: "folders",
      default: null,
      maxLength: 1000,
    },
    type: {
      type: "string",
      enum: ["folder", "tab_group"],
      default: "folder",
      maxLength: 50,
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
  required: ["id", "name", "type", "createdAt", "updatedAt", "isDirty", "parentId", "userId"],
  indexes: ["isDirty", "userId", "type"],
};
