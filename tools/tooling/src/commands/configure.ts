import { configureRepository } from "../repository/configure.js";
import { command } from "../runtime.js";

// ============================================================================
// Repository Configuration Command
// ============================================================================

/**
 * Defaults to inspection. Repository changes require the explicit --apply flag.
 */
async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  await configureRepository(apply);
}

await command("Configure repository", main);
