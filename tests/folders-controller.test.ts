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
});

const folders: FolderDocType[] = [];
const items: ItemDocType[] = [];
const spaces: SpaceDocType[] = [];
let db = {
  spaces: collection(spaces),
  folders: collection(folders),
  items: collection(items),
};

mock.module("@src/services/DatabaseService", () => ({
  getDb: async () => db,
}));

mock.module("@src/services/db-manager", () => ({
  databaseManager: {
    deleteItem: async ({ id }: { id: string }) => {
      const item = items.find((entry) => entry.id === id);
      if (item) item.deletedAt = Date.now();
    },
  },
}));

const { foldersController } = await import("../src/services/controllers/folders.controller");

const now = 1_764_000_000_000;

const makeFolder = (id: string, parentId: string | null = null): FolderDocType => ({
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
  deletedAt: 0,
  purgeAt: 0,
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
    deletedAt: 0,
  }) as ItemDocType;

const makeSpace = (id: string, deletedAt = 0): SpaceDocType =>
  ({
    id,
    name: id,
    slug: id,
    spaceGroupId: null,
    isPrivate: false,
    autoLockMs: 0,
    sortOrder: 0,
    isArchived: false,
    deletedAt,
    purgeAt: deletedAt > 0 ? deletedAt + 1 : 0,
    createdAt: now,
    updatedAt: now,
  }) as SpaceDocType;

describe("folder tree deletion", () => {
  test("counts and deletes nested tab group items with the root folder", async () => {
    folders.splice(
      0,
      folders.length,
      makeFolder("root"),
      makeFolder("child", "root"),
      makeFolder("grandchild", "child"),
      makeFolder("sibling")
    );
    items.splice(
      0,
      items.length,
      makeItem("root-item", "root"),
      makeItem("child-item", "child"),
      makeItem("grandchild-item", "grandchild"),
      makeItem("sibling-item", "sibling")
    );

    await expect(foldersController.countItemsInTree({ ids: ["root"] })).resolves.toEqual({
      root: 3,
    });

    const result = await foldersController.delete({ id: "root", alsoDeleteItems: true });

    expect(result).toEqual({ success: true });
    expect(folders.map((folder) => folder.id)).toEqual(["root", "child", "grandchild", "sibling"]);
    expect(folders.filter((folder) => (folder.deletedAt || 0) > 0).map((folder) => folder.id)).toEqual([
      "root",
      "child",
      "grandchild",
    ]);
    expect(folders.find((folder) => folder.id === "sibling")?.deletedAt || 0).toBe(0);
    expect(items.filter((item) => item.deletedAt > 0).map((item) => item.id)).toEqual([
      "root-item",
      "child-item",
      "grandchild-item",
    ]);
    expect(items.find((item) => item.id === "sibling-item")?.deletedAt).toBe(0);
  });

  test("restores a deleted folder tree and its deleted items", async () => {
    spaces.splice(0, spaces.length, makeSpace("space-a"));
    folders.splice(
      0,
      folders.length,
      makeFolder("root"),
      makeFolder("child", "root"),
      makeFolder("sibling")
    );
    items.splice(
      0,
      items.length,
      makeItem("root-item", "root"),
      makeItem("child-item", "child"),
      makeItem("sibling-item", "sibling")
    );

    await foldersController.delete({ id: "root", alsoDeleteItems: true });
    const result = await foldersController.restoreFromBin({ id: "root" });

    expect(result.success).toBe(true);
    expect(result.restoredItems).toBe(2);
    expect(folders.filter((folder) => (folder.deletedAt || 0) > 0).map((folder) => folder.id)).toEqual([]);
    expect(items.filter((item) => item.deletedAt > 0).map((item) => item.id)).toEqual([]);
    expect(folders.find((folder) => folder.id === "child")?.parentId).toBe("root");
    expect(items.find((item) => item.id === "root-item")?.folderId).toBe("root");
    expect(items.find((item) => item.id === "child-item")?.folderId).toBe("child");
  });

  test("restores a folder tree into a fallback space when the original space is in bin", async () => {
    spaces.splice(
      0,
      spaces.length,
      makeSpace("space-a", now),
      makeSpace("space_public_default")
    );
    folders.splice(0, folders.length, makeFolder("root"), makeFolder("child", "root"));
    items.splice(0, items.length, makeItem("root-item", "root"), makeItem("child-item", "child"));

    await foldersController.delete({ id: "root", alsoDeleteItems: true });
    const result = await foldersController.restoreFromBin({ id: "root" });

    expect(result.success).toBe(true);
    expect(result.relocated).toBe(true);
    expect(result.message).toContain("Heads up");
    expect(folders.find((folder) => folder.id === "root")?.spaceId).toBe("space_public_default");
    expect(folders.find((folder) => folder.id === "root")?.parentId).toBe(null);
    expect(folders.find((folder) => folder.id === "child")?.parentId).toBe("root");
    expect(items.find((item) => item.id === "root-item")?.spaceId).toBe("space_public_default");
    expect(items.find((item) => item.id === "child-item")?.spaceId).toBe("space_public_default");
  });
});
