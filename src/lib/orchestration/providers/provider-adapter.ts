import type {
  NormalizedGenerationRequest,
  NormalizedOutput,
  ProviderExecutionContext,
  ProviderStatusResult,
  ProviderSubmission,
} from "../types";

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
export interface ProviderAdapter {
  readonly providerId: string;

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
}
