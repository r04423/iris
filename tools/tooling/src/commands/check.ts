import { checkRelease } from "../release/check.js";
import { command, git } from "../runtime.js";

// ============================================================================
// Release Policy Command
// ============================================================================

/**
 * Checks a PR against its supplied base, or a merged commit against its parent.
 * Reports stable release intent without making repository or registry changes.
 */
function main(): void {
  const baseSha = process.env.PR_BASE_SHA || git("rev-parse", "HEAD^");
  const record = checkRelease(baseSha);

  if (!record) {
    console.log("No stable release requested");
    return;
  }

  console.log(`Valid release preparation for ${record.version}`);
}

await command("Release policy", main);
