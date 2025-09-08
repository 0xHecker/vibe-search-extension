import { RxJsonSchema } from "rxdb";

export const deletedItemSchemaLiteral = {
  title: "Deleted Item Schema",
  version: 0,
  type: "object",
  primaryKey: "id",
  properties: {
    id: {
      type: "string",
      maxLength: 100,
    },
    vector_index: {
      type: "number",
    },
    deletedAt: {
      type: "number",
    },
  },
  required: ["id", "vector_index", "deletedAt"],
} as const;

export type DeletedItemDocType = {
  id: string;
  vector_index: number;
  deletedAt: number;
};

export const deletedItemSchema: RxJsonSchema<DeletedItemDocType> = deletedItemSchemaLiteral;
