import { RxJsonSchema } from "rxdb";
import { DEFAULT_PRIVATE_AUTO_LOCK_MS } from "@src/common/spaces";

export type SpaceDocType = {
  id: string;
  name: string;
  slug: string;
  isPrivate: boolean;
  passwordSalt?: string;
  passwordHash?: string;
  passwordIterations?: number;
  passwordVersion?: number;
  recoveryQuestion1?: string;
  recoveryQuestion2?: string;
  recoverySalt1?: string;
  recoveryHash1?: string;
  recoveryIterations1?: number;
  recoverySalt2?: string;
  recoveryHash2?: string;
  recoveryIterations2?: number;
  autoLockMs: number;
  sortOrder: number;
  isArchived: boolean;
  createdAt: number;
  updatedAt: number;
};

export const spaceSchema: RxJsonSchema<SpaceDocType> = {
  title: "space schema",
  version: 1,
  description: "Describes a space used to scope folders and items",
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    name: { type: "string", maxLength: 80 },
    slug: { type: "string", maxLength: 120 },
    isPrivate: { type: "boolean", default: false },
    passwordSalt: { type: "string" },
    passwordHash: { type: "string" },
    passwordIterations: { type: "number", minimum: 1, maximum: 5_000_000, multipleOf: 1 },
    passwordVersion: { type: "number", minimum: 1, maximum: 1000, multipleOf: 1 },
    recoveryQuestion1: { type: "string", maxLength: 160 },
    recoveryQuestion2: { type: "string", maxLength: 160 },
    recoverySalt1: { type: "string" },
    recoveryHash1: { type: "string" },
    recoveryIterations1: { type: "number", minimum: 1, maximum: 5_000_000, multipleOf: 1 },
    recoverySalt2: { type: "string" },
    recoveryHash2: { type: "string" },
    recoveryIterations2: { type: "number", minimum: 1, maximum: 5_000_000, multipleOf: 1 },
    autoLockMs: {
      type: "integer",
      minimum: 30_000,
      maximum: 24 * 60 * 60 * 1000,
      multipleOf: 1,
      default: DEFAULT_PRIVATE_AUTO_LOCK_MS,
    },
    sortOrder: {
      type: "integer",
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER - 1,
      multipleOf: 1,
      default: 0,
    },
    isArchived: { type: "boolean", default: false },
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
    "slug",
    "isPrivate",
    "autoLockMs",
    "sortOrder",
    "isArchived",
    "createdAt",
    "updatedAt",
  ],
  indexes: ["isPrivate", "sortOrder", "name", "isArchived", "slug"],
};
