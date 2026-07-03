import { describe, expect, test } from "bun:test";
import {
  buildFolderLoadKey,
  buildSearchSelectionSearch,
  getVisibleSelectionState,
  resolveFolderSelectionContext,
} from "../src/pages/search/selection-state";

describe("search selection state", () => {
  test("resolves a clicked folder to its owning space", () => {
    const context = resolveFolderSelectionContext(
      "folder-private",
      [{ id: "folder-private", spaceId: "space_private_default" }],
      [{ id: "space_private_default", spaceGroupId: null }]
    );

    expect(context).toEqual({
      activeSpaceId: "space_private_default",
      activeSpaceGroupId: null,
      selectedFolderId: "folder-private",
    });
  });

  test("serializes folder selection without forcing the default public space param", () => {
    const search = buildSearchSelectionSearch({
      currentSearch: "?space=space_public_default&view=grid",
      activeSpaceId: "space_public_default",
      activeSpaceGroupId: null,
      selectedFolderId: "folder-public",
    });

    expect(new URLSearchParams(search).get("space")).toBe(null);
    expect(new URLSearchParams(search).get("folder")).toBe("folder-public");
    expect(new URLSearchParams(search).get("view")).toBe("grid");
  });

  test("folder load keys include the target space set", () => {
    expect(
      buildFolderLoadKey({
        activeSpaceId: "space-a",
        searchScope: "global",
        spaceIds: ["space-b", "space-a"],
      })
    ).toBe("space-a|global|space-a,space-b");
  });

  test("selection state is scoped to the visible page", () => {
    const pageItems = [{ id: "page-1" }, { id: "page-2" }];

    expect(getVisibleSelectionState(pageItems, new Set(["page-1", "hidden-1"]))).toEqual({
      allVisibleSelected: false,
      someVisibleSelected: true,
    });

    expect(getVisibleSelectionState(pageItems, new Set(["page-1", "page-2", "hidden-1"]))).toEqual({
      allVisibleSelected: true,
      someVisibleSelected: false,
    });
  });
});
