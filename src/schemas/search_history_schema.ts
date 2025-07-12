import { RxJsonSchema } from "rxdb";

export type SearchHistoryDocType = {
  id: string;
  query: string;
  createdAt: number;
  userId: string | null;
};

export const searchHistorySchema: RxJsonSchema<SearchHistoryDocType> = {
  title: "search history schema",
  version: 0,
  description: "Stores user search queries",
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    query: { type: "string", maxLength: 500 },
    createdAt: {
      type: "integer",
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER - 1,
      multipleOf: 1,
    },
    userId: { type: "string", default: null, maxLength: 1000 },
  },
  required: ["id", "query", "createdAt", "userId"],
  indexes: ["createdAt", "userId"],
};
