import { manageOutput } from "../build/output.js";
import { command } from "../runtime.js";

// ============================================================================
// Build Command
// ============================================================================

/**
 * Reads the output operation and library name supplied by the package script.
 * Output management validates both arguments before touching library files.
 */
function main(): void {
  const action = process.argv[2];
  const library = process.argv[3];

  manageOutput(action, library);
}

await command("Library output", main);
