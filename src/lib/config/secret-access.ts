import "server-only";
import { isSensitive, secretEntry } from "./secret-registry";

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
 * The environment-backed provider — the only implementation that exists.
 *
 * There is deliberately NO `AwsSecretsManagerProvider` class in this
 * repository yet. Writing one now would produce a module nobody can run, that
 * no test can exercise against a real backend, and that would sit unwired
 * until Phase 25 — the exact defect this project has already closed three
 * times (D-11-1, D-12-1, and the unwired security logger 12-C nearly shipped).
 *
 * What Phase 25 adds is small and fully specified by the interface above:
 * a second class with `kind: "aws-secrets-manager"`, a cached fetch against a
 * per-environment namespace, and one line in `resolveSecretProvider`. No
 * consumer changes. The contract is the deliverable; the implementation
 * belongs with the infrastructure it talks to.
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
