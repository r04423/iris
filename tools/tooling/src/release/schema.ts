import semver from "semver";
import { z } from "zod";

// ============================================================================
// Release Locations
// ============================================================================

/** Manifests versioned and published together, in publication order. */
export const packagePaths = ["packages/ecs/package.json", "packages/react/package.json"] as const;

/** Fixed branch refreshed by the preparation workflow until the release merges. */
export const releaseBranch = "codex/release-next";

/** Reviewed record connecting a version change to its preparation base. */
export const recordPath = ".github/release-record.json";

// ============================================================================
// Version and Source Identity
// ============================================================================

/** Version increments offered by the manual preparation workflow. */
export const bumpSchema = z.enum(["patch", "minor", "major"]);

/** Full Git commit identity; abbreviated hashes are only used in version strings. */
export const commitSchema = z.string().regex(/^[a-f0-9]{40}$/);

/**
 * Stable package version in canonical SemVer form.
 * Prerelease identifiers, build metadata, and prefixes are not preparation bases.
 */
export const stableVersionSchema = z.string().refine((value) => {
  const parsed = semver.parse(value);

  if (!parsed || semver.valid(value) !== value) {
    return false;
  }

  return parsed.prerelease.length === 0 && parsed.build.length === 0;
}, "Expected a canonical stable version");

// ============================================================================
// Package Manifests
// ============================================================================

/**
 * Fields read from local or published package manifests.
 * Unrelated fields pass through so version updates preserve package metadata.
 */
export const manifestSchema = z
  .object({
    name: z.string(),
    version: z.string(),
    peerDependencies: z.record(z.string(), z.string()).optional(),
    // Older stable releases do not contain the source identity added by this workflow.
    irisRelease: z.object({ commit: commitSchema, channel: z.enum(["latest", "canary"]) }).optional(),
  })
  .passthrough();

/** Publication candidates must include the identity used to verify retries. */
export const publishedManifestSchema = manifestSchema.extend({
  irisRelease: z.object({ commit: commitSchema, channel: z.enum(["latest", "canary"]) }),
});

// ============================================================================
// Preparation Record
// ============================================================================

/**
 * Machine-readable release intent committed alongside the version bump.
 * Cross-field consistency and ancestry are validated by the release policy.
 */
export const releaseRecordSchema = z.object({
  /** Shared stable version before preparation. */
  previousVersion: stableVersionSchema,
  /** Stable tag used as the starting point for generated notes. */
  previousTag: z.string(),
  /** Shared version proposed by this preparation. */
  version: stableVersionSchema,
  /** Maintainer-selected SemVer increment. */
  bump: bumpSchema,
  /** Main commit against which the release was prepared. */
  baseSha: commitSchema,
});

// ============================================================================
// Validated Types
// ============================================================================

/** Local or registry manifest with validated fields and preserved extra metadata. */
export type Manifest = z.infer<typeof manifestSchema>;

/** Manifest carrying the source identity required for publication. */
export type PublishedManifest = z.infer<typeof publishedManifestSchema>;

/** Validated preparation data; policy checks still enforce its relationships. */
export type ReleaseRecord = z.infer<typeof releaseRecordSchema>;

/** Maintainer-selected version increment. */
export type Bump = z.infer<typeof bumpSchema>;

/** Public npm channel selected for a publication candidate. */
export type Channel = PublishedManifest["irisRelease"]["channel"];
