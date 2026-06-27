import { RxJsonSchema } from "rxdb";

export type SpaceGroupDocType = {
  id: string;
  name: string;
  sortOrder: number;
  isCollapsed: boolean;
  /**
   * Parent space group id for nested groups, or null/absent for a top-level
   * group. Added in schema v1 to support dragging one space group into another.
   */
  parentGroupId?: string | null;
  createdAt: number;
  updatedAt: number;
};

export const spaceGroupSchema: RxJsonSchema<SpaceGroupDocType> = {
  title: "space group schema",
  version: 1,
  description: "Groups related spaces in the navigation and search scope",
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    name: { type: "string", maxLength: 80 },
    parentGroupId: {
      type: ["string", "null"],
      ref: "space_groups",
      default: null,
      maxLength: 100,
    },
    sortOrder: {
      type: "integer",
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER - 1,
      multipleOf: 1,
    },
    isCollapsed: { type: "boolean", default: false },
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
  required: ["id", "name", "sortOrder", "isCollapsed", "createdAt", "updatedAt"],
  indexes: ["sortOrder", "name", "isCollapsed"],
};
