import { describe, expect, mock, test } from "bun:test";
import type { FolderDocType } from "../src/schemas/folder_schema";
import type { ItemDocType } from "../src/schemas/item_schema";
import type { SpaceDocType } from "../src/schemas/space_schema";

type Row = { id: string; [key: string]: unknown };

class FakeDoc<T extends Row> {
  constructor(
    private rows: T[],
    private row: T
  ) {}

  get primary(): string {
    return this.row.id;
  }

  get(key: string): unknown {
    return this.row[key];
  }

  toMutableJSON(): T {
    return { ...this.row };
  }

  async patch(patch: Partial<T>): Promise<void> {
    Object.assign(this.row, patch);
  }

  async remove(): Promise<void> {
    const index = this.rows.findIndex((entry) => entry.id === this.row.id);
    if (index >= 0) this.rows.splice(index, 1);
  }
}

const matchesSelector = (row: Row, selector?: Record<string, any>): boolean => {
  if (!selector) return true;
  return Object.entries(selector).every(([key, condition]) => {
    const value = row[key];
    if (condition && typeof condition === "object" && !Array.isArray(condition)) {
      if ("$eq" in condition) return value === condition.$eq;
      if ("$gt" in condition) return typeof value === "number" && value > condition.$gt;
      if ("$in" in condition) return Array.isArray(condition.$in) && condition.$in.includes(value);
    }
    return value === condition;
  });
};

const collection = <T extends Row>(rows: T[]) => ({
  find: (query?: { selector?: Record<string, any> }) => ({
    exec: async () =>
      rows
        .filter((row) => matchesSelector(row, query?.selector))
        .map((row) => new FakeDoc(rows, row)),
  }),
  findOne: (id: string) => ({
    exec: async () => {
      const row = rows.find((entry) => entry.id === id);
      return row ? new FakeDoc(rows, row) : null;
    },
  }),
  insert: async (row: T) => {
    rows.push(row);
    return new FakeDoc(rows, row);
  },
});

const now = 1_764_000_000_000;
const spaces: SpaceDocType[] = [];
const folders: FolderDocType[] = [];
const items: ItemDocType[] = [];

mock.module("@src/services/DatabaseService", () => ({
  getDb: async () => ({
    spaces: collection(spaces),
    folders: collection(folders),
    items: collection(items),
  }),
}));

const { itemsController } = await import("../src/services/controllers/items.controller");

const makeSpace = (id: string): SpaceDocType =>
  ({
    id,
    name: id,
    slug: id,
    spaceGroupId: "",
    isPrivate: false,
    autoLockMs: 0,
    sortOrder: 0,
    isArchived: false,
    deletedAt: 0,
    purgeAt: 0,
    createdAt: now,
    updatedAt: now,
  }) as SpaceDocType;

const makeFolder = (id: string, deletedAt = 0): FolderDocType => ({
  id,
  name: id,
  userId: "user1",
  spaceId: "space-a",
  parentId: null,
  type: "tab_group",
  sortOrder: 0,
  isLocked: false,
  isPinned: false,
  isCollapsed: false,
  deletedAt,
  purgeAt: deletedAt > 0 ? deletedAt + 1 : 0,
  isDirty: false,
  serverVersion: 0,
  createdAt: now,
  updatedAt: now,
});

const makeItem = (id: string, folderId: string): ItemDocType =>
  ({
    id,
    userId: "user1",
    title: id,
    textContent: "",
    url: `https://example.com/${id}`,
    source: "web",
    folderId,
    spaceId: "space-a",
    isFavorite: false,
    parentId: null,
    vector_index: -1,
    vector_indexes: [],
    isEmbedded: false,
    isMetaFetched: true,
    isDirty: false,
    serverVersion: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: now,
  }) as ItemDocType;

describe("item bin restore", () => {
  test("restores an item into a new tab group when its original folder is in bin", async () => {
    spaces.splice(0, spaces.length, makeSpace("space-a"));
    folders.splice(0, folders.length, makeFolder("old-folder", now));
    items.splice(0, items.length, makeItem("tab-a", "old-folder"));

    const result = await itemsController.restoreFromBin({ id: "tab-a" });

    expect(result.success).toBe(true);
    expect(result.relocated).toBe(true);
    expect(result.message).toContain("Heads up");
    expect(folders).toHaveLength(2);
    const restoredFolder = folders.find((folder) => folder.id !== "old-folder");
    expect(restoredFolder?.name).toBe("Restored tabs");
    expect(restoredFolder?.spaceId).toBe("space-a");
    expect(items[0].deletedAt).toBe(0);
    expect(items[0].spaceId).toBe("space-a");
    expect(items[0].folderId).toBe(restoredFolder?.id);
  });
});
