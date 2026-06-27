import type { GitHubStar } from "./github-stars-import";

type GitHubRepositoryResponse = {
  id?: number;
  node_id?: string;
  full_name?: string;
  html_url?: string;
  description?: string | null;
  topics?: unknown;
  language?: string | null;
  stargazers_count?: number;
  owner?: {
    login?: string;
    avatar_url?: string;
  };
};

type GitHubStarResponse = GitHubRepositoryResponse & {
  starred_at?: string;
  repo?: GitHubRepositoryResponse;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toRepository = (value: GitHubStarResponse): GitHubRepositoryResponse => value.repo || value;

/**
 * GitHub returns repository objects for its recommended media type and wraps
 * them in { repo, starred_at } only for the optional star media type.
 */
export const parseGitHubStarsPage = (payload: unknown): GitHubStar[] | null => {
  if (!Array.isArray(payload)) return null;

  const stars: GitHubStar[] = [];
  for (const row of payload) {
    if (!isRecord(row)) continue;
    const response = row as GitHubStarResponse;
    const repository = toRepository(response);
    const id = typeof repository.node_id === "string" ? repository.node_id : String(repository.id || "");
    const fullName = typeof repository.full_name === "string" ? repository.full_name : "";
    const url = typeof repository.html_url === "string" ? repository.html_url : "";
    if (!id || !fullName || !url) continue;

    const starredAt = typeof response.starred_at === "string" ? Date.parse(response.starred_at) : NaN;
    stars.push({
      id,
      fullName,
      url,
      description: typeof repository.description === "string" ? repository.description : undefined,
      language: typeof repository.language === "string" ? repository.language : undefined,
      topics: Array.isArray(repository.topics)
        ? repository.topics.filter((topic): topic is string => typeof topic === "string")
        : [],
      ownerLogin: repository.owner?.login,
      ownerAvatarUrl: repository.owner?.avatar_url,
      stargazerCount: typeof repository.stargazers_count === "number" ? repository.stargazers_count : undefined,
      starredAt: Number.isFinite(starredAt) ? starredAt : undefined,
    });
  }

  return stars;
};

/**
 * GitHub serves at most 100 stars per page. Explicit page traversal remains
 * reliable even when an extension fetch does not expose the Link header.
 */
export const collectGitHubStarsPages = async (
  fetchPage: (page: number, pageSize: number) => Promise<unknown>,
  pageSize = 100
): Promise<GitHubStar[]> => {
  const starsById = new Map<string, GitHubStar>();

  for (let page = 1; ; page += 1) {
    const payload = await fetchPage(page, pageSize);
    if (!Array.isArray(payload)) throw new Error("GITHUB_STARS_RESPONSE_INVALID");

    const pageStars = parseGitHubStarsPage(payload);
    if (!pageStars) throw new Error("GITHUB_STARS_RESPONSE_INVALID");
    for (const star of pageStars) starsById.set(star.id, star);

    if (payload.length < pageSize) return Array.from(starsById.values());
  }
};
