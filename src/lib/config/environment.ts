import "server-only";
import { SECRET_REGISTRY, secretEntry } from "./secret-registry";

/**
 * The environment contract (Phase 12-D).
 *
 * Roadmap ¶1645: "environment ayrımı". ¶1680: "prod/staging/dev key ayrımı".
 * ¶1686 makes it a Phase 8 PRECONDITION rather than later work. ¶1646 is the
 * acceptance criterion: "Prod secret repo/local plaintext'te yok ve rotation
 * testli."
 *
 * ---------------------------------------------------------------------------
 * THE FAILURE THIS PREVENTS
 * ---------------------------------------------------------------------------
 * Not "someone typed the wrong password". The realistic accident is a
 * production deployment that inherits a development resource and works — a
 * staging worker writing into the production Redis, a production build
 * pointed at a localhost database that silently fails closed, a preview
 * environment holding a real provider key and spending real money. Each of
 * those looks fine in a health check.
 *
 * So the environment is declared, not inferred, and production is checked
 * against a list of combinations that must never occur. Every check reads
 * SHAPE — a hostname, a scheme, a substring of a namespace — and never a
 * credential.
 *
 * ---------------------------------------------------------------------------
 * NO VALUE EVER LEAVES THIS MODULE
 * ---------------------------------------------------------------------------
 * Findings carry a variable NAME and a reason CODE. There is no field in
 * `ConfigFinding` that can hold a value, which is the enforcement — ¶2087
 * requires presence checks only, and a config error is exactly the kind of
 * string that ends up in a screenshot, a ticket, and a log aggregator.
 */

export type CinefieldEnvironment = "development" | "staging" | "production";

/**
 * Resolves the environment, preferring Cinefield's own declaration.
 *
 * DECLARED, NOT INFERRED. `CINEFIELD_ENV` wins because Vercel's `VERCEL_ENV`
 * has three values that do not match ours — a Vercel "preview" may be a real
 * staging deployment with real staging resources, and treating it as
 * development would exempt it from every check below.
 *
 * The fallback chain is deliberately conservative in one direction only: an
 * unrecognised value resolves to `development`, which is the environment with
 * the FEWEST permissions and the MOST validation exemptions — so a typo can
 * never accidentally grant something. It cannot promote anything to
 * production, and `assertProductionEnvironment` refuses to run at all unless
 * production was named explicitly.
 */
export function resolveEnvironment(): CinefieldEnvironment {
  const declared = process.env.CINEFIELD_ENV?.trim().toLowerCase();
  if (declared === "production" || declared === "staging" || declared === "development") {
    return declared;
  }
  if (process.env.VERCEL_ENV === "production") return "production";
  if (process.env.NODE_ENV === "production") return "production";
  return "development";
}

export function isProduction(): boolean {
  return resolveEnvironment() === "production";
}

/** A refusal reason. Short codes only — see the header. */
export type ConfigReason =
  | "missing_required"
  | "localhost_in_production"
  | "insecure_scheme_in_production"
  | "development_instance_in_production"
  | "test_credential_in_production"
  | "local_only_variable_in_production"
  | "shared_redis_database"
  | "environment_mismatch"
  | "forbidden_variable_name";

export interface ConfigFinding {
  /** The variable NAME. Never its value — there is no field for one. */
  variable: string;
  reason: ConfigReason;
  /** Which environment the finding applies to. */
  environment: CinefieldEnvironment;
}

export interface ConfigValidation {
  environment: CinefieldEnvironment;
  ok: boolean;
  findings: ConfigFinding[];
}

/**
 * A typed configuration failure.
 *
 * The message is the count and the environment. Not the variable list, not
 * the reasons, and certainly not the values — `findings` is available to a
 * caller that wants to render them deliberately, but nothing is baked into a
 * string that will be concatenated into a log line by accident.
 */
export class ConfigurationError extends Error {
  readonly findings: readonly ConfigFinding[];
  readonly environment: CinefieldEnvironment;

  constructor(validation: ConfigValidation) {
    super(`cinefield_config_invalid_${validation.environment}_${validation.findings.length}`);
    this.name = "ConfigurationError";
    this.findings = validation.findings;
    this.environment = validation.environment;
  }
}

/** Present and non-empty. The value is read and immediately discarded. */
function present(name: string): boolean {
  const raw = process.env[name];
  return typeof raw === "string" && raw.trim().length > 0;
}

/**
 * Shape predicates.
 *
 * Each one answers a yes/no question about a value without returning any part
 * of it. They are the only functions in this file that touch a value at all,
 * and each returns a boolean.
 */
function looksLocal(name: string): boolean {
  const raw = process.env[name];
  if (typeof raw !== "string") return false;
  const v = raw.toLowerCase();
  return (
    v.includes("localhost") ||
    v.includes("127.0.0.1") ||
    v.includes("://[::1]") ||
    v.includes("0.0.0.0") ||
    v.includes(".local:") ||
    v.includes("host.docker.internal")
  );
}

function usesInsecureScheme(name: string): boolean {
  const raw = process.env[name];
  if (typeof raw !== "string") return false;
  const v = raw.trim().toLowerCase();
  // `redis:` is Redis without TLS; `http:` is anything else without TLS.
  // 6R.25 (¶1225) requires Redis A and B to run with TLS + auth.
  return v.startsWith("http://") || v.startsWith("redis://");
}

/**
 * Whether a value carries a marker that identifies it as non-production.
 *
 * Issuer-defined prefixes only — `pk_test_`/`sk_test_` are Clerk's and
 * Stripe's own convention for "this key belongs to a development instance".
 * Reading a documented prefix is not reading a secret: it says which
 * environment issued the credential and nothing about the credential itself,
 * and the function returns a boolean either way.
 */
function looksLikeTestCredential(name: string): boolean {
  const raw = process.env[name];
  if (typeof raw !== "string") return false;
  const v = raw.trim();
  return v.startsWith("pk_test_") || v.startsWith("sk_test_") || v.startsWith("whsec_test_");
}

/**
 * Whether two variables point at the same Redis database.
 *
 * Red note ¶244 and 6R.25 (¶1225): Redis A holds application state, Redis B
 * holds BullMQ queue state ONLY, and they run with separate credentials in
 * separate environments. Sharing one instance means a BullMQ flush wipes rate
 * limit counters, connection leases and idempotency records — a correctness
 * failure that looks like an unrelated outage.
 *
 * Compared as whole strings, so nothing is parsed out and nothing is
 * returned.
 */
function sameRedisTarget(): boolean {
  const a = process.env.REDIS_URL?.trim();
  const b = process.env.BULLMQ_REDIS_URL?.trim();
  return Boolean(a && b && a === b);
}

/**
 * Whether a Temporal namespace names a different environment than the one we
 * are running as.
 *
 * A namespace is not a secret — it is `cinefield-dev.<account>` or
 * `cinefield-prod.<account>`, and it is the single clearest signal that a
 * deployment is pointed at the wrong cluster. Checked as a substring so the
 * naming convention can evolve without this becoming a parser.
 */
function namespaceEnvironmentMismatch(env: CinefieldEnvironment): boolean {
  const ns = process.env.TEMPORAL_NAMESPACE?.trim().toLowerCase();
  if (!ns) return false;
  const foreign: Record<CinefieldEnvironment, string[]> = {
    production: ["-dev", "dev.", "-staging", "staging.", "-test"],
    staging: ["-prod", "prod.", "-production"],
    development: [],
  };
  return foreign[env].some((marker) => ns.includes(marker));
}

/**
 * Validates the running configuration.
 *
 * Pure with respect to the process: it reads `process.env`, returns findings,
 * and changes nothing. `assertValidConfiguration` is what turns findings into
 * a refusal, so a caller can inspect without being killed by the inspection.
 */
export function validateConfiguration(): ConfigValidation {
  const environment = resolveEnvironment();
  const findings: ConfigFinding[] = [];
  const add = (variable: string, reason: ConfigReason) =>
    findings.push({ variable, reason, environment });

  // A forbidden generic credential is wrong in every environment — the point
  // of ¶1686 is that the blast radius of a shared key is a whole provider
  // network, and a developer machine leaks through CI logs like anything else.
  for (const name of FORBIDDEN) {
    if (name in process.env) add(name, "forbidden_variable_name");
  }

  if (sameRedisTarget()) add("BULLMQ_REDIS_URL", "shared_redis_database");

  // Everything below is production-only. Development is deliberately
  // unconstrained: localhost, plaintext Redis and test Clerk keys are what a
  // development environment IS, and a validator that refuses them is a
  // validator developers disable.
  if (environment !== "production") {
    return { environment, ok: findings.length === 0, findings };
  }

  for (const entry of SECRET_REGISTRY) {
    if (entry.requirement === "PRODUCTION_REQUIRED" && !present(entry.name)) {
      add(entry.name, "missing_required");
    }
    // A local-only convenience present in production is not harmless: two of
    // them switch execution paths, and one of those bypasses Temporal.
    if (entry.class === "LOCAL_ONLY" && present(entry.name)) {
      add(entry.name, "local_only_variable_in_production");
    }
  }

  // A production deployment pointed at a developer's machine. It does not
  // error — it fails to connect, degrades, and looks like an outage in a
  // dependency.
  for (const name of ["REDIS_URL", "BULLMQ_REDIS_URL", "TEMPORAL_ADDRESS", "NEXT_PUBLIC_SUPABASE_URL", "CLOUDFLARE_R2_ENDPOINT"]) {
    if (present(name) && looksLocal(name)) add(name, "localhost_in_production");
  }

  for (const name of ["REDIS_URL", "BULLMQ_REDIS_URL", "NEXT_PUBLIC_SUPABASE_URL", "CLOUDFLARE_R2_ENDPOINT"]) {
    if (present(name) && usesInsecureScheme(name)) add(name, "insecure_scheme_in_production");
  }

  // A development Clerk instance in production means every user identity is
  // issued by a test tenant.
  for (const name of ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"]) {
    if (present(name) && looksLikeTestCredential(name)) {
      add(name, "development_instance_in_production");
    }
  }

  // Phase 10 has not started, so no Stripe key should exist at all — but if
  // one is added later, a test key in production must not be the way we find
  // out.
  for (const name of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SIGNING_SECRET"]) {
    if (present(name) && looksLikeTestCredential(name)) {
      add(name, "test_credential_in_production");
    }
  }

  if (namespaceEnvironmentMismatch("production")) {
    add("TEMPORAL_NAMESPACE", "environment_mismatch");
  }

  return { environment, ok: findings.length === 0, findings };
}

const FORBIDDEN = [
  "PROVIDER_API_KEY",
  "PROVIDER_SECRET",
  "MASTER_API_KEY",
  "AI_API_KEY",
  "SHARED_PROVIDER_KEY",
  "DEFAULT_API_KEY",
];

/**
 * Fails closed on an invalid production configuration.
 *
 * NOT called at module load anywhere, and that is deliberate rather than an
 * omission. A throw at import time in a Next.js server component takes down
 * every route including the ones that would tell an operator what is wrong,
 * and it happens during a build as readily as during a request. The intended
 * use is an explicit startup check in a long-lived worker, and a health
 * endpoint that reports `ok` plus a finding COUNT.
 *
 * Development never throws: see the note in `validateConfiguration`.
 */
export function assertValidConfiguration(): void {
  const validation = validateConfiguration();
  if (validation.environment !== "production") return;
  if (!validation.ok) throw new ConfigurationError(validation);
}

/**
 * A report safe to log, return from a health endpoint, or paste into a
 * ticket.
 *
 * Names and reason codes. No values, no lengths, no hashes, no prefixes — and
 * the presence map deliberately reports only registered variables, so an
 * unregistered secret someone added cannot be enumerated through it either.
 */
export function configurationReport(): {
  environment: CinefieldEnvironment;
  ok: boolean;
  findings: ConfigFinding[];
  present: Record<string, boolean>;
} {
  const validation = validateConfiguration();
  const presence: Record<string, boolean> = {};
  for (const entry of SECRET_REGISTRY) presence[entry.name] = present(entry.name);
  return { ...validation, present: presence };
}

/**
 * Every `process.env` name the process actually holds that the registry does
 * not know about.
 *
 * An unregistered variable is not automatically wrong — the platform injects
 * plenty — but an unregistered variable that a Cinefield module READS is,
 * because it has no documented class, no rotation procedure and no entry in
 * `.env.example`. The test suite uses this against the names found in source
 * rather than against the live process.
 */
export function unregisteredNames(names: readonly string[]): string[] {
  return names.filter((n) => !secretEntry(n)).sort();
}
