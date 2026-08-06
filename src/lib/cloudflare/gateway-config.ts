import "server-only";

/**
 * Cloudflare AI Gateway configuration — presence/enablement checks only.
 *
 * Mirrors execution-mode.ts's pattern exactly: credential *presence* alone
 * never activates anything. CLOUDFLARE_AI_ENABLED must also explicitly be
 * "true". This module never logs, masks, hashes, or returns a credential
 * value to a caller outside the server-only Cloudflare client that reads
 * getCloudflareConfig()'s return value directly.
 *
 * This is configuration only — nothing here registers a provider, touches
 * the model registry, or is wired into the generation workflow.
 */

const REQUIRED_VAR_NAMES = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_AI_GATEWAY_ID",
  "CLOUDFLARE_API_TOKEN",
] as const;

type RequiredVarName = (typeof REQUIRED_VAR_NAMES)[number];

function isNonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * True only when all three Cloudflare credential/configuration variables are
 * present and non-empty. Never reads a value out to the caller — boolean
 * only.
 */
export function isCloudflareConfigured(): boolean {
  return REQUIRED_VAR_NAMES.every((name) => isNonEmpty(process.env[name]));
}

/**
 * True only when CLOUDFLARE_AI_ENABLED is exactly "true" AND every
 * credential is present. Credential presence alone must never activate
 * Cloudflare — this is the same double-gate execution-mode.ts already uses
 * for Trigger.dev (GENERATION_EXECUTION_MODE + TRIGGER_SECRET_KEY).
 */
export function isCloudflareEnabled(): boolean {
  return process.env.CLOUDFLARE_AI_ENABLED === "true" && isCloudflareConfigured();
}

export interface CloudflareGatewayConfig {
  accountId: string;
  gatewayId: string;
  apiToken: string;
}

/**
 * Safe server-side configuration getter. Throws a value-free Error naming
 * only the missing variable if configuration is incomplete — the error
 * message never contains the (missing or present) value of any variable,
 * only its name.
 */
export function getCloudflareConfig(): CloudflareGatewayConfig {
  const missing: RequiredVarName[] = REQUIRED_VAR_NAMES.filter(
    (name) => !isNonEmpty(process.env[name])
  );

  if (missing.length > 0) {
    throw new Error(`Cloudflare AI Gateway is not configured: ${missing[0]} is missing.`);
  }

  return {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID as string,
    gatewayId: process.env.CLOUDFLARE_AI_GATEWAY_ID as string,
    apiToken: process.env.CLOUDFLARE_API_TOKEN as string,
  };
}
