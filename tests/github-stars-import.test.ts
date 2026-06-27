import { describe, expect, test } from "bun:test";
import {
  GITHUB_STARS_SPACE_GROUP_ID,
  buildGitHubStarsImportPlan,
} from "../src/services/github-stars-import";

describe("buildGitHubStarsImportPlan", () => {
  test("keeps GitHub stars in one searchable space group", () => {
    const plan = buildGitHubStarsImportPlan([
      {
        id: "repo-1",
        fullName: "owner/repo",
        url: "https://github.com/owner/repo",
        description: "Useful project",
        language: "TypeScript",
        topics: ["search"],
        ownerLogin: "owner",
        stargazerCount: 42,
      },
    ], { now: 1_764_000_000_000 });

    expect(plan.spaceGroup.id).toBe(GITHUB_STARS_SPACE_GROUP_ID);
    expect(plan.spaces).toHaveLength(1);
    expect(plan.spaces[0].spaceGroupId).toBe(GITHUB_STARS_SPACE_GROUP_ID);
    expect(plan.items[0]).toMatchObject({
      source: "github",
      title: "owner/repo",
      authorUsername: "owner",
      likes: 42,
      isMetaFetched: false,
    });
    expect(plan.items[0].textContent).toContain("Useful project");
  });

  test("splits more than 500 stars into sibling spaces under GitHub Stars", () => {
    const plan = buildGitHubStarsImportPlan(
      Array.from({ length: 801 }, (_, index) => ({
        id: `repo-${index}`,
        fullName: `owner/repo-${index}`,
        url: `https://github.com/owner/repo-${index}`,
      })),
      { now: 1_764_000_000_000 }
    );

    expect(plan.spaces).toHaveLength(2);
    expect(plan.spaces.map((space) => space.spaceGroupId)).toEqual([
      GITHUB_STARS_SPACE_GROUP_ID,
      GITHUB_STARS_SPACE_GROUP_ID,
    ]);
    expect(plan.folders.map((folder) => folder.isCollapsed)).toEqual([true, true]);
    expect(plan.items.filter((item) => item.spaceId === plan.spaces[0].id)).toHaveLength(500);
    expect(plan.items.filter((item) => item.spaceId === plan.spaces[1].id)).toHaveLength(301);
  });

  test("keeps stable item and space identities across syncs so imports merge", () => {
    const stars = [
      { id: "repo-1", fullName: "owner/first", url: "https://github.com/owner/first" },
      { id: "repo-2", fullName: "owner/second", url: "https://github.com/owner/second" },
    ];
    const first = buildGitHubStarsImportPlan(stars, { now: 1_764_000_000_000 });
    const second = buildGitHubStarsImportPlan([...stars].reverse(), { now: 1_765_000_000_000 });

    expect(second.items.map((item) => item.id).sort()).toEqual(first.items.map((item) => item.id).sort());
    expect(second.spaces.map((space) => space.id)).toEqual(first.spaces.map((space) => space.id));
    expect(second.folders.map((folder) => folder.id)).toEqual(first.folders.map((folder) => folder.id));
  });
});
