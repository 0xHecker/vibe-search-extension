import { RxJsonSchema } from "rxdb";

export type FlashcardDocType = {
  id: string;
  itemId?: string;
  userId: string | null;
  front: string;
  back: string;
  dueDate: number;
  interval: number;
  easeFactor: number;
  createdAt: number;
  updatedAt: number;
};

export const flashcardSchema: RxJsonSchema<FlashcardDocType> = {
  title: "flashcard schema",
  version: 0,
  description: "Describes a flashcard for spaced repetition",
  primaryKey: "id",
  type: "object",
  properties: {
    id: { type: "string", maxLength: 100 },
    itemId: { type: "string", ref: "items", maxLength: 1000 }, // Optional link to the source item
    userId: { type: "string", default: null, maxLength: 1000 },
    front: { type: "string" },
    back: { type: "string" },
    // Spaced Repetition fields
    dueDate: {
      type: "integer",
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER - 1,
      multipleOf: 1,
    },
    interval: { type: "number" },
    easeFactor: { type: "number" },
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
    "front",
    "back",
    "dueDate",
    "createdAt",
    "updatedAt",
    "itemId",
    "userId",
  ],
  indexes: ["dueDate", "itemId", "userId"],
};
