import { describe, expect, test } from "bun:test";
import {
  isFolderCollapseOnlyChange,
  isSpaceGroupCollapseOnlyChange,
} from "@src/services/item-change-classification";

const folder = {
  id: "folder-1",
  name: "Reading",
  isCollapsed: false,
  updatedAt: 10,
};

describe("presentation-only collection changes", () => {
  test("does not treat a folder collapse as a content refresh", () => {
    expect(
      isFolderCollapseOnlyChange({
        events: [
          {
            operation: "UPDATE",
            previousDocumentData: folder,
            documentData: { ...folder, isCollapsed: true, updatedAt: 11 },
          },
        ],
      })
    ).toBe(true);
  });

  test("does not treat a space-group collapse as a search refresh", () => {
    expect(
      isSpaceGroupCollapseOnlyChange({
        operation: "UPDATE",
        previousDocumentData: folder,
        documentData: { ...folder, isCollapsed: true, updatedAt: 11 },
      })
    ).toBe(true);
  });

  test("keeps real folder edits observable", () => {
    expect(
      isFolderCollapseOnlyChange({
        operation: "UPDATE",
        previousDocumentData: folder,
        documentData: { ...folder, name: "To read", updatedAt: 11 },
      })
    ).toBe(false);
  });
});
