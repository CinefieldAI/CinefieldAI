import type {
  NormalizedGenerationRequest,
  NormalizedOutput,
  ProviderExecutionContext,
  ProviderStatusResult,
  ProviderSubmission,
} from "../types";
import type { ProviderCapabilityMatrix } from "./provider-capabilities";

/**
 * The contract every Cinefield provider adapter implements.
 *
 * Supports both execution modes:
 *  - Synchronous providers do the work inside submit() and return
 *    status "completed"; the orchestrator then calls getResult().
 *  - Asynchronous providers return status "queued"/"processing" from
 *    submit(); a future queue worker polls getStatus() and finally
 *    calls getResult().
 *
 * Adapters read their own credentials from server-only environment
 * variables. No secret is ever passed through ProviderExecutionContext.
 */
/**
 * What an adapter can tell us about an unconfirmed submission (Phase 8).
 *
 * This is the ONLY way an AMBIGUOUS submission ever becomes a fact rather
 * than a permanent block. It answers one question — does a job with this id
 * exist at the provider — and deliberately nothing else: it does not
 * complete, cancel, resubmit or settle anything.
 */
export type ProviderReconciliation =
  /** The provider knows this job. It exists and must not be duplicated. */
  | { outcome: "job_exists"; status: ProviderStatusResult["status"] }
  /**
   * The provider positively reports no such job. Safe to treat as never
   * submitted — and only an adapter that can distinguish "no such job" from
   * "I could not ask" may ever return this.
   */
  | { outcome: "no_such_job" }
  /** The question could not be answered. Stays ambiguous. */
  | { outcome: "unknown"; errorCode?: string };

export interface ProviderAdapter {
  readonly providerId: string;

  /**
   * What this integration can actually do, declared rather than inferred.
   *
   * The core reads this instead of duck-typing method existence: a method may
   * exist and be a stub, and a provider may support something this adapter
   * has not implemented. Both facts belong here, stated separately.
   */
  readonly capabilities: ProviderCapabilityMatrix;

  submit(
    request: NormalizedGenerationRequest,
    context: ProviderExecutionContext
  ): Promise<ProviderSubmission>;

  getStatus?(
    submission: ProviderSubmission,
    context: ProviderExecutionContext
  ): Promise<ProviderStatusResult>;

  getResult?(
    submission: ProviderSubmission,
    context: ProviderExecutionContext
  ): Promise<NormalizedOutput[]>;

  cancel?(
    submission: ProviderSubmission,
    context: ProviderExecutionContext
  ): Promise<void>;

  /**
   * Asks the provider whether an unconfirmed submission produced a job.
   *
   * Implemented ONLY where the provider offers a real lookup by its own job
   * id. An adapter that cannot ask must not implement this — returning
   * "no_such_job" without proof would clear a reconciliation block and let a
   * job that already exists be submitted twice.
   */
  reconcileSubmission?(
    providerJobId: string,
    request: NormalizedGenerationRequest,
    context: ProviderExecutionContext
  ): Promise<ProviderReconciliation>;
}
