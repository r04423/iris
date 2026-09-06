import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { git, isAncestor, readJSON, requireActions, rootPath, run, writeJSON } from "../runtime.js";
import { github } from "./github.js";
import { bumpVersion, selectReleasePR, sharedVersion } from "./policy.js";
import { bumpSchema, manifestSchema, packagePaths, recordPath } from "./schema.js";

// ============================================================================
// Release Preparation
// ============================================================================

/**
 * Prepares a shared version bump and editable notes against current main.
 *
 * Writes the release files and Action outputs for create-pull-request. The Action
 * owns commits and branch updates; this command never publishes packages. A
 * refresh regenerates notes from main, replacing edits in the earlier preparation.
 */
export async function prepareRelease(): Promise<void> {
  // Validate workflow inputs before changing the checkout.
  requireActions();

  const bump = bumpSchema.parse(process.env.RELEASE_BUMP);
  const output = z.string().min(1).parse(process.env.GITHUB_OUTPUT);
  const temporary = z.string().min(1).parse(process.env.RUNNER_TEMP);

  // Prepare against fresh main, keeping a tracking branch for the PR Action.
  git("fetch", "origin", "main", "--tags");

  const baseSha = git("rev-parse", "origin/main");

  git("checkout", "-B", "main", "origin/main");

  // Derive the shared version and require the previous stable tag to be on main.
  const packages = packagePaths.map((path) => readJSON(path, manifestSchema));
  const previousVersion = sharedVersion(packages);
  const version = bumpVersion(previousVersion, bump);
  const previousTag = `v${previousVersion}`;
  const previousSha = git("rev-parse", "--verify", `${previousTag}^{commit}`);

  if (!isAncestor(previousSha, baseSha)) {
    throw new Error("Previous release tag is not on main");
  }

  // Refuse competing preparations before generating notes or changing files.
  const { api, repository } = github();
  const prs = await api.paginate(api.rest.pulls.list, { ...repository, state: "open", base: "main", per_page: 100 });

  selectReleasePR(prs);

  const { data: notes } = await api.rest.repos.generateReleaseNotes({
    ...repository,
    tag_name: `v${version}`,
    previous_tag_name: previousTag,
    target_commitish: baseSha,
  });

  // Update both manifests before asking pnpm to refresh workspace resolutions.
  for (const [index, path] of packagePaths.entries()) {
    writeJSON(path, { ...packages[index], version });
  }

  run("pnpm", ["install", "--lockfile-only", "--ignore-scripts", "--no-frozen-lockfile"], { stdio: "inherit" });

  writeJSON(recordPath, { previousVersion, previousTag, version, bump, baseSha });

  // Preserve released history and prepend the new editable section.
  const changelog = readFileSync(rootPath("CHANGELOG.md"), "utf8");
  const history = changelog.replace(/^# Changelog\s*/, "");
  const updatedChangelog = `# Changelog\n\n## ${version}\n\n${notes.body.trim()}\n\n${history}`;

  writeFileSync(rootPath("CHANGELOG.md"), updatedChangelog);

  // Pass the PR body through a file so multiline notes remain intact in Actions.
  const bodyPath = join(temporary, "iris-release-pr.md");
  const instructions =
    `Prepared from ${baseSha}. Review and edit CHANGELOG.md, then merge after CI passes. ` +
    "If main advances, rerun Prepare release; this regenerates notes and replaces manual edits.";
  const body = `Release both packages as **${version}** (${bump}).\n\n${instructions}\n\n${notes.body}`;

  writeFileSync(bodyPath, body);
  appendFileSync(output, `version=${version}\nbody-path=${bodyPath}\n`);
}
