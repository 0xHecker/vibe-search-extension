import { describe, expect, mock, test } from "bun:test";
import type { FolderDocType } from "../src/schemas/folder_schema";
import type { ItemDocType } from "../src/schemas/item_schema";
import type { SpaceDocType } from "../src/schemas/space_schema";

type Row = { id: string; [key: string]: unknown };

class FakeDoc<T extends Row> {
  constructor(private row: T) {}

  get primary(): string {
    return this.row.id;
  }

  toMutableJSON(): T {
    return { ...this.row };
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
        .map((row) => new FakeDoc(row)),
  }),
});

const deletedAt = 1_764_000_000_000;
const purgeAt = deletedAt + 30 * 24 * 60 * 60 * 1000;

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

const { binController } = await import("../src/services/controllers/bin.controller");

const makeSpace = (id: string, name: string, isBinned = false): SpaceDocType =>
  ({
    id,
    name,
    slug: name.toLowerCase(),
    spaceGroupId: null,
    isPrivate: false,
    autoLockMs: 0,
    sortOrder: 0,
    isArchived: false,
    deletedAt: isBinned ? deletedAt : 0,
    purgeAt: isBinned ? purgeAt : 0,
    createdAt: deletedAt,
    updatedAt: deletedAt,
  }) as SpaceDocType;

const makeFolder = (id: string, parentId: string | null, isBinned = false): FolderDocType => ({
  id,
  name: id,
  userId: "user1",
  spaceId: "space-a",
  parentId,
  type: "tab_group",
  sortOrder: 0,
  isLocked: false,
  isPinned: false,
  isCollapsed: false,
  deletedAt: isBinned ? deletedAt : 0,
  purgeAt: isBinned ? purgeAt : 0,
  isDirty: false,
  serverVersion: 0,
  createdAt: deletedAt,
  updatedAt: deletedAt,
});

const makeItem = (id: string, folderId: string, spaceId = "space-a", isBinned = false): ItemDocType =>
  ({
    id,
    userId: "user1",
    title: id,
    textContent: "",
    url: `https://example.com/${id}`,
    source: "web",
    folderId,
    spaceId,
    isFavorite: false,
    parentId: null,
    vector_index: -1,
    vector_indexes: [],
    isEmbedded: false,
    isMetaFetched: true,
    isDirty: false,
    serverVersion: 0,
    createdAt: deletedAt,
    updatedAt: deletedAt,
    deletedAt: isBinned ? deletedAt : 0,
  }) as ItemDocType;

describe("bin contents", () => {
  test("lists binned spaces, top-level folder trees, and individual tabs", async () => {
    spaces.splice(0, spaces.length, makeSpace("space-a", "Space A"), makeSpace("space-b", "Space B", true));
    folders.splice(
      0,
      folders.length,
      makeFolder("root", null, true),
      makeFolder("child", "root", true),
      makeFolder("live-folder", null)
    );
    items.splice(
      0,
      items.length,
      makeItem("root-tab", "root", "space-a", true),
      makeItem("child-tab", "child", "space-a", true),
      makeItem("single-tab", "live-folder", "space-a", true),
      makeItem("space-tab", "any-folder", "space-b", true)
    );

    const entries = await binController.listContents();

    expect(entries.map((entry) => `${entry.kind}:${entry.id}`).sort()).toEqual([
      "space:space-b",
      "folder:root",
      "item:single-tab",
    ].sort());
    expect(entries.find((entry) => entry.id === "root")?.itemCount).toBe(2);
  });
});
