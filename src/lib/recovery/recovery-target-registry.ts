import type { AffectedComponent, RecoveryClass } from "./recovery-contract";

/**
 * RTO/RPO target registry (Phase 15-D/2).
 *
 * ---------------------------------------------------------------------------
 * EMPTY ON PURPOSE
 * ---------------------------------------------------------------------------
 * `RTO_TARGETS` and `RPO_TARGETS` ship with no entries. Setting a recovery
 * time or data-loss commitment is a business decision — it requires someone
 * with the authority to make an SLA promise, and no such approval exists in
 * this repository. `resolveRtoTargetMs`/`resolveRpoTargetSeconds` return
 * `null` for anything not explicitly and validly configured, and the
 * measurement engine treats `null` as `RECOVERED_NO_TARGET`, never as met.
 * Populating either registry is a future, reviewed, business-approved edit
 * to this one file — nothing elsewhere needs to change to consume it.
 */

export type RtoRegistry = Readonly<Partial<Record<RecoveryClass, number>>>;

/** No business-approved RTO target exists yet. */
export const RTO_TARGETS: RtoRegistry = {};

/**
 * Returns a positive, finite target in milliseconds, or `null`.
 *
 * Defensive against a malformed registry entry (NaN, negative, Infinity,
 * non-integer) even though today's registry is empty and internally
 * controlled — a bad config value must resolve to "no target", never to a
 * fabricated zero.
 */
export function resolveRtoTargetMs(recoveryClass: RecoveryClass, registry: RtoRegistry = RTO_TARGETS): number | null {
  const value = registry[recoveryClass];
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * Where Cinefield's own state for a component sits on the
 * durable/replayable/ephemeral spectrum (Phase 15-D master audit, section I).
 *
 *   DURABLE             PostgreSQL, canonical media in R2 — a real data-loss
 *                        event here is a real financial/product incident.
 *   REPLAYABLE_DERIVED   State rebuildable from durable rows (the realtime
 *                        outbox's own debt model already treats it this
 *                        way) — a gap is late delivery, not lost truth.
 *   EPHEMERAL            Redis A caches, provider-health counters — loss is
 *                        tolerable and self-healing by the design already in
 *                        place for these stores.
 *
 * A component absent from this map is not classified — RPO evaluation for it
 * resolves to "no target" rather than a guessed durability class. `sqs` is
 * deliberately absent: `sqs-topology.ts`'s own stated philosophy is that the
 * queue is transport, never the record of truth, so "data loss" is not a
 * property SQS itself has independent of the database.
 */
export type DataDurabilityClass = "DURABLE" | "REPLAYABLE_DERIVED" | "EPHEMERAL";

export const COMPONENT_DURABILITY: Readonly<Partial<Record<AffectedComponent, DataDurabilityClass>>> = {
  supabase: "DURABLE",
  r2: "DURABLE",
  "s3-dr": "DURABLE",
  "redis-a": "EPHEMERAL",
  "redis-b": "EPHEMERAL",
  "realtime-debt": "REPLAYABLE_DERIVED",
};

export type RpoRegistry = Readonly<Partial<Record<AffectedComponent, number>>>;

/** No business-approved RPO target exists yet. */
export const RPO_TARGETS: RpoRegistry = {};

/**
 * Returns a positive, finite target in seconds, or `null` when unconfigured,
 * malformed, or the component has no recognised durability class at all —
 * an RPO commitment for a component with no data-loss meaning would be a
 * fabricated number wearing a real one's shape.
 */
export function resolveRpoTargetSeconds(
  component: AffectedComponent,
  registry: RpoRegistry = RPO_TARGETS
): number | null {
  if (!COMPONENT_DURABILITY[component]) return null;
  const value = registry[component];
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * Recovery classes for which a plain `serviceRestoredAt` timestamp is not
 * enough — restoring database or media state must be VALIDATED (Phase 15-C)
 * before it counts as recovered, per that phase's own governing rule:
 * BACKUP_EXISTS != RESTORE_SUCCEEDED, RESTORE_STARTED != RESTORE_VALIDATED.
 */
export const CLASSES_REQUIRING_RESTORE_VALIDATION: ReadonlySet<RecoveryClass> = new Set([
  "database_recovery",
  "media_recovery",
]);

export function requiresRestoreValidation(recoveryClass: RecoveryClass): boolean {
  return CLASSES_REQUIRING_RESTORE_VALIDATION.has(recoveryClass);
}
