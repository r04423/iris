import { Octokit } from "octokit";
import { z } from "zod";
import { git, isAncestor } from "../runtime.js";

// ============================================================================
// GitHub Client
// ============================================================================

/**
 * Creates the authenticated client and repository coordinates for this workflow.
 * Both environment values are validated before making an API request.
 */
export function github() {
  const repository = z
    .string()
    .regex(/^[^/]+\/[^/]+$/)
    .parse(process.env.GITHUB_REPOSITORY);
  const [owner, repo] = repository.split("/") as [string, string];
  const token = z.string().min(1).parse(process.env.GH_TOKEN);

  return { api: new Octokit({ auth: token }), repository: { owner, repo } };
}

/**
 * Reads an optional GitHub resource.
 * Only HTTP 404 means absence; authentication and service failures propagate.
 */
export async function optional<T>(request: () => Promise<{ data: T }>): Promise<T | null> {
  try {
    const response = await request();

    return response.data;
  } catch (error) {
    if (error instanceof Error && "status" in error && error.status === 404) {
      return null;
    }

    throw error;
  }
}

// ============================================================================
// Stable GitHub Release
// ============================================================================

/**
 * Creates the stable tag and GitHub Release, or resumes a partially completed run.
 *
 * Existing tags must point to the validated commit, and existing releases must
 * contain the reviewed notes. Historical retries must not become the latest release.
 */
export async function ensureGithubRelease(version: string, sha: string, body: string): Promise<void> {
  const { api, repository } = github();
  const tag = `v${version}`;

  // A retry may reuse the tag only when it points to this exact commit.
  const ref = await optional(() => api.rest.git.getRef({ ...repository, ref: `tags/${tag}` }));

  if (ref && (ref.object.type !== "commit" || ref.object.sha !== sha)) {
    throw new Error(`Conflicting tag ${tag}`);
  }

  if (!ref) {
    await api.rest.git.createRef({ ...repository, ref: `refs/tags/${tag}`, sha });
  }

  // Existing release text must match the reviewed changelog, not regenerated notes.
  const existing = await optional(() => api.rest.repos.getReleaseByTag({ ...repository, tag }));

  if (existing) {
    if (existing.body !== body || existing.draft || existing.prerelease) {
      throw new Error(`Conflicting GitHub Release ${tag}`);
    }

    return;
  }

  // An older retry can finish its release without replacing GitHub's latest.
  const latest = await optional(() => api.rest.repos.getLatestRelease(repository));
  const makeLatest = !latest || isAncestor(git("rev-parse", `${latest.tag_name}^{commit}`), sha);

  await api.rest.repos.createRelease({
    ...repository,
    tag_name: tag,
    target_commitish: sha,
    name: tag,
    body,
    make_latest: makeLatest ? "true" : "false",
  });
}
