import { RxJsonSchema } from "rxdb";

export type TagDocType = {
  id: string;
  name: string;
  userId: string | null;
  isDirty: boolean;
  serverVersion: number;
  createdAt: number;
  updatedAt: number;
};

export const tagSchema: RxJsonSchema<TagDocType> = {
  title: "tag schema",
  version: 0,
  description: "Describes a single tag",
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    userId: { type: "string", default: null, maxLength: 1000 },
    name: { type: "string", maxLength: 100 },
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
  required: ["id", "name", "createdAt", "updatedAt", "isDirty", "userId"],
  indexes: ["name", "isDirty", "userId"],
};
