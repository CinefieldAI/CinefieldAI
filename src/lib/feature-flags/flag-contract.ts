/**
 * Cinefield runtime feature-flag contract (Phase 21-A).
 *
 * ---------------------------------------------------------------------------
 * VENDOR-NEUTRAL BY SHAPE, NOT BY DEPENDENCY
 * ---------------------------------------------------------------------------
 * The roadmap's 21-A package asks for "OpenFeature SDK'yı uygulama tarafında
 * vendor-neutral abstraction olarak kullan" — use the OpenFeature SDK as a
 * vendor-neutral abstraction. This module mirrors OpenFeature's own shape
 * (an evaluation context, a resolved value with a reason, a provider that
 * resolves flags) as Cinefield's OWN types, deliberately WITHOUT installing
 * the `@openfeature/server-sdk` or any `launchdarkly` package.
 *
 * That is not an oversight: `src/test/e2e/phase-7e-runtime-flags.e2e.test.ts`
 * ("no flag SDK credential exists and none is invented") already asserts
 * `package.json` contains neither string, with the stated reason "the
 * contract is an interface a real one can implement." This file IS that
 * interface. A real OpenFeature provider or a LaunchDarkly client can
 * satisfy `FlagProvider` below later without any caller of `evaluateFlag()`
 * changing — the same seam `src/lib/routing/runtime-flags.ts`'s
 * `RuntimeFlagSource` already established for Phase 7's narrower flag set.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS OWNS, AND WHAT IT DOES NOT
 * ---------------------------------------------------------------------------
 * Generic flags only: `maintenance_mode`, `feature.video.enabled`,
 * `uploads.enabled`, `release_stage`. Provider/model/route kill switches
 * stay owned by Phase 7 (`src/lib/routing/`) — nothing here reads or writes
 * `model_providers`, `model_routes`, or Redis A's routing-control keys.
 */

export type FlagRiskTier = "OPERATOR" | "HIGH_RISK_TIER0";
export type FlagValueType = "boolean" | "string" | "enum";
export type FlagValue = boolean | string;

export interface FlagDefinition {
  readonly key: string;
  readonly valueType: FlagValueType;
  /** Only meaningful when `valueType === "enum"`. */
  readonly allowedValues?: readonly string[];
  readonly riskTier: FlagRiskTier;
  readonly defaultValue: FlagValue;
  /** Free text for operators reading the registry — never persisted as a reason_code. */
  readonly description: string;
}

/** The durable row (Supabase `feature_flags`), mapped to TypeScript. */
export interface FlagRecord {
  readonly key: string;
  readonly value: FlagValue;
  readonly rollbackValue: FlagValue | null;
  readonly reasonCode: string | null;
  readonly ticketRef: string | null;
  readonly expiresAt: string | null;
  readonly updatedBy: string;
  readonly updatedAt: string;
}

/**
 * OpenFeature calls this the evaluation context. `targetingKey` is the
 * identity a future percentage rollout buckets on (a Clerk user id) —
 * unused by today's boolean/enum flags, present so `evaluateFlag()`'s
 * signature does not change when a rollout-percentage flag type is added.
 */
export interface FlagEvaluationContext {
  readonly targetingKey?: string;
}

export type FlagEvaluationReason =
  | "STATIC"
  /** No durable row exists yet; the definition's own default was used. */
  | "DEFAULT"
  /** The durable value is past `expiresAt`; `rollbackValue` was used instead. */
  | "EXPIRED_ROLLBACK"
  | "ERROR";

export interface FlagEvaluationDetails<T extends FlagValue = FlagValue> {
  readonly flagKey: string;
  readonly value: T;
  readonly reason: FlagEvaluationReason;
}

/**
 * A flag data source. `LocalSupabaseFlagProvider` (`flag-store.ts`) is the
 * only implementer today. A real OpenFeature/LaunchDarkly provider is a
 * business decision, not a code gap — see this file's header.
 */
export interface FlagProvider {
  resolve(key: string, context: FlagEvaluationContext): Promise<FlagRecord | null>;
}

export const FLAG_KEY_PATTERN = /^[a-z][a-z0-9_.]{1,80}$/;
export const REASON_CODE_PATTERN = /^[a-z][a-z0-9_]{1,64}$/;
export const TICKET_REF_MAX_LENGTH = 120;
