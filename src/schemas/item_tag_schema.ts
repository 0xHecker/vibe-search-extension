import { RxJsonSchema } from "rxdb";

export type ItemTagDocType = {
  id: string;
  itemId: string;
  tagId: string;
  userId: string | null;
};

export const itemTagSchema: RxJsonSchema<ItemTagDocType> = {
  title: "item-tag join schema",
  version: 0,
  description: "Joins items and tags",
  primaryKey: {
    key: "id",
    fields: ["itemId", "tagId"],
    separator: "|",
  },
  type: "object",
  properties: {
    id: { type: "string", maxLength: 201 },
    itemId: { type: "string", ref: "items", maxLength: 100 },
    tagId: { type: "string", ref: "tags", maxLength: 100 },
    userId: { type: "string", default: null, maxLength: 1000 },
  },
  required: ["itemId", "tagId", "userId"],
  indexes: ["itemId", "tagId", "userId"],
};
