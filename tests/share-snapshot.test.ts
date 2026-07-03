import { describe, expect, mock, test } from "bun:test";
import type { FolderDocType } from "../src/schemas/folder_schema";
import type { ItemDocType } from "../src/schemas/item_schema";
import type { SpaceDocType } from "../src/schemas/space_schema";

type MutableDoc<T> = {
  toMutableJSON: () => T;
};

type TestDb = {
  space_groups: ReturnType<typeof collection>;
  spaces: ReturnType<typeof collection>;
  folders: ReturnType<typeof collection>;
  items: ReturnType<typeof collection>;
  tags: ReturnType<typeof collection>;
  item_tags: ReturnType<typeof collection>;
};

const doc = <T,>(value: T): MutableDoc<T> => ({
  toMutableJSON: () => ({ ...value }),
});

const collection = <T,>(rows: T[]) => ({
  find: () => ({
    exec: async () => rows.map(doc),
  }),
});

let db: TestDb;

mock.module("@src/services/DatabaseService", () => ({
  getDb: async () => db,
}));

const { buildShareSnapshotFromMixed } = await import("../src/services/share-snapshot");

const now = 1_764_000_000_000;

const makeSpace = (id: string): SpaceDocType =>
  ({
    id,
    name: id,
    slug: id,
    spaceGroupId: null,
    isPrivate: false,
    autoLockMs: 0,
    sortOrder: 0,
    isArchived: false,
    deletedAt: 0,
    purgeAt: 0,
    createdAt: now,
    updatedAt: now,
  }) as SpaceDocType;

const makeFolder = (id: string, spaceId: string): FolderDocType =>
  ({
    id,
    name: id,
    userId: "user1",
    spaceId,
    parentId: null,
    type: "tab_group",
    sortOrder: 0,
    isLocked: false,
    isPinned: false,
    isCollapsed: false,
    isDirty: false,
    serverVersion: 0,
    createdAt: now,
    updatedAt: now,
  }) as FolderDocType;

const makeItem = (id: string, folderId: string, spaceId: string): ItemDocType =>
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
    createdAt: now,
    updatedAt: now,
    deletedAt: 0,
  }) as ItemDocType;

const seedDb = () => {
  const spaces = [makeSpace("space-a")];
  const folders = [makeFolder("folder-a", "space-a"), makeFolder("folder-b", "space-a")];
  const items = [
    makeItem("selected", "folder-a", "space-a"),
    makeItem("sibling", "folder-a", "space-a"),
    makeItem("other-folder", "folder-b", "space-a"),
  ];

  db = {
    space_groups: collection([]),
    spaces: collection(spaces),
    folders: collection(folders),
    items: collection(items),
    tags: collection([]),
    item_tags: collection([]),
  };
};

describe("buildShareSnapshotFromMixed", () => {
  test("selected items include their container folder without sharing unselected siblings", async () => {
    seedDb();

    const snapshot = await buildShareSnapshotFromMixed({
      selection: {
        folderIds: new Set(),
        itemIds: new Set(["selected"]),
        spaceIds: new Set(),
        spaceGroupIds: new Set(),
      },
      title: "Selection",
    });

    expect(snapshot.folders.map((folder) => folder.id)).toEqual(["folder-a"]);
    expect(snapshot.items.map((item) => item.id)).toEqual(["selected"]);
    expect(snapshot.source).toEqual({ kind: "items", ids: ["selected"] });
  });

  test("explicit folder shares still include every item in that folder", async () => {
    seedDb();

    const snapshot = await buildShareSnapshotFromMixed({
      selection: {
        folderIds: new Set(["folder-a"]),
        itemIds: new Set(),
        spaceIds: new Set(),
        spaceGroupIds: new Set(),
      },
      title: "Folder",
    });

    expect(snapshot.items.map((item) => item.id)).toEqual(["selected", "sibling"]);
    expect(snapshot.source).toEqual({ kind: "folder", ids: ["folder-a"] });
  });
});
