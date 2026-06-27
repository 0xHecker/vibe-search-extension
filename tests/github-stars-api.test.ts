import { expect, test } from "bun:test";
import { collectGitHubStarsPages, parseGitHubStarsPage } from "@src/services/github-stars-api";

const repository = {
  node_id: "R_kgDOexample",
  full_name: "octocat/example",
  html_url: "https://github.com/octocat/example",
  description: "An example repository",
  language: "TypeScript",
  topics: ["bookmarks"],
  stargazers_count: 42,
  owner: { login: "octocat", avatar_url: "https://avatars.githubusercontent.com/u/1" },
};

test("parses the standard GitHub starred-repository response", () => {
  expect(parseGitHubStarsPage([repository])).toEqual([
    {
      id: "R_kgDOexample",
      fullName: "octocat/example",
      url: "https://github.com/octocat/example",
      description: "An example repository",
      language: "TypeScript",
      topics: ["bookmarks"],
      ownerLogin: "octocat",
      ownerAvatarUrl: "https://avatars.githubusercontent.com/u/1",
      stargazerCount: 42,
      starredAt: undefined,
    },
  ]);
});

test("parses GitHub's optional starred-at media type too", () => {
  expect(parseGitHubStarsPage([{ starred_at: "2026-06-22T00:00:00Z", repo: repository }])?.[0]?.starredAt).toBe(
    Date.parse("2026-06-22T00:00:00Z")
  );
});

test("rejects malformed GitHub API payloads", () => {
  expect(parseGitHubStarsPage({ message: "Bad credentials" })).toBeNull();
});

test("collects every page instead of stopping after GitHub's first 100 stars", async () => {
  const stars = Array.from({ length: 801 }, (_, index) => ({
    ...repository,
    node_id: `R_kgDO${index}`,
    full_name: `octocat/example-${index}`,
    html_url: `https://github.com/octocat/example-${index}`,
  }));
  const requestedPages: number[] = [];

  const result = await collectGitHubStarsPages(async (page, pageSize) => {
    requestedPages.push(page);
    return stars.slice((page - 1) * pageSize, page * pageSize);
  });

  expect(result).toHaveLength(801);
  expect(requestedPages).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
});
