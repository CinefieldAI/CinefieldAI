import "server-only";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { isSensitive, secretEntry } from "./secret-registry";
import { resolveEnvironment } from "./environment";

/**
 * The server-only secret access boundary (Phase 12-D).
 *
 * ---------------------------------------------------------------------------
 * WHY A BOUNDARY AND NOT A REFACTOR
 * ---------------------------------------------------------------------------
 * Cinefield already has nine `*-config.ts` modules that each read their own
 * variables, validate shape, and report presence as a boolean without ever
 * returning a value. That pattern is good, and rewriting all of them to route
 * through one function would be a large diff across the provider, storage,
 * queue and workflow paths for no security gain — the risk of breaking a
 * working credential path is real and the benefit is aesthetic.
 *
 * So this is a boundary that NEW code uses and that gives the existing config
 * modules a backend to adopt when Phase 25 moves secrets out of the
 * environment. What it buys today:
 *
 *   1. one place where a sensitive read can be swapped for Secrets Manager
 *      without touching a single consumer
 *   2. `server-only`, so a client component importing it fails the build
 *   3. a registry check, so reading an unregistered secret is an error rather
 *      than an undocumented production dependency
 *
 * ---------------------------------------------------------------------------
 * NOTHING HERE LOGS, AND NOTHING RETURNS A VALUE BY ACCIDENT
 * ---------------------------------------------------------------------------
 * `getServerSecret` returns the value because that is its job. Every other
 * export returns a boolean or a name. There is no debug mode, no "log which
 * secrets were read", and no error that embeds a value — a `SecretUnavailable`
 * carries the NAME and a reason code, because the name is what an operator
 * needs and the value is what an attacker needs.
 */

export type SecretUnavailableReason =
  | "not_registered"
  | "not_present"
  | "not_sensitive";

export class SecretUnavailableError extends Error {
  readonly secretName: string;
  readonly reason: SecretUnavailableReason;

  constructor(secretName: string, reason: SecretUnavailableReason) {
    // The NAME is safe and necessary; the value is neither.
    super(`secret_unavailable_${reason}`);
    this.name = "SecretUnavailableError";
    this.secretName = secretName;
    this.reason = reason;
  }
}

/**
 * A source of secret values.
 *
 * Deliberately tiny. A provider that could list secrets, or return them in
 * bulk, would turn one compromised call site into an inventory dump; a
 * provider that could WRITE would put rotation authority in the request path,
 * which roadmap ¶2284 puts behind two-person approval instead.
 *
 * Async because a real secret manager is a network call, even though the
 * environment backend is not. Making the interface synchronous now would
 * force every consumer to change when Phase 25 lands, which is exactly the
 * coupling this boundary exists to avoid.
 */
export interface SecretProvider {
  readonly kind: SecretProviderKind;
  get(name: string): Promise<string | undefined>;
  /** Presence without retrieval. The only thing a report may call. */
  has(name: string): Promise<boolean>;
}

export type SecretProviderKind = "environment" | "aws-secrets-manager";

/**
 * The environment-backed provider — the default, and the only one active
 * until an operator calls `setSecretProvider(new AwsSecretsManagerProvider())`.
 */
export class EnvironmentSecretProvider implements SecretProvider {
  readonly kind = "environment" as const;

  async get(name: string): Promise<string | undefined> {
    const raw = process.env[name];
    return typeof raw === "string" && raw.trim().length > 0 ? raw : undefined;
  }

  async has(name: string): Promise<boolean> {
    return (await this.get(name)) !== undefined;
  }
}

/**
 * The real AWS Secrets Manager backend (Phase 25-B) — exactly the class this
 * file's own header long documented as the seam's eventual second
 * implementation, now filled in.
 *
 * ---------------------------------------------------------------------------
 * NO STATIC AWS CREDENTIAL, MATCHING EVERY OTHER AWS CLIENT IN THIS REPOSITORY
 * ---------------------------------------------------------------------------
 * `new SecretsManagerClient({ region })` — no `credentials` field. The SDK's
 * default provider chain resolves the identity: the ECS task role in
 * production, a named profile locally. Identical to `sqs-config.ts` and
 * `dr-backup-client.ts`'s own documented reasoning. No AWS access key is
 * read, required, or stored by this class.
 *
 * ---------------------------------------------------------------------------
 * PER-ENVIRONMENT NAMESPACE, NEVER A CROSS-ENVIRONMENT READ
 * ---------------------------------------------------------------------------
 * `secretId(name)` prefixes every lookup with `cinefield/{environment}/` —
 * `resolveEnvironment()` (Phase 12-D), the SAME function `environment.ts`'s
 * own production checks already use. A `staging` process asking for a name
 * can only ever resolve `cinefield/staging/<name>`; the IAM policy Phase
 * 25-A's Terraform defines additionally denies it the KEY needed to decrypt
 * `cinefield/production/*` even if the ARN were guessed — defense at both
 * the namespace and the KMS-key layer, not naming alone.
 *
 * ---------------------------------------------------------------------------
 * CACHED, BOUNDED, AND FAILS CLOSED
 * ---------------------------------------------------------------------------
 * A hit is cached for `cacheTtlMs` (default 5 minutes) so a hot code path
 * does not turn into a Secrets Manager API call per request — real cost and
 * real latency, unlike the environment backend. A miss or any AWS error
 * returns `undefined`, exactly like `EnvironmentSecretProvider` returns
 * `undefined` for an unset variable; `getServerSecret` already turns that
 * into `SecretUnavailableError(name, "not_present")`, so a Secrets Manager
 * outage degrades a caller into the same refusal an unset env var would —
 * never a thrown AWS SDK error leaking into a route handler, and never a
 * cached failure masquerading as success.
 */
export class AwsSecretsManagerProvider implements SecretProvider {
  readonly kind = "aws-secrets-manager" as const;

  private readonly client: SecretsManagerClient;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, { value: string; expiresAt: number }>();

  constructor(options: { region?: string; cacheTtlMs?: number } = {}) {
    this.client = new SecretsManagerClient({ region: options.region ?? process.env.AWS_REGION ?? "us-east-1" });
    this.cacheTtlMs = options.cacheTtlMs ?? 5 * 60 * 1000;
  }

  private secretId(name: string): string {
    return `cinefield/${resolveEnvironment()}/${name}`;
  }

  async get(name: string): Promise<string | undefined> {
    const secretId = this.secretId(name);
    const cached = this.cache.get(secretId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    try {
      const result = await this.client.send(new GetSecretValueCommand({ SecretId: secretId }));
      const value = result.SecretString;
      if (typeof value !== "string" || value.length === 0) return undefined;
      this.cache.set(secretId, { value, expiresAt: Date.now() + this.cacheTtlMs });
      return value;
    } catch {
      // Never distinguishes "not found" from "AWS unreachable" from "denied"
      // in the return value — all three collapse to `undefined`, the same
      // as an unset environment variable. Distinguishing them would mean
      // returning (or logging) enough AWS error detail to be useful for
      // debugging, which risks the secret ID or account context ending up
      // somewhere this file's own header forbids values from reaching.
      return undefined;
    }
  }

  async has(name: string): Promise<boolean> {
    return (await this.get(name)) !== undefined;
  }

  /** Test/rotation-verification seam — never called from request-path code. */
  invalidateCache(name?: string): void {
    if (name) this.cache.delete(this.secretId(name));
    else this.cache.clear();
  }
}

let provider: SecretProvider = new EnvironmentSecretProvider();

/**
 * Which backend is in use. Reported by name so an operator can confirm a
 * production process is not silently reading from the environment after
 * Phase 25 lands.
 */
export function secretProviderKind(): SecretProviderKind {
  return provider.kind;
}

/**
 * Installs a provider. Phase 25's single wiring point, and a test seam.
 *
 * Not a per-call parameter: a caller that can choose its own secret source
 * can choose a weaker one, and "which backend" is a deployment decision
 * rather than a call-site decision.
 */
export function setSecretProvider(next: SecretProvider): void {
  provider = next;
}

/** Restores the default. Used by tests, and by nothing else. */
export function resetSecretProvider(): void {
  provider = new EnvironmentSecretProvider();
}

/**
 * Reads one registered sensitive secret.
 *
 * Refuses an unregistered name. That is the load-bearing part: it means a new
 * credential cannot be introduced by writing a `getServerSecret("NEW_THING")`
 * call, because the registry entry — with its class, its requirement, its
 * rotation procedure and its `.env.example` line — has to exist first. The
 * gate is at the point of use, where someone is actually motivated to skip it.
 *
 * Refuses a non-sensitive name too, so this does not become a general
 * `process.env` wrapper. A region or a bucket name is read directly; routing
 * everything through here would make "was this a secret?" unanswerable by
 * reading the call site.
 */
export async function getServerSecret(name: string): Promise<string> {
  const entry = secretEntry(name);
  if (!entry) throw new SecretUnavailableError(name, "not_registered");
  if (!isSensitive(name)) throw new SecretUnavailableError(name, "not_sensitive");

  const value = await provider.get(name);
  if (value === undefined) throw new SecretUnavailableError(name, "not_present");
  return value;
}

/**
 * Presence, without retrieval.
 *
 * The only thing a health check, a readiness probe or a configuration report
 * may ask. ¶2087: "yalnız boolean/presence kontrolü."
 */
export async function hasServerSecret(name: string): Promise<boolean> {
  if (!secretEntry(name)) return false;
  return provider.has(name);
}
