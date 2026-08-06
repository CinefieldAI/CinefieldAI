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

/**
 * Reads a Cloudflare environment variable and normalizes surrounding
 * whitespace. Copy-pasting a credential into .env.local very easily leaves a
 * trailing space, which would otherwise be sent verbatim inside the
 * Authorization header and rejected by Cloudflare as an invalid token. Every
 * read below goes through this one helper so no call site can skip it.
 *
 * Returns the normalized value, or undefined when unset/blank. Never logs.
 */
function readNormalized(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

/**
 * True only when all three Cloudflare credential/configuration variables are
 * present and non-empty after normalization. Never reads a value out to the
 * caller — boolean only.
 */
export function isCloudflareConfigured(): boolean {
  return REQUIRED_VAR_NAMES.every((name) => readNormalized(name) !== undefined);
}

/**
 * True only when CLOUDFLARE_AI_ENABLED is exactly "true" (after whitespace
 * normalization) AND every credential is present. Credential presence alone
 * must never activate Cloudflare — this is the same double-gate
 * execution-mode.ts already uses for Trigger.dev
 * (GENERATION_EXECUTION_MODE + TRIGGER_SECRET_KEY).
 */
export function isCloudflareEnabled(): boolean {
  return readNormalized("CLOUDFLARE_AI_ENABLED") === "true" && isCloudflareConfigured();
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
    (name) => readNormalized(name) === undefined
  );

  if (missing.length > 0) {
    throw new Error(`Cloudflare AI Gateway is not configured: ${missing[0]} is missing.`);
  }

  // Normalized values only — a stray trailing newline/space from .env.local
  // must never reach an Authorization header or a request URL.
  return {
    accountId: readNormalized("CLOUDFLARE_ACCOUNT_ID") as string,
    gatewayId: readNormalized("CLOUDFLARE_AI_GATEWAY_ID") as string,
    apiToken: readNormalized("CLOUDFLARE_API_TOKEN") as string,
  };
}
