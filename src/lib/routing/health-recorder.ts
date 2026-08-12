import "server-only";
import { recordProviderOutcome } from "@/lib/redis/provider-error-rate-store";
import { recordProviderLatency } from "@/lib/redis/provider-latency-store";
import { transitionBreaker } from "@/lib/redis/circuit-breaker-store";
import { recordFailure, recordSuccess } from "./circuit-breaker";
import { classifyFailure, countsAgainstProvider, type FailureClass } from "./failure-classification";

/**
 * Turns one execution outcome into provider health signal (Phase 7-C).
 *
 * ONE PLACE, ON PURPOSE. Both transports — the Temporal activity and the SQS
 * provider worker — reach the provider through `submitAttempt`, so recording
 * here means neither transport can forget to, and neither can invent its own
 * idea of what counts as a provider failure.
 *
 * BEST-EFFORT, ALWAYS. Every call is wrapped: a Redis outage must never fail
 * a generation that otherwise succeeded. The worst case is a router that
 * degrades to static priority, which is exactly Phase 7-B and was production
 * behaviour a day ago.
 *
 * NOTHING SENSITIVE LEAVES. Only ids, a duration, a class name and a boolean.
 * No prompt, no output, no provider payload, no credential.
 */

function log(fields: Record<string, unknown>): void {
  console.info("[cinefield:health-recorder]", JSON.stringify(fields));
}

export interface ExecutionObservation {
  providerId: string;
  providerModelId: string;
  latencyMs: number;
  /** Absent on success. */
  errorCode?: string | null;
  /**
   * True when the outcome is AMBIGUOUS. Ambiguity is not evidence about the
   * provider: the request may have succeeded entirely and only the
   * acknowledgement was lost. Counting it as a failure would open breakers
   * during a network blip on Cinefield's side.
   */
  ambiguous?: boolean;
  /** True when a person cancelled. Never provider evidence. */
  cancelled?: boolean;
}

export type HealthRecordResult =
  | { recorded: true; failureClass: FailureClass; countedAgainstProvider: boolean }
  | { recorded: false; reason: "telemetry_unavailable" | "not_attributable" };

/**
 * Records a successful execution: a success sample, a latency sample, and a
 * breaker success (which is what closes a HALF_OPEN breaker).
 */
export async function recordExecutionSuccess(
  observation: ExecutionObservation,
  now: Date = new Date()
): Promise<HealthRecordResult> {
  try {
    await Promise.all([
      recordProviderOutcome(observation.providerId, "success"),
      recordProviderLatency(observation.providerId, observation.latencyMs),
      transitionBreaker(
        observation.providerId,
        observation.providerModelId,
        (record) => recordSuccess(record, now),
        now
      ),
    ]);
    return { recorded: true, failureClass: "unknown", countedAgainstProvider: false };
  } catch (caught) {
    log({
      providerId: observation.providerId,
      op: "success",
      result: "telemetry_unavailable",
      error: caught instanceof Error ? caught.name : "UnknownError",
    });
    return { recorded: false, reason: "telemetry_unavailable" };
  }
}

/**
 * Records a failed execution — but only against the provider when the failure
 * was actually the provider's.
 *
 * A rejected aspect ratio, a cancelled generation and an unconfirmed
 * submission all reach this function, and none of them may move a breaker.
 * That filtering is the difference between a circuit breaker and a random
 * outage generator.
 */
export async function recordExecutionFailure(
  observation: ExecutionObservation,
  now: Date = new Date()
): Promise<HealthRecordResult> {
  const failureClass = observation.cancelled
    ? "user_cancellation"
    : observation.ambiguous
      ? "unknown"
      : classifyFailure(observation.errorCode);

  if (!countsAgainstProvider(failureClass)) {
    log({
      providerId: observation.providerId,
      op: "failure",
      failureClass,
      result: "not_attributable",
    });
    return { recorded: false, reason: "not_attributable" };
  }

  try {
    await Promise.all([
      recordProviderOutcome(observation.providerId, "failure"),
      recordProviderLatency(observation.providerId, observation.latencyMs),
      transitionBreaker(
        observation.providerId,
        observation.providerModelId,
        (record) => recordFailure(record, now),
        now
      ),
    ]);
    return { recorded: true, failureClass, countedAgainstProvider: true };
  } catch (caught) {
    log({
      providerId: observation.providerId,
      op: "failure",
      failureClass,
      result: "telemetry_unavailable",
      error: caught instanceof Error ? caught.name : "UnknownError",
    });
    return { recorded: false, reason: "telemetry_unavailable" };
  }
}
