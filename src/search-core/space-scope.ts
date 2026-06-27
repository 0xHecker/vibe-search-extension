export type SearchScope = "current" | "global" | "private" | "public";

/**
 * The scope options surfaced on the search bar's scope chip. Richer than
 * SearchScope because it also covers contextual narrowing ("this collection",
 * "this folder") that has no typed-directive equivalent.
 *  - everywhere : all spaces (global)
 *  - space      : the active space only (current)
 *  - collection : the active collection (group of spaces)
 *  - folder     : the active folder
 *  - private    : the private space only
 *  - public     : public spaces only
 */
export type SearchScopeChoice =
  | "everywhere"
  | "space"
  | "collection"
  | "folder"
  | "private"
  | "public";

/** Collapse a chip choice to the engine scope the query pipeline understands. */
export const scopeChoiceToQueryScope = (choice: SearchScopeChoice): SearchScope => {
  switch (choice) {
    case "space":
      return "current";
    case "private":
      return "private";
    case "public":
      return "public";
    // everywhere / collection / folder all run globally; the space/folder
    // narrowing is applied separately via requestedSpaceIds / folder filters.
    default:
      return "global";
  }
};

/** Map a typed `scope:` directive back to the closest chip choice (for sync). */
export const queryScopeToChoice = (scope: SearchScope): SearchScopeChoice => {
  switch (scope) {
    case "current":
      return "space";
    case "private":
      return "private";
    case "public":
      return "public";
    default:
      return "everywhere";
  }
};

export const resolveSearchSpaceIds = (input: {
  activeSpaceId: string;
  activeSpaceGroupId: string | null;
  activeSpaceGroupSpaceIds: string[];
  requestedScope: SearchScope;
  requestedSpaceIds: string[];
}): string[] => {
  let boundaryIds: string[] = [];
  if (input.activeSpaceGroupId) {
    boundaryIds = input.activeSpaceGroupSpaceIds;
  } else if (input.requestedScope === "current") {
    boundaryIds = [input.activeSpaceId];
  }

  if (input.requestedSpaceIds.length === 0) return boundaryIds;
  if (boundaryIds.length === 0) return input.requestedSpaceIds;

  const boundarySet = new Set(boundaryIds);
  return input.requestedSpaceIds.filter((spaceId) => boundarySet.has(spaceId));
};
