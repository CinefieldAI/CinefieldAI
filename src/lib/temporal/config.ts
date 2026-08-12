import "server-only";

/**
 * Cinefield Temporal configuration (Phase 6R.2).
 *
 * Reads the server-only environment describing WHICH Temporal namespace to
 * talk to and HOW to authenticate. Follows the same discipline as
 * supabaseAdmin.ts: presence is reported as a boolean, the values themselves
 * are returned only to the client factory and are never logged, never
 * serialized into a Temporal payload, and never exposed through a
 * NEXT_PUBLIC_ variable.
 *
 * SECRET BOUNDARY (locked Phase 6R decision C)
 * In production these values come from AWS Secrets Manager / KMS-backed
 * runtime configuration injected into the ECS task, NOT from a copied
 * .env.local. This module only reads `process.env`, which is the correct
 * seam: ECS injects secrets as environment variables at task start, so the
 * code needs no AWS SDK and no change when the source moves.
 *
 * Temporal Cloud authenticates with an API key. Self-hosted may use mTLS
 * instead. Both are supported here because the runtime target is locked but
 * the namespace is not provisioned yet, and guessing one would strand the
 * other.
 */

export interface TemporalConfig {
  /** `hostname:port`. Temporal Cloud looks like `<ns>.<acct>.tmprl.cloud:7233`. */
  address: string;
  namespace: string;
  /** Temporal Cloud API key. Mutually exclusive with mTLS below. */
  apiKey?: string;
  /** Self-hosted mTLS, PEM contents (not paths — ECS injects values). */
  clientCertPem?: string;
  clientKeyPem?: string;
}

function read(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * True when enough configuration exists to attempt a connection: an address,
 * a namespace, and exactly one authentication method.
 *
 * Never reads a secret's value into a log or a return value — callers get a
 * boolean, exactly like `isSupabaseAdminConfigured()`.
 */
export function isTemporalConfigured(): boolean {
  return readTemporalConfig() !== null;
}

/**
 * Whether Temporal owns generation lifecycle in this deployment
 * (Phase 6R-B — moved here from generation-starter.ts).
 *
 * Lives in this module, not in the starter, so the execution-owner resolver
 * can ask the question without pulling `@temporalio/client` into its import
 * graph. Same two-key rule as every other Cinefield transport: an explicit
 * flag AND real configuration. Credentials alone never switch ownership.
 *
 * WHAT `false` MEANS HAS CHANGED. Before Phase 6R-B it meant "keep running
 * the direct/trigger paths". It now means the deployment has NO generation
 * owner, and the production execution boundary fails closed. There is no
 * fallback owner, because a fallback is how a generation ends up with two
 * lifecycle owners and, eventually, two provider jobs.
 */
export function isTemporalGenerationEnabled(): boolean {
  return process.env.TEMPORAL_GENERATION_ENABLED === "true" && isTemporalConfigured();
}

/**
 * Returns the configuration, or null when it is absent or contradictory.
 *
 * Supplying BOTH an API key and mTLS material is treated as unconfigured
 * rather than silently preferring one: an operator who set both does not
 * know which is in effect, and for a credential that ambiguity is a defect,
 * not a default.
 */
export function readTemporalConfig(): TemporalConfig | null {
  const address = read("TEMPORAL_ADDRESS");
  const namespace = read("TEMPORAL_NAMESPACE");
  if (!address || !namespace) return null;

  const apiKey = read("TEMPORAL_API_KEY");
  const clientCertPem = read("TEMPORAL_CLIENT_CERT");
  const clientKeyPem = read("TEMPORAL_CLIENT_KEY");

  const hasApiKey = apiKey !== undefined;
  const hasMtls = clientCertPem !== undefined && clientKeyPem !== undefined;

  if (hasApiKey && hasMtls) return null;
  if (!hasApiKey && !hasMtls) return null;
  // A half-supplied certificate pair is a misconfiguration, not mTLS.
  if (!hasApiKey && (clientCertPem === undefined) !== (clientKeyPem === undefined)) return null;

  return {
    address,
    namespace,
    ...(hasApiKey ? { apiKey } : {}),
    ...(hasMtls ? { clientCertPem, clientKeyPem } : {}),
  };
}

/**
 * Safe description for logs and health endpoints: says WHETHER Temporal is
 * configured and which auth method is in play, and nothing else. No address,
 * no namespace, and above all no credential.
 */
export function describeTemporalConfig(): {
  configured: boolean;
  authMethod: "api-key" | "mtls" | "none";
} {
  const config = readTemporalConfig();
  if (!config) return { configured: false, authMethod: "none" };
  return { configured: true, authMethod: config.apiKey ? "api-key" : "mtls" };
}
