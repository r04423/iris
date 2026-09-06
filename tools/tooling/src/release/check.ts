import { readFileSync } from "node:fs";
import { existsAt, git, isAncestor, readJSON, rootPath } from "../runtime.js";
import { changelogEntry, validateTransition } from "./policy.js";
import { manifestSchema, packagePaths, type ReleaseRecord, recordPath, releaseRecordSchema } from "./schema.js";

// ============================================================================
// Release Policy Check
// ============================================================================

/**
 * Validates the checkout's version transition against the integration base.
 *
 * Returns the preparation record for a stable release, or null for an ordinary
 * merge. Also verifies the previous tag's ancestry and the reviewed changelog text.
 */
export function checkRelease(baseSha: string): ReleaseRecord | null {
  const record = existsAt("HEAD", recordPath) ? readJSON(recordPath, releaseRecordSchema) : null;
  const changed = git("diff", "--name-only", baseSha, "HEAD", "--", recordPath).length > 0;

  // Read the old manifests from Git; current manifests come from this checkout.
  const previous = packagePaths.map((path) => {
    const content = git("show", `${baseSha}:${path}`);

    return manifestSchema.parse(JSON.parse(content));
  });
  const current = packagePaths.map((path) => readJSON(path, manifestSchema));
  const release = validateTransition(previous, current, record, baseSha, changed);

  if (!release || !record) {
    return null;
  }

  // A stable transition also needs a valid history boundary and reviewed notes.
  const previousSha = git("rev-parse", "--verify", `${record.previousTag}^{commit}`);

  if (!isAncestor(previousSha, baseSha)) {
    throw new Error("Previous release tag is not on the preparation base");
  }

  const changelog = readFileSync(rootPath("CHANGELOG.md"), "utf8");

  changelogEntry(changelog, record.version);

  return record;
}
