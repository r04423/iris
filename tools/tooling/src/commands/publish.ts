import { publishRelease } from "../release/publish.js";
import { command } from "../runtime.js";

// ============================================================================
// Release Publication Command
// ============================================================================

// The publisher validates workflow identity before touching GitHub or npm.
await command("Publish release", publishRelease);
