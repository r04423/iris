import { execa } from "execa";
import { z } from "zod";
import { root } from "../runtime.js";
import { type Manifest, manifestSchema } from "./schema.js";

// ============================================================================
// Registry Metadata
// ============================================================================

/**
 * Reads a published package version or npm channel through the npm CLI.
 *
 * Prefers fresh registry metadata so retries can see completed uploads. Missing
 * versions return null; malformed responses and other npm failures remain errors.
 */
export async function registryManifest(name: string, ref: string): Promise<Manifest | null> {
  const result = await execa(
    "npm",
    ["view", `${name}@${ref}`, "--json", "--registry=https://registry.npmjs.org/", "--prefer-online"],
    {
      cwd: root,
      reject: false,
    }
  );

  if (result.exitCode === 0) {
    return manifestSchema.parse(JSON.parse(result.stdout));
  }

  // npm emits structured errors on stdout when --json is supplied.
  const error = z
    .object({ error: z.object({ code: z.string() }) })
    .safeParse(result.stdout.trim() ? JSON.parse(result.stdout) : null);

  if (error.success && error.data.error.code === "E404") {
    return null;
  }

  throw new Error(
    `Cannot read npm metadata for ${name}@${ref}: ${error.success ? error.data.error.code : "npm failed"}`
  );
}
