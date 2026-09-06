import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { list } from "tar";
import { rootPath, run } from "../runtime.js";
import { verifyPublished } from "./policy.js";
import { type Manifest, manifestSchema, publishedManifestSchema } from "./schema.js";

// ============================================================================
// Package Artifacts
// ============================================================================

/**
 * Packs a library with pnpm and verifies the artifact before publication.
 *
 * Packing resolves workspace dependencies. Inspection checks the actual manifest,
 * required runtime/declaration entrypoints, and exclusion of compiled test files.
 * Returns the tarball path without publishing it.
 */
export async function packPackage(path: string, pkg: Manifest): Promise<string> {
  // Let pnpm resolve workspace specifications in the artifact manifest.
  const destination = rootPath(`.release-artifacts/${pkg.version}`);

  mkdirSync(destination, { recursive: true });
  run("pnpm", ["--dir", dirname(rootPath(path)), "pack", "--pack-destination", destination], { stdio: "inherit" });

  const tarball = resolve(destination, `${pkg.name}-${pkg.version}.tgz`);

  // Read archive entries without extracting files into the checkout.
  const files = new Set<string>();
  const chunks: Buffer[] = [];

  await list({
    file: tarball,
    /** Records archive paths and collects only the manifest contents. */
    onReadEntry(entry) {
      files.add(entry.path);

      if (entry.path === "package/package.json") {
        entry.on("data", (chunk: Buffer) => chunks.push(chunk));
      }
    },
  });

  // Verify the artifact itself; the source manifest alone cannot prove pack output.
  const packed = manifestSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));

  if (pkg.irisRelease) {
    verifyPublished(packed, publishedManifestSchema.parse(pkg));
  }

  if (packed.name !== pkg.name || packed.version !== pkg.version) {
    throw new Error(`Incorrect packed identity: ${pkg.name}`);
  }

  if (JSON.stringify(packed).includes("workspace:")) {
    throw new Error("Unresolved workspace dependency in tarball");
  }

  if (pkg.peerDependencies?.["iris-ecs"] && packed.peerDependencies?.["iris-ecs"] !== pkg.version) {
    throw new Error("Packed React peer must match ECS exactly");
  }

  // Both runtime code and declarations must be present, with no compiled tests.
  for (const required of ["package/dist/index.js", "package/dist/index.d.ts"]) {
    if (!files.has(required)) {
      throw new Error(`Missing ${required}`);
    }
  }

  const containsTests = [...files].some((file) => /\.test\.(?:d\.)?[cm]?[jt]sx?(\.map)?$/.test(file));

  if (containsTests) {
    throw new Error("Test files in tarball");
  }

  return tarball;
}
