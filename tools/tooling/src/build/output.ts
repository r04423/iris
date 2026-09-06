import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { readJSON, rootPath, writeJSON } from "../runtime.js";

// ============================================================================
// Output Discovery
// ============================================================================

/**
 * Lists files recursively, preserving their paths beneath the supplied directory.
 * The compilation task creates the directory before recording or pruning output.
 */
function files(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });

  return entries.flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return files(path);
    }

    return [path];
  });
}

/**
 * Resolves the output owner from the library name accepted by the build command.
 * Keeping the accepted names explicit prevents cleanup outside library output.
 */
function libraryDirectory(name: string | undefined): string {
  if (name === "iris-ecs") {
    return "packages/ecs";
  }

  if (name === "iris-react") {
    return "packages/react";
  }

  throw new Error(`Unknown library: ${name}`);
}

// ============================================================================
// Output Lifecycle
// ============================================================================

/**
 * Cleans, records, or prunes a library's compiled output.
 *
 * Compilation starts with clean output and records the files it produced.
 * Turbo caches that manifest alongside dist. After a cache restoration, pruning
 * removes files from an older build that Turbo's overlay would otherwise retain.
 */
export function manageOutput(action: string | undefined, name: string | undefined): void {
  const directory = libraryDirectory(name);
  const dist = rootPath(`${directory}/dist`);
  const manifest = `${directory}/.build-files.json`;

  if (action === "clean") {
    rmSync(dist, { recursive: true, force: true });
    return;
  }

  if (action === "record") {
    // Relative paths keep the cached manifest portable between checkouts.
    const emittedFiles = files(dist).map((path) => path.slice(dist.length + 1));

    writeJSON(manifest, emittedFiles);
    return;
  }

  if (action === "prune") {
    const expected = new Set(readJSON(manifest, z.array(z.string())));

    for (const path of files(dist)) {
      const relativePath = path.slice(dist.length + 1);

      if (!expected.has(relativePath)) {
        rmSync(path);
      }
    }

    return;
  }

  throw new Error(`Unknown output operation: ${action}`);
}
