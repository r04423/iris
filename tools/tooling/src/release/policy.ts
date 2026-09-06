import { setTimeout as delay } from "node:timers/promises";
import semver from "semver";
import {
  type Bump,
  bumpSchema,
  type Channel,
  type Manifest,
  type PublishedManifest,
  type ReleaseRecord,
  releaseBranch,
  stableVersionSchema,
} from "./schema.js";

// ============================================================================
// Publication Dependencies
// ============================================================================

/**
 * Operations required by the publication policy.
 * Transport and process execution belong to the registry adapter.
 */
export interface Registry {
  /** Reads a version or channel, returning null when it does not exist. */
  get(name: string, ref: string): Promise<Manifest | null>;
  /** Compares source commits using the checkout's full Git history. */
  isAncestor(older: string, newer: string): boolean;
  /** Uploads one artifact under the selected final or archive tag. */
  publish(pkg: PublishedManifest, tag: string): Promise<void>;
}

// ============================================================================
// Version Selection
// ============================================================================

/**
 * Applies a patch, minor, or major increment to a canonical stable version.
 * Uses normal SemVer increments, including major bumps from 0.x to 1.0.0.
 */
export function bumpVersion(version: string, bump: Bump): string {
  stableVersionSchema.parse(version);

  const next = semver.inc(version, bumpSchema.parse(bump));

  if (!next) {
    throw new Error(`Cannot bump ${version}`);
  }

  return next;
}

/**
 * Returns the stable version shared by all release packages.
 * Rejects missing or mismatched versions before preparation or publication.
 */
export function sharedVersion(packages: Manifest[]): string {
  const version = packages[0]?.version;

  if (!version) {
    throw new Error("Missing package version");
  }

  bumpVersion(version, "patch");

  if (packages.some((pkg) => pkg.version !== version)) {
    throw new Error("Package versions must match");
  }

  return version;
}

// ============================================================================
// Release Intent
// ============================================================================

/**
 * Validates a version change against its reviewed preparation record.
 *
 * An unchanged version is an ordinary merge. A changed version must match the
 * selected bump and preparation base exactly; titles and labels do not authorize
 * a stable release. Returns false for ordinary merges and throws for invalid ones.
 */
export function validateTransition(
  previous: Manifest[],
  current: Manifest[],
  record: ReleaseRecord | null,
  baseSha: string,
  recordChanged = false
): boolean {
  const from = sharedVersion(previous);
  const to = sharedVersion(current);

  // Ordinary merges must not introduce a new release record.
  if (from === to) {
    if (recordChanged) {
      throw new Error("Release record changed without a version transition");
    }

    return false;
  }

  // A release record is valid only against this exact integration base.
  if (
    !record ||
    record.previousVersion !== from ||
    record.previousTag !== `v${from}` ||
    record.version !== to ||
    record.baseSha !== baseSha ||
    bumpVersion(from, record.bump) !== to
  ) {
    throw new Error("Invalid or stale release preparation; rerun Prepare release against current main");
  }

  return true;
}

/**
 * Builds a deterministic prerelease version from the stable version and commit.
 * The commit count orders canaries; the hash distinguishes their source commits.
 */
export function canaryVersion(version: string, count: number, sha: string): string {
  bumpVersion(version, "patch");

  if (!Number.isSafeInteger(count) || count < 1 || !/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error("Invalid canary commit identity");
  }

  // Prefix the hash so an all-numeric hash with a leading zero is valid SemVer.
  return `${version}-canary.${count}.g${sha.slice(0, 12)}`;
}

// ============================================================================
// Package Manifests
// ============================================================================

/**
 * Creates publication manifests without changing the original package objects.
 * Records source identity and pins React's ECS peer to this exact release version.
 */
export function releasePackages(
  packages: Manifest[],
  version: string,
  commit: string,
  channel: Channel
): PublishedManifest[] {
  return packages.map((pkg) => {
    const candidate: PublishedManifest = {
      ...pkg,
      version,
      gitHead: commit,
      irisRelease: { commit, channel },
    };

    // React must consume ECS from the same publication, including canaries.
    if (pkg.peerDependencies?.["iris-ecs"]) {
      candidate.peerDependencies = { ...pkg.peerDependencies, "iris-ecs": version };
    }

    return candidate;
  });
}

// ============================================================================
// Release Notes and Pull Requests
// ============================================================================

/**
 * Extracts the reviewed changelog section for one stable version.
 * GitHub-generated subheadings stay in the body; the next version ends the section.
 */
export function changelogEntry(changelog: string, version: string): string {
  const marker = `## ${version}\n`;
  const start = changelog.indexOf(marker);

  if (start < 0) {
    throw new Error(`Missing changelog entry for ${version}`);
  }

  const body = changelog
    .slice(start + marker.length)
    .split(/\n## \d+\.\d+\.\d+\n/)[0]
    ?.trim();

  if (!body) {
    throw new Error("Release notes must not be empty");
  }

  return body;
}

/**
 * Rejects competing release branches before refreshing the fixed release PR.
 * Only the codex/release-next branch may represent an open preparation.
 */
export function selectReleasePR(prs: { head: { ref: string } }[]): void {
  const matching = prs.filter((pr) => pr.head.ref.startsWith("codex/release-"));

  if (matching.length > 1 || (matching[0] && matching[0].head.ref !== releaseBranch)) {
    throw new Error("Resolve existing release PRs before preparing another release");
  }
}

// ============================================================================
// Published Identity
// ============================================================================

/**
 * Checks whether an existing artifact belongs to the expected release.
 * An existing version is reusable only when its source, channel, and ECS peer agree.
 */
export function verifyPublished(existing: Manifest, pkg: PublishedManifest): void {
  if (
    existing.version !== pkg.version ||
    existing.name !== pkg.name ||
    existing.irisRelease?.commit !== pkg.irisRelease.commit ||
    existing.irisRelease?.channel !== pkg.irisRelease.channel ||
    (pkg.peerDependencies?.["iris-ecs"] && existing.peerDependencies?.["iris-ecs"] !== pkg.version)
  ) {
    throw new Error(`Published version conflict: ${pkg.name}@${pkg.version}`);
  }
}

/**
 * Reports whether publication may advance the candidate's npm channel.
 *
 * Commit ancestry prevents older workflow reruns from moving tags backward.
 * Legacy stable packages lack source metadata, so their versions are compared
 * with SemVer instead. Unknown canary identities cannot use that fallback.
 */
export function canPromote(
  current: Manifest | null,
  candidate: PublishedManifest,
  isAncestor: (older: string, newer: string) => boolean
): boolean {
  if (!current) {
    return true;
  }

  if (current.version === candidate.version) {
    verifyPublished(current, candidate);

    return false;
  }

  if (current.irisRelease?.commit) {
    return isAncestor(current.irisRelease.commit, candidate.irisRelease.commit);
  }

  // Existing stable packages predate release metadata. Compare stable versions only.
  if (candidate.irisRelease.channel !== "latest") {
    throw new Error("Unrecognized existing canary identity");
  }

  bumpVersion(current.version, "patch");

  return semver.lt(current.version, candidate.version);
}

// ============================================================================
// Channel Publication
// ============================================================================

/** Delays between visibility checks, totaling one minute of backoff. */
const visibilityDelays = [2_000, 4_000, 8_000, 16_000, 30_000] as const;

/**
 * Waits for a successful upload to become readable through npm's registry.
 *
 * Registry reads can lag behind a completed publish. Retry only missing metadata;
 * conflicts and other registry errors still fail immediately. Never repeat the
 * upload itself, because npm versions are immutable once publication succeeds.
 */
async function waitForPublished(pkg: PublishedManifest, registry: Registry): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const existing = await registry.get(pkg.name, pkg.version);

    if (existing) {
      verifyPublished(existing, pkg);
      return;
    }

    const wait = visibilityDelays[attempt];

    if (wait === undefined) {
      throw new Error(
        `Published package still not visible after ${attempt + 1} checks: ${pkg.name}@${pkg.version}; rerun the workflow`
      );
    }

    console.info(`Waiting ${wait / 1_000}s for npm to expose ${pkg.name}@${pkg.version}`);
    await delay(wait);
  }
}

/**
 * Publishes missing packages after checking every candidate for conflicts.
 *
 * Trusted publishing sets the tag during upload. Existing matching versions are
 * skipped on retry; missing historical versions use an archive tag. Promotion
 * of both packages is non-atomic, so a failed second upload requires a retry.
 */
export async function publishChannel(packages: PublishedManifest[], registry: Registry): Promise<void> {
  const pending = [];

  // Finish the preflight for both packages before the first registry write.
  for (const pkg of packages) {
    const existing = await registry.get(pkg.name, pkg.version);

    if (existing) {
      verifyPublished(existing, pkg);
      continue;
    }

    const current = await registry.get(pkg.name, pkg.irisRelease.channel);
    const tag = canPromote(current, pkg, registry.isAncestor)
      ? pkg.irisRelease.channel
      : `archive-${pkg.irisRelease.commit.slice(0, 12)}`;

    pending.push({ pkg, tag });
  }

  // Upload in order so retries can resume after the last completed package.
  for (const { pkg, tag } of pending) {
    await registry.publish(pkg, tag);

    await waitForPublished(pkg, registry);
  }
}
