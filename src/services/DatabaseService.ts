import { createRxDatabase, addRxPlugin, RxDatabase, RxCollection, RxStorage } from "rxdb";
import { createRevision, now } from "rxdb/plugins/utils";
import { getRxStorageDexie } from "rxdb/plugins/storage-dexie";
import { RxDBDevModePlugin } from "rxdb/plugins/dev-mode";
import { wrappedValidateZSchemaStorage } from "rxdb/plugins/validate-z-schema";
import { RxDBMigrationSchemaPlugin } from "rxdb/plugins/migration-schema";
import { RxDBLocalDocumentsPlugin } from "rxdb/plugins/local-documents";
import { RxDBQueryBuilderPlugin } from "rxdb/plugins/query-builder";

if (import.meta.env.MODE === "development") {
  addRxPlugin(RxDBDevModePlugin);
}
addRxPlugin(RxDBMigrationSchemaPlugin);
addRxPlugin(RxDBLocalDocumentsPlugin);
addRxPlugin(RxDBQueryBuilderPlugin);

// Import schemas
import { itemSchema, ItemDocType } from "@src/schemas/item_schema";
import { folderSchema, FolderDocType } from "@src/schemas/folder_schema";
import { spaceSchema, SpaceDocType } from "@src/schemas/space_schema";
import { tagSchema, TagDocType } from "@src/schemas/tag_schema";
import { itemTagSchema, ItemTagDocType } from "@src/schemas/item_tag_schema";
import { searchHistorySchema, SearchHistoryDocType } from "@src/schemas/search_history_schema";
import { flashcardSchema, FlashcardDocType } from "@src/schemas/flashcard_schema";
import { deletedItemSchema, DeletedItemDocType } from "@src/schemas/deleted_item_schema";
import { PUBLIC_SPACE_ID } from "@src/common/spaces";

const OCR_STATUSES = new Set(["pending", "processing", "done", "error", "skipped"]);

function normalizeOcrStatus(value: unknown): ItemDocType["ocrStatus"] {
  return typeof value === "string" && OCR_STATUSES.has(value) ? (value as ItemDocType["ocrStatus"]) : "pending";
}

function normalizeSafeInteger(value: unknown): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value as number)) : 0;
}

function normalizeOcrConfidence(value: unknown): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value as number));
}

function repairStoredItemSchema(schema: any): boolean {
  if (!schema || !Array.isArray(schema.indexes)) return false;

  const beforeIndexCount = schema.indexes.length;
  schema.indexes = schema.indexes.filter((index: unknown) => {
    const fields = Array.isArray(index) ? index : [index];
    return !fields.some(
      (field) => field === "ocrStatus" || field === "ocrModelVersion" || field === "ocrUpdatedAt"
    );
  });

  const indexedFields = schema.indexes.flat().filter((field: unknown) => typeof field === "string");
  const required = new Set<string>(Array.isArray(schema.required) ? schema.required : []);
  let changed = schema.indexes.length !== beforeIndexCount;

  for (const field of indexedFields) {
    if (!field.includes(".") && !required.has(field)) {
      required.add(field);
      changed = true;
    }
  }

  if (!schema.properties) schema.properties = {};
  if (schema.properties.ocrStatus && schema.properties.ocrStatus.default !== "pending") {
    schema.properties.ocrStatus = { ...schema.properties.ocrStatus, default: "pending" };
    changed = true;
  }
  if (schema.properties.ocrModelVersion && schema.properties.ocrModelVersion.default !== "") {
    schema.properties.ocrModelVersion = { ...schema.properties.ocrModelVersion, default: "" };
    changed = true;
  }
  if (schema.properties.ocrUpdatedAt && schema.properties.ocrUpdatedAt.default !== 0) {
    schema.properties.ocrUpdatedAt = { ...schema.properties.ocrUpdatedAt, default: 0 };
    changed = true;
  }
  if (schema.properties.ocrConfidence) {
    const type = schema.properties.ocrConfidence.type;
    const allowsNull = Array.isArray(type) ? type.includes("null") : type === "null";
    if (!allowsNull || schema.properties.ocrConfidence.default !== null) {
      schema.properties.ocrConfidence = {
        ...schema.properties.ocrConfidence,
        type: ["number", "null"],
        default: null,
      };
      changed = true;
    }
  }

  if (changed) {
    schema.required = Array.from(required);
  }
  return changed;
}

async function repairStoredItemSchemaMetadata(db: MyDatabase): Promise<void> {
  const internalStore = (db as any).internalStore;
  if (!internalStore) return;

  const ids = Array.from({ length: itemSchema.version + 1 }, (_, version) => `collection|items-${version}`);
  const docs = await internalStore.findDocumentsById(ids, true);
  const writeRows = docs
    .map((doc: any) => {
      if (!doc?.data?.schema) return null;
      const nextDoc = structuredClone(doc);
      if (!repairStoredItemSchema(nextDoc.data.schema)) return null;
      nextDoc._meta = { ...nextDoc._meta, lwt: now() };
      nextDoc._rev = createRevision(db.token, doc);
      return { previous: doc, document: nextDoc };
    })
    .filter(Boolean);

  if (writeRows.length === 0) return;

  const result = await internalStore.bulkWrite(writeRows, "repair-item-schema-index-required-fields");
  if (result.error.length > 0) {
    console.warn("Failed to repair stored item schema metadata", result.error);
  }
}

// Define collection types
export type ItemCollection = RxCollection<ItemDocType>;
export type FolderCollection = RxCollection<FolderDocType>;
export type SpaceCollection = RxCollection<SpaceDocType>;
export type TagCollection = RxCollection<TagDocType>;
export type ItemTagCollection = RxCollection<ItemTagDocType>;
export type SearchHistoryCollection = RxCollection<SearchHistoryDocType>;
export type FlashcardCollection = RxCollection<FlashcardDocType>;
export type DeletedItemCollection = RxCollection<DeletedItemDocType>;

// Define database collections
export type MyDatabaseCollections = {
  items: ItemCollection;
  folders: FolderCollection;
  spaces: SpaceCollection;
  tags: TagCollection;
  item_tags: ItemTagCollection;
  search_history: SearchHistoryCollection;
  flashcards: FlashcardCollection;
  deleted_items: DeletedItemCollection;
};

export type MyDatabase = RxDatabase<MyDatabaseCollections>;

let dbPromise: Promise<MyDatabase> | null = null;

const createDatabase = async () => {
  let storage: RxStorage<any, any> = getRxStorageDexie();
  if (import.meta.env.MODE === "development") {
    storage = wrappedValidateZSchemaStorage({ storage });
  }

  const db = await createRxDatabase<MyDatabaseCollections>({
    name: "vibesearchdb",
    storage,
    localDocuments: true,
  });

  await repairStoredItemSchemaMetadata(db);

  await db.addCollections({
    items: {
      schema: itemSchema,
      migrationStrategies: {
        1: async (oldDoc: any) => {
          if (!oldDoc.spaceId || typeof oldDoc.spaceId !== "string") {
            return { ...oldDoc, spaceId: PUBLIC_SPACE_ID };
          }
          return oldDoc;
        },
        2: async (oldDoc: any) => {
          return oldDoc;
        },
        3: async (oldDoc: any) => {
          return oldDoc;
        },
        4: async (oldDoc: any) => {
          return {
            ...oldDoc,
            ocrStatus: typeof oldDoc.ocrStatus === "string" ? oldDoc.ocrStatus : "pending",
          };
        },
        5: async (oldDoc: any) => {
          const vectorIndex =
            Number.isInteger(oldDoc.vector_index) && oldDoc.vector_index >= 0
              ? oldDoc.vector_index
              : -1;
          return {
            ...oldDoc,
            vector_index: vectorIndex,
            vector_indexes:
              Array.isArray(oldDoc.vector_indexes) && oldDoc.vector_indexes.length > 0
                ? oldDoc.vector_indexes.filter((index: unknown) => Number.isInteger(index) && (index as number) >= 0)
                : vectorIndex >= 0
                  ? [vectorIndex]
                  : [],
          };
        },
        6: async (oldDoc: any) => {
          return {
            ...oldDoc,
            ocrStatus: normalizeOcrStatus(oldDoc.ocrStatus),
            ocrModelVersion:
              typeof oldDoc.ocrModelVersion === "string" ? oldDoc.ocrModelVersion : "",
            ocrUpdatedAt: normalizeSafeInteger(oldDoc.ocrUpdatedAt),
            ocrConfidence: normalizeOcrConfidence(oldDoc.ocrConfidence),
            ocrLineCount: normalizeSafeInteger(oldDoc.ocrLineCount),
          };
        },
        7: async (oldDoc: any) => {
          return {
            ...oldDoc,
            ocrConfidence: normalizeOcrConfidence(oldDoc.ocrConfidence),
            ocrLineCount: normalizeSafeInteger(oldDoc.ocrLineCount),
          };
        },
        8: async (oldDoc: any) => {
          return {
            ...oldDoc,
            ocrConfidence: normalizeOcrConfidence(oldDoc.ocrConfidence),
            ocrLineCount: normalizeSafeInteger(oldDoc.ocrLineCount),
          };
        },
      },
    },
    folders: {
      schema: folderSchema,
      migrationStrategies: {
        1: async (oldDoc: any) => {
          if (oldDoc.isCollapsed === undefined) {
            return { ...oldDoc, isCollapsed: false };
          }
          return oldDoc;
        },
        2: async (oldDoc: any) => {
          // Introduced sortOrder; keep existing order stable using createdAt as fallback
          if (oldDoc.sortOrder === undefined) {
            return { ...oldDoc, sortOrder: oldDoc.createdAt ?? Date.now() };
          }
          return oldDoc;
        },
        3: async (oldDoc: any) => {
          // Ensure sortOrder is an integer for indexed field requirements
          const nextOrderRaw =
            oldDoc.sortOrder !== undefined ? oldDoc.sortOrder : oldDoc.createdAt ?? Date.now();
          const nextOrder = Number.isFinite(nextOrderRaw) ? Math.max(0, Math.floor(nextOrderRaw)) : 0;
          return { ...oldDoc, sortOrder: nextOrder };
        },
        4: async (oldDoc: any) => {
          // Make sortOrder required with a safe default
          const nextOrderRaw =
            oldDoc.sortOrder !== undefined ? oldDoc.sortOrder : oldDoc.createdAt ?? Date.now();
          const nextOrder = Number.isFinite(nextOrderRaw) ? Math.max(0, Math.floor(nextOrderRaw)) : 0;
          return { ...oldDoc, sortOrder: nextOrder };
        },
        5: async (oldDoc: any) => {
          const nextSpaceId =
            typeof oldDoc.spaceId === "string" && oldDoc.spaceId.trim().length > 0
              ? oldDoc.spaceId
              : PUBLIC_SPACE_ID;
          return { ...oldDoc, spaceId: nextSpaceId };
        },
        6: async (oldDoc: any) => {
          return {
            ...oldDoc,
            userId: typeof oldDoc.userId === "string" ? oldDoc.userId : "",
          };
        },
      },
    },
    spaces: {
      schema: spaceSchema,
      migrationStrategies: {
        1: async (oldDoc: any) => {
          return {
            ...oldDoc,
          };
        },
      },
    },
    tags: {
      schema: tagSchema,
    },
    item_tags: {
      schema: itemTagSchema,
    },
    search_history: {
      schema: searchHistorySchema,
    },
    flashcards: {
      schema: flashcardSchema,
    },
    deleted_items: {
      schema: deletedItemSchema,
    },
  });

  return db;
};

export const getDb = (): Promise<MyDatabase> => {
  if (!dbPromise) {
    dbPromise = createDatabase();
  }
  return dbPromise;
};

// export const addDummyData = async () => {
//   const db = await getDb();
//   const quotes = [
//     "The only way to do great work is to love what you do.",
//     "Innovation distinguishes between a leader and a follower.",
//     "Strive not to be a success, but rather to be of value.",
//     "The mind is everything. What you think you become.",
//     "Your time is limited, don't waste it living someone else's life.",
//     "The best way to predict the future is to create it.",
//     "Success is not final, failure is not fatal: it is the courage to continue that counts.",
//     "Believe you can and you're halfway there.",
//     "The only impossible journey is the one you never begin.",
//     "Act as if what you do makes a difference. It does.",
//     "Success usually comes to those who are too busy to be looking for it.",
//     "Don't watch the clock; do what it does. Keep going.",
//     "The future belongs to those who believe in the beauty of their dreams.",
//     "The secret of getting ahead is getting started.",
//     "I find that the harder I work, the more luck I seem to have.",
//     "It's not whether you get knocked down, it's whether you get up.",
//     "The successful warrior is the average man, with laser-like focus.",
//     "Don't be afraid to give up the good to go for the great.",
//     "I have not failed. I've just found 10,000 ways that won't work.",
//     "If you are not willing to risk the usual, you will have to settle for the ordinary.",
//     "The ones who are crazy enough to think they can change the world are the ones who do.",
//     "Do one thing every day that scares you.",
//     "All progress takes place outside the comfort zone.",
//     "The only limit to our realization of tomorrow will be our doubts of today.",
//     "What you get by achieving your goals is not as important as what you become by achieving your goals.",
//     "If you want to lift yourself up, lift up someone else.",
//     "You miss 100% of the shots you don't take.",
//     "The most difficult thing is the decision to act, the rest is merely tenacity.",
//     "I am a great believer in luck, and I find the harder I work the more I have of it.",
//     "To be successful, you must accept all challenges that come your way. You can't just accept the ones you like.",
//   ];
//
//   const dummyItems = quotes.map((quote, i) => ({
//     id: `dummy-quote-${i}`,
//     userId: "user1",
//     title: `Quote ${i}`,
//     textContent: quote,
//     url: `https://example.com/quote-${i}`,
//     source: "note" as const,
//     folderId: "folder1",
//     isFavorite: false,
//     parentId: null,
//     isEmbedded: false,
//     isMetaFetched: false,
//     isDirty: false,
//     serverVersion: 0,
//     createdAt: Date.now(),
//     updatedAt: Date.now(),
//     vector_index: -1,
//     deletedAt: 0,
//   }));
//
//   console.log("Inserting dummy items...");
//   try {
//     await db.items.bulkInsert(dummyItems);
//   } catch (e) {
//     console.error("Failed to insert dummy items:", e);
//   }
//   console.log("Finished inserting dummy items.");
// };
