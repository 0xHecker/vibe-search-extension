import { describe, expect, test } from "bun:test";
import {
  BROWSER_BOOKMARKS_SPACE_GROUP_ID,
  MAX_BOOKMARKS_PER_SPACE,
  buildBrowserBookmarkImportPlan,
  type BrowserBookmarkNode,
} from "../src/services/browser-bookmark-import";

const NOW = 1_764_000_000_000;

describe("buildBrowserBookmarkImportPlan", () => {
  test("preserves nested paths inside a top-level source space", () => {
    const tree: BrowserBookmarkNode[] = [
      {
        id: "0",
        children: [
          {
            id: "10",
            title: "Research",
            children: [
              {
                id: "11",
                title: "AI",
                children: [
                  { id: "100", title: "Deep link", url: "https://example.com/deep", index: 7 },
                ],
              },
            ],
          },
        ],
      },
    ];

    const plan = buildBrowserBookmarkImportPlan({ tree }, { now: NOW });
    const foldersByName = new Map(plan.folders.map((folder) => [folder.name, folder]));
    const root = foldersByName.get("Research");
    const child = foldersByName.get("AI");

    expect(plan.spaceGroup.id).toBe(BROWSER_BOOKMARKS_SPACE_GROUP_ID);
    expect(plan.spaces).toHaveLength(1);
    expect(plan.spaces[0]).toMatchObject({ name: "Research", spaceGroupId: BROWSER_BOOKMARKS_SPACE_GROUP_ID });
    expect(root?.parentId).toBeNull();
    expect(child?.parentId).toBe(root?.id);
    expect(plan.bookmarks).toHaveLength(1);
    expect(plan.bookmarks[0]).toMatchObject({
      title: "Deep link",
      folderId: child?.id,
      spaceId: plan.spaces[0].id,
      isEmbedded: false,
      isMetaFetched: false,
    });
  });

  test("places root bookmarks in their own deterministic source space", () => {
    const tree: BrowserBookmarkNode[] = [
      { id: "0", children: [{ id: "101", title: "Loose", url: "https://loose.example" }] },
    ];
    const first = buildBrowserBookmarkImportPlan({ tree }, { now: NOW });
    const second = buildBrowserBookmarkImportPlan({ tree }, { now: NOW + 5_000 });

    expect(first.spaces).toHaveLength(1);
    expect(first.spaces[0].name).toBe("Unsorted bookmarks");
    expect(first.folders[0].name).toBe("Unsorted bookmarks");
    expect(first.bookmarks[0].id).toBe(second.bookmarks[0].id);
    expect(first.spaces[0].id).toBe(second.spaces[0].id);
  });

  test("splits huge bookmark folders into spaces capped at 500 items", () => {
    const total = MAX_BOOKMARKS_PER_SPACE * 2 + 1;
    const tree: BrowserBookmarkNode[] = [
      {
        id: "0",
        children: [
          {
            id: "folder",
            title: "Big folder",
            children: Array.from({ length: total }, (_, index) => ({
              id: `bookmark-${index}`,
              title: `Bookmark ${index}`,
              url: `https://example.com/${index}`,
              index,
            })),
          },
        ],
      },
    ];

    const plan = buildBrowserBookmarkImportPlan({ tree }, { now: NOW });
    const itemsBySpace = new Map<string, number>();
    for (const bookmark of plan.bookmarks) {
      itemsBySpace.set(bookmark.spaceId, (itemsBySpace.get(bookmark.spaceId) || 0) + 1);
    }

    expect(plan.spaces.map((space) => space.name)).toEqual(["Big folder (1)", "Big folder (2)", "Big folder (3)"]);
    expect(plan.bookmarks).toHaveLength(total);
    expect(new Set(plan.bookmarks.map((bookmark) => bookmark.id)).size).toBe(total);
    expect(Array.from(itemsBySpace.values()).every((count) => count <= MAX_BOOKMARKS_PER_SPACE)).toBe(true);
    expect(plan.folders.filter((folder) => folder.isCollapsed)).toHaveLength(2);
  });
});
