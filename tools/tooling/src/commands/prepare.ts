import { prepareRelease } from "../release/prepare.js";
import { command } from "../runtime.js";

// ============================================================================
// Release Preparation Command
// ============================================================================

// The workflow passes validated outputs from this step to create-pull-request.
await command("Prepare release", prepareRelease);
