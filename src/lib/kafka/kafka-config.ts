import "server-only";

/**
 * Cinefield Kafka/MSK configuration (Phase 6R.9).
 *
 * Server-only, boolean-reporting, value-guarding — the same discipline as
 * `sqs-config.ts`, `temporal/config.ts`, Redis A's `redis-config.ts`, and
 * Redis B's `bullmq-config.ts`.
 *
 * ENABLEMENT — THE SAME TWO-KEY PATTERN AS EVERY OTHER CINEFIELD TRANSPORT
 *   KAFKA_ENABLED === "true"   explicit operator intent
 *   KAFKA_BROKERS present      the brokers actually exist
 * Configuration alone never activates a connection. No localhost default,
 * no implicit fallback: an unconfigured environment reports unconfigured
 * rather than quietly connecting somewhere unintended.
 *
 * AUTHENTICATION IS DELIBERATELY ABSENT
 * No SASL username/password, no TLS material, no AWS MSK IAM fields are
 * defined here. Cinefield has not yet selected an authentication
 * architecture for its event bus, and inventing credential-shaped config
 * before that decision would bake in a guess that later has to be undone —
 * and would create empty fields that look like they should be filled with
 * secrets. When MSK is actually provisioned (external setup, outside this
 * phase), the chosen auth mechanism gets added here explicitly, reviewed
 * on its own.
 *
 * KAFKA_BROKERS is a comma-separated bootstrap list. It is never logged and
 * never returned by `describeKafkaConfig()` — only presence is reported.
 */

export interface KafkaConfig {
  brokers: string[];
  clientId: string;
}

/** Neutral default; overridable, never secret. */
const DEFAULT_CLIENT_ID = "cinefield";

function read(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** True only when the operator explicitly enabled Kafka. Does not imply configured. */
export function isKafkaEnabled(): boolean {
  return process.env.KAFKA_ENABLED === "true";
}

/** True only when KAFKA_BROKERS is actually present. Does not imply enabled. */
export function isKafkaBrokersPresent(): boolean {
  return read("KAFKA_BROKERS") !== undefined;
}

/**
 * Resolves Kafka configuration, or null when it is not usable — either
 * never explicitly enabled, or no brokers supplied. Callers must treat
 * null as "do not attempt a connection".
 */
export function getKafkaConfig(): KafkaConfig | null {
  if (!isKafkaEnabled()) return null;
  const brokersRaw = read("KAFKA_BROKERS");
  if (!brokersRaw) return null;

  const brokers = brokersRaw
    .split(",")
    .map((b) => b.trim())
    .filter((b) => b.length > 0);
  if (brokers.length === 0) return null;

  return { brokers, clientId: read("KAFKA_CLIENT_ID") ?? DEFAULT_CLIENT_ID };
}

/** Safe description for logs/health checks: presence and broker COUNT only — never a broker address. */
export function describeKafkaConfig(): { configured: boolean; brokerCount: number } {
  const config = getKafkaConfig();
  return { configured: config !== null, brokerCount: config?.brokers.length ?? 0 };
}
