/**
 * What a provider integration can ACTUALLY do (Phase 8).
 *
 * WHY THIS EXISTS
 * Until now the core discovered an adapter's abilities by duck-typing —
 * `if (adapter.cancel)`. That answers "is there a method", which is not the
 * same question as "does this provider support cancellation", and the gap
 * between the two is where invented behaviour lives. A method can exist and
 * be a stub; a provider can support something the adapter has not implemented
 * yet. Both are worth stating out loud, separately, and neither should be
 * inferred.
 *
 * SO EVERY CAPABILITY IS DECLARED, WITH ITS EVIDENCE.
 * A capability is not a boolean. `unsupported_by_adapter` and
 * `unknown_provider_capability` are different facts with different owners:
 * the first is work Cinefield has not done, the second is something nobody
 * here has verified about the provider. Collapsing them into `false` loses
 * the only information that tells you what to do next.
 *
 * NOTHING HERE IS A GUESS. A capability may be marked supported only when the
 * installed SDK's own type surface, an existing proven implementation, or
 * verifiable provider documentation shows it. Where that evidence is absent
 * the honest value is `unknown_provider_capability`, and the router, the
 * worker and the reports all behave accordingly.
 *
 * Pure types plus one lookup. No I/O.
 */

export type CapabilityStatus =
  /** Implemented AND exercised against the real provider. */
  | "proven"
  /**
   * Implemented against a documented/typed provider surface, but never run
   * against the live provider. The honest state for most of Phase 8.
   */
  | "implemented_not_live_validated"
  /** The provider may support it; this adapter does not. */
  | "unsupported_by_adapter"
  /** Nobody here has verified whether the provider supports it at all. */
  | "unknown_provider_capability";

/** True only when the capability may actually be invoked. */
export function isUsable(status: CapabilityStatus): boolean {
  return status === "proven" || status === "implemented_not_live_validated";
}

/**
 * Can this integration survive a worker dying mid-generation?
 *
 * SEPARATE FROM EVERY OTHER CAPABILITY, because it is a different kind of
 * claim. `cancel` asks what the provider's API offers; this asks whether
 * Cinefield can still finish the job after the process that started it is
 * gone. An adapter can have a complete, correct API surface and still fail
 * this — which is exactly what Gemini and Cloudflare do.
 *
 * IT IS A HARD ROUTING GATE, not a score. A provider that cannot prove
 * restart-safe execution is excluded from the canonical production path
 * before anything is weighed, because the failure it produces is not "a
 * slower generation" but "a job the user was charged for whose output no
 * longer exists".
 */
export type ExecutionDurability =
  /** Proven restart-safe against the real provider. Nothing claims this yet. */
  | "restart_safe"
  /**
   * The recovery path is implemented against a verifiable provider surface
   * and tested with doubles, but never exercised live. Eligible: the code is
   * real, the live confirmation is a separate, honest debt.
   */
  | "implemented_not_live_validated"
  /**
   * No proven way to recover an accepted job after a process failure.
   * INELIGIBLE for canonical production routing.
   */
  | "not_proven"
  /** The provider cannot support durable execution at all. INELIGIBLE. */
  | "unsupported";

/** True only when a provider may be selected for canonical production work. */
export function isProductionDurable(durability: ExecutionDurability): boolean {
  return durability === "restart_safe" || durability === "implemented_not_live_validated";
}

export interface ProviderCapabilityMatrix {
  /** Send work to the provider. Every adapter must support this. */
  submit: CapabilityStatus;
  /** Ask the provider about a job by its own id. */
  status: CapabilityStatus;
  /** Fetch a finished job's output by its own id. */
  result: CapabilityStatus;
  /** Repeated status checks are a supported way to follow a job. */
  polling: CapabilityStatus;
  /** The provider can call Cinefield back when a job finishes. */
  webhook: CapabilityStatus;
  /**
   * Cinefield can VERIFY that a callback genuinely came from this provider.
   *
   * Separate from `webhook` on purpose, and the separation is the point: a
   * provider that can POST to a URL without a verifiable signature gives an
   * unauthenticated ingress, which is worse than no webhook at all. Accepting
   * one requires proving this specific capability, not the one above it.
   */
  webhookAuthentication: CapabilityStatus;
  /** Ask the provider to stop a running job. */
  cancel: CapabilityStatus;
  /**
   * Given an id from an unconfirmed submission, ask the provider whether a
   * job exists. This is what turns AMBIGUOUS into a fact instead of a
   * permanent block.
   */
  reconcileAmbiguousSubmission: CapabilityStatus;
  /** The provider accepts a caller-supplied key and dedupes on it. */
  nativeIdempotency: CapabilityStatus;
  /**
   * How a submission normally completes.
   *
   * "synchronous" means submit() returns finished work; "asynchronous" means
   * it returns a job id to follow. This is execution shape, not a capability,
   * but it belongs in the same declaration because everything above reads
   * differently depending on it.
   */
  executionShape: "synchronous" | "asynchronous";
  /**
   * Whether this integration may run canonical production generations.
   *
   * Deliberately NOT derived from the fields above. An adapter with a full
   * capability matrix can still be undurable, and a minimal one can be
   * perfectly safe — this has to be asserted per integration, with evidence.
   */
  productionExecutionDurability: ExecutionDurability;
}

/** Everything unknown. The starting point for a new integration. */
export const UNKNOWN_CAPABILITIES: ProviderCapabilityMatrix = {
  submit: "unknown_provider_capability",
  status: "unknown_provider_capability",
  result: "unknown_provider_capability",
  polling: "unknown_provider_capability",
  webhook: "unknown_provider_capability",
  webhookAuthentication: "unknown_provider_capability",
  cancel: "unknown_provider_capability",
  reconcileAmbiguousSubmission: "unknown_provider_capability",
  nativeIdempotency: "unknown_provider_capability",
  executionShape: "synchronous",
  // A new integration is not production-safe until someone shows it is.
  productionExecutionDurability: "not_proven",
};
