import { readFileSync, writeFileSync } from "node:fs";
import { git, isAncestor, readJSON, requireActions, rootPath, run, writeJSON } from "../runtime.js";
import { checkRelease } from "./check.js";
import { ensureGithubRelease } from "./github.js";
import { packPackage } from "./pack.js";
import { canaryVersion, changelogEntry, publishChannel, releasePackages, sharedVersion } from "./policy.js";
import { registryManifest } from "./registry.js";
import { type Channel, commitSchema, manifestSchema, packagePaths } from "./schema.js";

// ============================================================================
// Release Publication
// ============================================================================

/**
 * Publishes the exact validated main commit through npm trusted publishing.
 *
 * A valid version transition publishes stable packages and a GitHub Release first.
 * Every successful run also publishes a deterministic canary. Manifest changes
 * exist only in this checkout and are restored after each channel attempt.
 */
export async function publishRelease(): Promise<void> {
  // Refuse publication unless this checkout is the exact validated main commit.
  requireActions();

  const sha = commitSchema.parse(git("rev-parse", "HEAD"));

  if (sha !== process.env.GITHUB_SHA) {
    throw new Error("Checkout is not the validated workflow commit");
  }

  git("fetch", "origin", "main", "--tags");

  if (!isAncestor(sha, git("rev-parse", "origin/main"))) {
    throw new Error("Commit is not on main");
  }

  // Capture original bytes so temporary publication metadata never persists.
  const stable = checkRelease(git("rev-parse", "HEAD^"));
  const packages = packagePaths.map((path) => readJSON(path, manifestSchema));
  const originals = packagePaths.map((path) => ({
    path: rootPath(path),
    content: readFileSync(rootPath(path), "utf8"),
  }));
  const version = sharedVersion(packages);

  /**
   * Publishes one channel using temporary manifests and verified tarballs.
   * Restores original file contents even when packing or publication fails.
   */
  async function publish(targetVersion: string, channel: Channel): Promise<void> {
    const candidates = releasePackages(packages, targetVersion, sha, channel);

    try {
      // Write all candidate manifests before packing either workspace.
      const tarballs = new Map<string, string>();

      for (const [index, path] of packagePaths.entries()) {
        writeJSON(path, candidates[index]);
      }

      // Inspect both artifacts before the first registry write.
      for (const [index, path] of packagePaths.entries()) {
        const candidate = candidates[index];

        if (!candidate) {
          throw new Error(`Missing release manifest for ${path}`);
        }

        tarballs.set(candidate.name, await packPackage(path, candidate));
      }

      // Policy handles conflicts, completed uploads, and historical channel guards.
      await publishChannel(candidates, {
        get: registryManifest,
        isAncestor,
        /** Uploads the already-inspected artifact under the policy-selected tag. */
        async publish(pkg, tag) {
          const tarball = tarballs.get(pkg.name);

          if (!tarball) {
            throw new Error(`Missing tarball for ${pkg.name}`);
          }

          run("npm", ["publish", tarball, "--tag", tag, "--access", "public", "--provenance", "--ignore-scripts"], {
            stdio: "inherit",
          });
        },
      });
    } finally {
      // Restore exact file contents even when a registry operation fails.
      for (const original of originals) {
        writeFileSync(original.path, original.content);
      }
    }
  }

  // Complete stable publication before creating the canary for this same commit.
  if (stable) {
    await publish(version, "latest");

    const changelog = readFileSync(rootPath("CHANGELOG.md"), "utf8");
    const notes = changelogEntry(changelog, version);

    await ensureGithubRelease(version, sha, notes);
  }

  const commitCount = Number(git("rev-list", "--count", sha));
  const canary = canaryVersion(version, commitCount, sha);

  await publish(canary, "canary");
}
