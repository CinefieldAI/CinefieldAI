import "server-only";
import {
  ConfigurationError,
  assertValidConfiguration,
  resolveEnvironment,
  validateConfiguration,
  type ConfigFinding,
  type CinefieldEnvironment,
} from "./environment";

/**
 * The startup configuration guard (Phase 12-D defect closure, D12-D2).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * `assertValidConfiguration()` shipped complete and tested with ZERO
 * production callers. Environment separation — the whole of roadmap ¶1645's
 * "environment ayrımı" — was enforced by nothing at runtime: a production
 * worker pointed at a development Redis would have been caught by no check
 * that runs.
 *
 * That is the fourth time this repository has produced a complete, tested,
 * unreachable control (D-11-1, D-12-1, the 12-C logger near-miss, and this).
 * The pattern is always the same shape — the mechanism is built, the wiring
 * is left for "the caller", and no caller appears. So the wiring now lives in
 * one named module that three entry points call, where its absence is
 * visible, and a structural test fails if any worker stops calling it.
 *
 * ---------------------------------------------------------------------------
 * IT REFUSES STARTUP. IT DOES NOT DEGRADE.
 * ---------------------------------------------------------------------------
 * An invalid production configuration throws before the worker polls, claims,
 * connects or submits. There is no "fall back to development", no "warn and
 * continue", and no environment variable that turns it off — a guard with a
 * bypass is a guard that will be bypassed during the incident it exists for.
 *
 * ---------------------------------------------------------------------------
 * IT PRINTS REASON CODES AND NOTHING ELSE
 * ---------------------------------------------------------------------------
 * A startup failure is the single most-copied log line in an operations
 * channel. `ConfigFinding` carries a variable NAME and a reason CODE and has
 * no field a value could travel in, so the summary below cannot leak one even
 * if someone widens it later.
 */

/** Which long-lived process is starting. Used only in the log line. */
export type RuntimeName =
  | "temporal-worker"
  | "provider-worker"
  | "realtime-dispatcher";

/**
 * A refusal summary that is safe to print, paste and screenshot.
 *
 * Counts and codes. Deliberately NOT the finding list as JSON: that would
 * print variable names, which is fine, but it invites someone to widen the
 * shape later into something that is not.
 */
export interface StartupRefusal {
  runtime: RuntimeName;
  environment: CinefieldEnvironment;
  findingCount: number;
  /** Distinct reason codes, sorted. Never a value, never a variable list. */
  reasons: string[];
}

export function summarizeRefusal(runtime: RuntimeName, findings: readonly ConfigFinding[]): StartupRefusal {
  return {
    runtime,
    environment: resolveEnvironment(),
    findingCount: findings.length,
    reasons: [...new Set(findings.map((f) => f.reason))].sort(),
  };
}

/**
 * Validates, or throws before the caller does anything else.
 *
 * Called as the FIRST statement of every worker's `main()`, ahead of the
 * Temporal connection, the SQS client, the Supabase client and the dispatch
 * loop. Ordering is asserted structurally, because "it is at the top" is a
 * property a refactor silently breaks.
 *
 * Development and staging pass through: `validateConfiguration` only enforces
 * the production rules in production, and a guard developers have to disable
 * locally protects nothing.
 */
export function assertStartupConfiguration(runtime: RuntimeName): void {
  const environment = resolveEnvironment();

  try {
    assertValidConfiguration();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      const refusal = summarizeRefusal(runtime, error.findings);
      // One line, structured, no value. The process is about to exit; this is
      // the only thing an operator will have.
      console.error("[cinefield:startup] refusing to start", JSON.stringify(refusal));
      throw error;
    }
    throw error;
  }

  console.info(
    "[cinefield:startup]",
    JSON.stringify({ runtime, environment, configuration: "valid" })
  );
}

/**
 * A presence-only health report.
 *
 * Safe facts only: which environment, whether configuration is valid, how
 * many required variables are missing, and the distinct reason codes. It does
 * NOT carry the per-variable presence map — `configurationReport()` in
 * `environment.ts` has that for operational tooling, and this narrower shape
 * is what anything closer to a network boundary should use.
 *
 * NOT exposed as an HTTP route. The roadmap asks for no such endpoint, and an
 * unauthenticated health endpoint that enumerates which secrets are missing
 * tells an attacker exactly which subsystem is half-configured. Callable by
 * operational tooling inside the process; nothing more.
 */
export interface ConfigurationHealth {
  environment: CinefieldEnvironment;
  configuration: "valid" | "invalid";
  missingRequiredCount: number;
  reasons: string[];
  /** Subsystems intentionally off, so "missing" is not read as "broken". */
  deferred: string[];
}

export function configurationHealth(): ConfigurationHealth {
  const validation = validateConfiguration();
  return {
    environment: validation.environment,
    configuration: validation.ok ? "valid" : "invalid",
    missingRequiredCount: validation.findings.filter((f) => f.reason === "missing_required").length,
    reasons: [...new Set(validation.findings.map((f) => f.reason))].sort(),
    // Named rather than derived: these are deliberate deferrals with an
    // owning phase, and a health report that listed them as faults would
    // train operators to ignore it.
    deferred: deferredSubsystems(),
  };
}

/**
 * Subsystems that are off on purpose.
 *
 * Read as booleans from explicit enablement flags — never from credential
 * presence, which is the rule every Cinefield config module already follows
 * (configuration alone never activates anything).
 */
function deferredSubsystems(): string[] {
  const off: string[] = [];
  if (process.env.KAFKA_ENABLED !== "true") off.push("kafka");
  if (process.env.BULLMQ_REDIS_ENABLED !== "true") off.push("redis-b");
  if (process.env.SQS_COMMAND_BUS_ENABLED !== "true") off.push("sqs-command-bus");
  if (process.env.TEMPORAL_GENERATION_ENABLED !== "true") off.push("temporal-generation");
  if (process.env.CLOUDFLARE_AI_ENABLED !== "true") off.push("cloudflare-ai-gateway");
  // Live Secrets Manager and KMS are Phase 25 and have no runtime flag —
  // stated here so a health report never implies they exist.
  off.push("live-secret-manager", "live-kms");
  return off;
}
