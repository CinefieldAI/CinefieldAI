/**
 * Cinefield Temporal workflow identity (Phase 6R.2).
 *
 * The workflow id is a correctness mechanism, not a label. Temporal allows
 * only ONE open workflow per id in a namespace, so deriving the id
 * deterministically from the generation id makes "two workflows racing over
 * the same generation" impossible at the server, before any Cinefield code
 * runs. That is the "unique Temporal workflow correlation" the locked B3
 * decision requires, and it is the outermost of the four duplicate-work
 * guards:
 *
 *   1. Temporal workflow id uniqueness        (this file)
 *   2. one active attempt per generation      (DB constraint, Phase 6R.6)
 *   3. UNIQUE(provider, provider_job_id)      (DB constraint, Phase 6R.6)
 *   4. attempt evidence check before submit   (activity, Phase 6R.3)
 *
 * The id must therefore be a pure function of the generation id — never a
 * timestamp, a random value, or an attempt number, all of which would let a
 * retry open a second workflow for the same generation.
 *
 * No imports and no secrets: the id is shared vocabulary between the Next.js
 * API that starts a workflow and the ECS worker that runs it.
 */

const GENERATION_WORKFLOW_PREFIX = "gen";

/**
 * Deterministic workflow id for one generation.
 *
 * Stable across retries, restarts, deployments and transports: the same
 * generation always maps to the same id, so a duplicate start attempt is
 * rejected by Temporal instead of producing a second workflow.
 */
export function generationWorkflowId(generationId: string): string {
  return `${GENERATION_WORKFLOW_PREFIX}:${generationId}`;
}

/**
 * Recovers the generation id from a workflow id, or null if the id was not
 * produced by `generationWorkflowId`. Used by operational tooling
 * (reconciliation, admin) to map a Temporal run back to a row without
 * guessing at string shapes.
 */
export function generationIdFromWorkflowId(workflowId: string): string | null {
  const prefix = `${GENERATION_WORKFLOW_PREFIX}:`;
  if (!workflowId.startsWith(prefix)) return null;
  const generationId = workflowId.slice(prefix.length);
  return generationId.length > 0 ? generationId : null;
}
