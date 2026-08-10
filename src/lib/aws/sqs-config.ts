import "server-only";
import { DEFAULT_AWS_REGION } from "./sqs-topology";

/**
 * Cinefield SQS configuration (Phase 6R.4).
 *
 * Server-only, boolean-reporting, value-guarding — the same discipline as
 * the Supabase admin and Temporal config modules.
 *
 * CREDENTIALS
 * Deliberately absent. The SQS client uses the AWS SDK's default credential
 * provider chain: on ECS Fargate that is the task role, locally it is
 * whatever the operator configured externally (profile, SSO, env). No
 * AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY is read, required, or stored by
 * Cinefield code, and none may ever be hardcoded.
 *
 * ENABLEMENT
 * Two independent conditions, both required:
 *   SQS_COMMAND_BUS_ENABLED === "true"   explicit operator intent
 *   provider queue URL present            the transport actually exists
 * Configuration alone never activates dispatch — the same rule every other
 * Cinefield execution gate follows.
 */

export interface SqsConfig {
  region: string;
  /** Full queue URL for the provider execution FIFO queue. */
  providerQueueUrl: string;
}

function read(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function readSqsConfig(): SqsConfig | null {
  const providerQueueUrl = read("CINEFIELD_SQS_PROVIDER_QUEUE_URL");
  if (!providerQueueUrl) return null;
  return {
    region: read("AWS_REGION") ?? DEFAULT_AWS_REGION,
    providerQueueUrl,
  };
}

/** True only when the operator explicitly enabled SQS AND it is configured. */
export function isSqsCommandBusEnabled(): boolean {
  return process.env.SQS_COMMAND_BUS_ENABLED === "true" && readSqsConfig() !== null;
}

/** Safe description for logs: presence and region only, never a URL. */
export function describeSqsConfig(): { enabled: boolean; region: string | null } {
  const config = readSqsConfig();
  return {
    enabled: isSqsCommandBusEnabled(),
    region: config?.region ?? null,
  };
}
