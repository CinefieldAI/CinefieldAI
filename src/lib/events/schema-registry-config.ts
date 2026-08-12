import "server-only";

/**
 * Cinefield AWS Glue Schema Registry configuration contract (Phase 6R.15).
 *
 * Server-only, boolean-reporting, value-guarding — the same discipline as
 * `kafka-config.ts`, `sqs-config.ts`, `temporal/config.ts`, `redis-config.ts`
 * and `bullmq-config.ts`.
 *
 * TWO-KEY ENABLEMENT, AS EVERYWHERE ELSE
 *   EVENT_SCHEMA_REGISTRY_ENABLED === "true"   explicit operator intent
 *   AWS_REGION + GLUE_REGISTRY_NAME present    the registry actually exists
 * Configuration alone never activates anything. Nothing here reads AWS at
 * import time, and nothing here holds a credential: Glue authenticates
 * through the standard AWS credential provider chain (task role in ECS),
 * exactly as the SQS client already does. There is deliberately no
 * ACCESS_KEY-shaped field — an empty field that looks like it wants a secret
 * is an invitation to put one in .env.
 *
 * GLUE IS GOVERNANCE, NOT A VALIDATION BYPASS
 * Even fully configured, Glue does not replace the local registry: the
 * producer validates against `event-schemas.ts` before every send. Glue's
 * job is letting consumers OUTSIDE this repository discover and pin a
 * schema version. Nothing in Cinefield's own hot path depends on it.
 */

export interface SchemaRegistryConfig {
  region: string;
  registryName: string;
}

function read(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** True only when the operator explicitly enabled it. Does not imply configured. */
export function isSchemaRegistryEnabled(): boolean {
  return process.env.EVENT_SCHEMA_REGISTRY_ENABLED === "true";
}

/** True only when both non-secret settings are present. Does not imply enabled. */
export function isSchemaRegistryConfigured(): boolean {
  return read("AWS_REGION") !== undefined && read("GLUE_REGISTRY_NAME") !== undefined;
}

/** Resolved config, or null when unusable. Callers must treat null as "do not call AWS". */
export function getSchemaRegistryConfig(): SchemaRegistryConfig | null {
  if (!isSchemaRegistryEnabled()) return null;
  const region = read("AWS_REGION");
  const registryName = read("GLUE_REGISTRY_NAME");
  if (!region || !registryName) return null;
  return { region, registryName };
}

/**
 * Safe description for logs and health checks. Reports the region (not a
 * secret, and already present in the SQS config surface) and only the
 * PRESENCE of a registry name.
 */
export function describeSchemaRegistryConfig(): {
  enabled: boolean;
  configured: boolean;
  region: string | null;
} {
  return {
    enabled: isSchemaRegistryEnabled(),
    configured: isSchemaRegistryConfigured(),
    region: read("AWS_REGION") ?? null,
  };
}
