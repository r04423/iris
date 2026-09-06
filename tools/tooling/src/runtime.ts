import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SyncOptions } from "execa";
import { execaSync } from "execa";
import type { z } from "zod";

// ============================================================================
// Repository Paths
// ============================================================================

/** Repository root, independent of the directory from which pnpm was invoked. */
export const root = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Resolves a repository-relative path. Absolute paths remain absolute.
 */
export function rootPath(path: string): string {
  return resolve(root, path);
}

// ============================================================================
// Process Execution
// ============================================================================

/**
 * Runs a command from the repository root and returns its trimmed output.
 *
 * Arguments are passed directly to the process, without shell interpolation.
 * Commands using inherited output return an empty string. Failed commands throw.
 */
export function run(command: string, args: string[], options: SyncOptions = {}): string {
  const result = execaSync(command, args, { cwd: root, ...options });

  if (typeof result.stdout !== "string") {
    return "";
  }

  return result.stdout.trim();
}

/**
 * Runs Git against this checkout and returns its trimmed output.
 */
export function git(...args: string[]): string {
  return run("git", args);
}

// ============================================================================
// JSON Files
// ============================================================================

/**
 * Reads a JSON file and validates it before exposing its contents to callers.
 * Schema errors propagate to the command's error boundary.
 */
export function readJSON<T>(path: string, schema: z.ZodType<T>): T {
  const content = readFileSync(rootPath(path), "utf8");
  const value: unknown = JSON.parse(content);

  return schema.parse(value);
}

/**
 * Writes JSON using the repository's two-space indentation and final newline.
 */
export function writeJSON(path: string, value: unknown): void {
  const content = `${JSON.stringify(value, null, 2)}\n`;

  writeFileSync(rootPath(path), content);
}

// ============================================================================
// Git History
// ============================================================================

/**
 * Checks whether Git can resolve a file at the specified revision.
 * Git's unresolved-object status is treated as absence; other failures throw.
 */
export function existsAt(ref: string, path: string): boolean {
  const result = execaSync("git", ["cat-file", "-e", `${ref}:${path}`], {
    cwd: root,
    reject: false,
  });

  if (result.exitCode === 0) {
    return true;
  }

  if (result.exitCode === 128) {
    return false;
  }

  throw new Error(`Cannot inspect ${ref}:${path}`, { cause: result });
}

/**
 * Reports whether the older commit is an ancestor of, or equal to, the newer one.
 *
 * A negative ancestry result is expected. An unreadable revision is an error,
 * because release ordering must never be guessed from incomplete history.
 */
export function isAncestor(older: string, newer: string): boolean {
  const result = execaSync("git", ["merge-base", "--is-ancestor", older, newer], {
    cwd: root,
    reject: false,
  });

  if (result.exitCode === 0) {
    return true;
  }

  if (result.exitCode === 1) {
    return false;
  }

  throw new Error(`Cannot compare commits ${older} and ${newer}`, { cause: result });
}

// ============================================================================
// Command Boundaries
// ============================================================================

/**
 * Rejects release mutations outside a GitHub Actions run targeting main.
 * Checkout identity and release freshness are checked by the release commands.
 */
export function requireActions(): void {
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REF !== "refs/heads/main") {
    throw new Error("Release mutations run only in GitHub Actions on main");
  }
}

/**
 * Runs an entrypoint with one consistent error message and a failing exit code.
 * The command name supplies context without requiring every helper to log errors.
 */
export async function command(name: string, action: () => void | Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`${name}: ${message}`);
    process.exitCode = 1;
  }
}
