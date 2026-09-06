import { z } from "zod";
import { github, optional } from "../release/github.js";
import { readJSON } from "../runtime.js";

// ============================================================================
// Managed Ruleset
// ============================================================================

/**
 * Validates the repository-owned protection settings before sending them to GitHub.
 * Only the rule types managed by this tool are accepted.
 */
const rulesetSchema = z.object({
  name: z.string(),
  target: z.literal("branch"),
  enforcement: z.literal("active"),
  bypass_actors: z.array(z.never()),
  conditions: z.object({ ref_name: z.object({ include: z.array(z.string()), exclude: z.array(z.string()) }) }),
  rules: z.array(
    z.discriminatedUnion("type", [
      z.object({ type: z.literal("deletion") }),
      z.object({ type: z.literal("non_fast_forward") }),
      z.object({
        type: z.literal("pull_request"),
        parameters: z.object({
          required_approving_review_count: z.number().int(),
          dismiss_stale_reviews_on_push: z.boolean(),
          require_code_owner_review: z.boolean(),
          require_last_push_approval: z.boolean(),
          required_review_thread_resolution: z.boolean(),
          allowed_merge_methods: z.array(z.literal("squash")),
        }),
      }),
      z.object({
        type: z.literal("required_status_checks"),
        parameters: z.object({
          strict_required_status_checks_policy: z.boolean(),
          do_not_enforce_on_create: z.boolean(),
          required_status_checks: z.array(z.object({ context: z.string(), integration_id: z.number().int() })),
        }),
      }),
    ])
  ),
});

// ============================================================================
// Repository Configuration
// ============================================================================

/**
 * Inspects managed protection and optionally applies it after CI has succeeded.
 *
 * Only the named ruleset, merge methods, and missing release label are changed.
 * Other settings are preserved, and publishing remains separately gated.
 *
 * @param apply - False for inspection; true to apply the proposed configuration
 */
export async function configureRepository(apply: boolean): Promise<void> {
  // Inspect the existing repository before deciding whether any writes are allowed.
  const desired = readJSON(".github/main-ruleset.json", rulesetSchema);
  const { api, repository } = github();
  const rulesets = await api.paginate(api.rest.repos.getRepoRulesets, { ...repository, per_page: 100 });
  const matching = rulesets.filter((rule) => rule.name === desired.name);

  if (matching.length > 1) {
    throw new Error("Duplicate managed rulesets; resolve them in GitHub first");
  }

  const { data: repo } = await api.rest.repos.get(repository);

  if (repo.default_branch !== "main") {
    throw new Error("Expected main as the default branch");
  }

  console.log(JSON.stringify({ existingRulesets: rulesets, proposedRuleset: desired, squashOnly: true }, null, 2));

  if (!apply) {
    return;
  }

  // Protection is applied only after both required checks pass on current main.
  const { data: main } = await api.rest.repos.getCommit({ ...repository, ref: "main" });
  const checks = await api.paginate(api.rest.checks.listForRef, { ...repository, ref: main.sha, per_page: 100 });

  for (const name of ["validate", "release-policy"]) {
    if (!checks.some((check) => check.name === name && check.app?.id === 15368 && check.conclusion === "success")) {
      throw new Error(`First run CI successfully on main; missing ${name}`);
    }
  }

  // Update only our named ruleset, preserving unrelated repository protections.
  if (matching[0]) {
    await api.rest.repos.updateRepoRuleset({ ...repository, ...desired, ruleset_id: matching[0].id });
  } else {
    await api.rest.repos.createRepoRuleset({ ...repository, ...desired });
  }

  await api.rest.repos.update({
    ...repository,
    allow_squash_merge: true,
    allow_merge_commit: false,
    allow_rebase_merge: false,
  });

  // Generated notes exclude this housekeeping label; create it only if absent.
  const label = await optional(() => api.rest.issues.getLabel({ ...repository, name: "release" }));

  if (!label) {
    await api.rest.issues.createLabel({
      ...repository,
      name: "release",
      color: "5319e7",
      description: "Automated stable release preparation",
    });
  }

  console.log("Main protection and squash-only merges configured; publishing remains separately gated");
}
