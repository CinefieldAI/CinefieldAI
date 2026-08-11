/**
 * Cinefield BullMQ job payload contracts (Phase 6R.8).
 *
 * No network, no I/O, no "server-only" dependency — pure types + validation,
 * safe to import from queue producers, workers, and their tests alike.
 *
 * WHAT MAY GO IN A JOB PAYLOAD
 * Only identifiers/references needed to perform the work — the same
 * discipline the SQS command wire (`src/lib/contracts/command-wire.ts`)
 * already enforces: a job payload must be safe to sit in a queue, be
 * logged, and be re-delivered. Never a secret, an API key, full provider
 * credentials, an enormous media blob, or a raw uploaded file. A worker
 * re-reads whatever it actually needs from the database using the
 * reference — the payload only says WHERE to look, never carries the data
 * itself.
 *
 * NO REAL JOB TYPES DEFINED YET
 * This phase defines the generic reference shape every future real job
 * (thumbnail, notification, cache-refresh, webhook-retry) would use, plus
 * one concrete SYNTHETIC test payload for zero-cost/live foundation
 * validation. It does not invent thumbnail-specific, notification-
 * specific, or webhook-specific fields — none of those jobs have a real
 * handler yet, and guessing their exact shape now would be exactly the
 * kind of "invent fields not currently needed" this phase is told to avoid.
 */

/** Bounded-length, safe-charset identifier — mirrors the discipline used throughout this codebase's other keyspace/wire contracts. */
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function safeId(label: string, value: string): string {
  if (!SAFE_ID_PATTERN.test(value)) {
    throw new Error(`bullmq job-contracts: invalid ${label}`);
  }
  return value;
}

/**
 * The generic shape a real future job would carry: an opaque reference
 * into a durable table (never the record's content itself), plus what kind
 * of entity it points to. `referenceType` is caller-defined (e.g.
 * "generation", "asset", "notification") — not a fixed enum, matching the
 * same "we don't yet know every resource type" reasoning
 * `redis-keys.ts`'s `lockKey()` already applies to its own resourceType.
 */
export interface BullmqJobRef {
  referenceType: string;
  referenceId: string;
  enqueuedAt: string;
}

/**
 * Builds and validates a job reference. Throws synchronously for an
 * invalid referenceType/referenceId — a caller bug, never a runtime/queue
 * condition.
 */
export function buildJobRef(referenceType: string, referenceId: string): BullmqJobRef {
  return {
    referenceType: safeId("referenceType", referenceType),
    referenceId: safeId("referenceId", referenceId),
    enqueuedAt: new Date().toISOString(),
  };
}

/**
 * SYNTHETIC TEST PAYLOAD ONLY — never used by a real production queue.
 * `echo` is deliberately bounded and validated so a test cannot smuggle an
 * arbitrary large/unsafe string through the foundation worker.
 */
export interface SyntheticTestJobPayload {
  testId: string;
  echo: string;
}

const MAX_ECHO_LENGTH = 256;

export function buildSyntheticTestJobPayload(testId: string, echo: string): SyntheticTestJobPayload {
  if (echo.length > MAX_ECHO_LENGTH) {
    throw new Error("bullmq job-contracts: synthetic test echo payload too large");
  }
  return { testId: safeId("testId", testId), echo };
}

export interface SyntheticTestJobResult {
  echoed: string;
  processedAt: string;
}
