/**
 * The secret registry (Phase 12-D).
 *
 * Roadmap ¶1645: "Secret manager, environment ayrımı, least privilege,
 * KMS/Secrets rotation/leak runbook'u kur." ¶1686 makes the ordering binding —
 * environment separation and per-provider secret isolation are a Phase 8
 * PRECONDITION, not later work, because "provider sayısı 2–3 iken kolay, 10
 * iken zahmetlidir" (¶1118).
 *
 * ---------------------------------------------------------------------------
 * NAMES ONLY. THIS FILE CONTAINS NO VALUES AND CAN CONTAIN NONE.
 * ---------------------------------------------------------------------------
 * Every entry is a variable NAME plus metadata about it. Nothing here reads
 * `process.env`, so the registry can be imported by a test, printed in a
 * report, or read by a reviewer with no risk at all. ¶2087: "Secret
 * değerlerini hiçbir raporda yazdırma; yalnız boolean/presence kontrolü."
 *
 * ---------------------------------------------------------------------------
 * WHY A REGISTRY AND NOT A COMMENT IN .env.example
 * ---------------------------------------------------------------------------
 * A documented inventory drifts the first time someone adds a variable. This
 * one is executable: tests assert that every `process.env` read in the
 * codebase is registered, that no provider shares a credential with another,
 * that no server secret is `NEXT_PUBLIC_`, and that `.env.example` documents
 * every name. A new variable that skips the registry fails the build rather
 * than quietly becoming an undocumented production dependency.
 */

/**
 * What a variable IS, which decides how it may be handled.
 *
 *   PUBLIC                  deliberately shipped to the browser. A leak is a
 *                           non-event because it was never private.
 *   IDENTIFIER_NON_SECRET   server-side but harmless — a region, a bucket
 *                           name, a namespace. Worth not publishing; not
 *                           worth an incident.
 *   SERVER_SECRET           grants access to Cinefield's own data or identity
 *                           plane. Clerk, Supabase.
 *   INFRA_SECRET            grants access to infrastructure we pay for and
 *                           store state in. Redis, Temporal, AWS, R2.
 *   PROVIDER_SECRET         grants spend at a third party. A leak costs money
 *                           immediately and silently.
 *   LOCAL_ONLY              a developer convenience that must never exist in
 *                           production.
 */
export type SecretClass =
  | "PUBLIC"
  | "IDENTIFIER_NON_SECRET"
  | "SERVER_SECRET"
  | "INFRA_SECRET"
  | "PROVIDER_SECRET"
  | "LOCAL_ONLY";

/**
 * Whether production needs it.
 *
 *   PRODUCTION_REQUIRED   the app is not correct in production without it
 *   OPTIONAL              a feature is off without it, and off is a valid
 *                         production state
 *   DEFERRED              belongs to a phase that has not started. Named now
 *                         so the contract exists before the capability, which
 *                         is the whole point of ¶1686's ordering decision.
 */
export type SecretRequirement = "PRODUCTION_REQUIRED" | "OPTIONAL" | "DEFERRED";

export interface SecretEntry {
  name: string;
  class: SecretClass;
  requirement: SecretRequirement;
  /** Which subsystem owns it. Also the .env.example grouping. */
  group: SecretGroup;
  /**
   * Rotation procedure class. `docs/runbooks/secret-rotation.md` has one
   * section per value here, and a test asserts the section exists — so a new
   * credential class cannot be introduced without a way to rotate it.
   */
  rotation: RotationClass;
  /** Short note. Never a value, never a format, never a length. */
  note: string;
}

export type SecretGroup =
  | "runtime"
  | "clerk"
  | "supabase"
  | "redis-a"
  | "redis-b"
  | "temporal"
  | "provider"
  | "r2"
  | "aws-sqs"
  | "dr"
  | "kafka"
  | "billing"
  | "security-policy"
  | "cloudflare";

/**
 * How a credential is replaced.
 *
 *   DUAL_KEY_OVERLAP  the issuer lets two credentials be valid at once, so
 *                     rotation is zero-downtime: create, deploy, verify,
 *                     revoke.
 *   CUT_OVER          only one credential can be valid. Rotation has a real
 *                     window, however short, and the runbook says so instead
 *                     of pretending otherwise.
 *   MANAGED_ROTATION  a managed rotation schedule will own it once Phase 25
 *                     stands up Secrets Manager (¶2680).
 *   NOT_A_SECRET      nothing to rotate.
 *
 * These are claims about PROVIDERS, and several are honestly unknown until
 * someone reads the current dashboard — those are marked CUT_OVER, which is
 * the safe assumption: planning for an overlap that does not exist produces
 * an outage during an incident, which is the worst possible moment.
 */
export type RotationClass = "DUAL_KEY_OVERLAP" | "CUT_OVER" | "MANAGED_ROTATION" | "NOT_A_SECRET";

/**
 * THE INVENTORY.
 *
 * Sorted by group. Every `process.env.X` in src/, worker/ and scripts/ must
 * appear here — asserted by test, so this list cannot fall behind the code.
 */
export const SECRET_REGISTRY: readonly SecretEntry[] = [
  // ---- app runtime -------------------------------------------------------
  { name: "NODE_ENV", class: "IDENTIFIER_NON_SECRET", requirement: "OPTIONAL", group: "runtime", rotation: "NOT_A_SECRET", note: "Set by the toolchain." },
  { name: "VERCEL_ENV", class: "IDENTIFIER_NON_SECRET", requirement: "OPTIONAL", group: "runtime", rotation: "NOT_A_SECRET", note: "Set by Vercel; production/preview/development." },
  { name: "CINEFIELD_ENV", class: "IDENTIFIER_NON_SECRET", requirement: "PRODUCTION_REQUIRED", group: "runtime", rotation: "NOT_A_SECRET", note: "Cinefield's own environment identity. See environment.ts." },
  { name: "CINEFIELD_LOCAL_PREVIEW", class: "LOCAL_ONLY", requirement: "OPTIONAL", group: "runtime", rotation: "NOT_A_SECRET", note: "Local media preview convenience." },
  { name: "GENERATION_DIRECT_DEV_EXECUTION", class: "LOCAL_ONLY", requirement: "OPTIONAL", group: "runtime", rotation: "NOT_A_SECRET", note: "Inline execution for local debugging. Ignored in production." },
  { name: "GENERATION_EXECUTION_MODE", class: "LOCAL_ONLY", requirement: "DEFERRED", group: "runtime", rotation: "NOT_A_SECRET", note: "RETIRED in 6R-B. Read by nothing; still present in some local files." },
  { name: "CINEFIELD_MEDIA_MODERATION_ENGINE", class: "IDENTIFIER_NON_SECRET", requirement: "OPTIONAL", group: "runtime", rotation: "NOT_A_SECRET", note: "Names the moderation engine; not a credential." },

  // ---- Clerk -------------------------------------------------------------
  { name: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", class: "PUBLIC", requirement: "PRODUCTION_REQUIRED", group: "clerk", rotation: "CUT_OVER", note: "Designed to be public; identifies the Clerk instance." },
  { name: "CLERK_SECRET_KEY", class: "SERVER_SECRET", requirement: "PRODUCTION_REQUIRED", group: "clerk", rotation: "CUT_OVER", note: "Full backend API authority over the identity plane." },
  { name: "NEXT_PUBLIC_CLERK_SIGN_IN_URL", class: "PUBLIC", requirement: "OPTIONAL", group: "clerk", rotation: "NOT_A_SECRET", note: "A path." },
  { name: "NEXT_PUBLIC_CLERK_SIGN_UP_URL", class: "PUBLIC", requirement: "OPTIONAL", group: "clerk", rotation: "NOT_A_SECRET", note: "A path." },
  { name: "NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL", class: "PUBLIC", requirement: "OPTIONAL", group: "clerk", rotation: "NOT_A_SECRET", note: "A path." },
  { name: "NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL", class: "PUBLIC", requirement: "OPTIONAL", group: "clerk", rotation: "NOT_A_SECRET", note: "A path." },
  { name: "CLERK_WEBHOOK_SIGNING_SECRET", class: "SERVER_SECRET", requirement: "DEFERRED", group: "clerk", rotation: "DUAL_KEY_OVERLAP", note: "Phase 12-B. Named now so auth_failure signals have a producer later." },

  // ---- Supabase ----------------------------------------------------------
  { name: "NEXT_PUBLIC_SUPABASE_URL", class: "PUBLIC", requirement: "PRODUCTION_REQUIRED", group: "supabase", rotation: "NOT_A_SECRET", note: "Project URL; public by design." },
  { name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", class: "PUBLIC", requirement: "PRODUCTION_REQUIRED", group: "supabase", rotation: "CUT_OVER", note: "Anon/publishable key. RLS is the real boundary." },
  { name: "SUPABASE_SERVICE_ROLE_KEY", class: "SERVER_SECRET", requirement: "PRODUCTION_REQUIRED", group: "supabase", rotation: "CUT_OVER", note: "Bypasses RLS entirely. The highest-value secret in the system." },
  { name: "SUPABASE_ACCESS_TOKEN", class: "LOCAL_ONLY", requirement: "OPTIONAL", group: "supabase", rotation: "CUT_OVER", note: "Supabase CLI token for local migration work. Never in a deployment." },

  // ---- Redis A (application state) ---------------------------------------
  { name: "REDIS_ENABLED", class: "IDENTIFIER_NON_SECRET", requirement: "PRODUCTION_REQUIRED", group: "redis-a", rotation: "NOT_A_SECRET", note: "Explicit operator intent. Credentials alone never activate." },
  { name: "REDIS_URL", class: "INFRA_SECRET", requirement: "PRODUCTION_REQUIRED", group: "redis-a", rotation: "CUT_OVER", note: "Contains the password inline. Never logged, never returned." },

  // ---- Redis B (BullMQ queue state ONLY — red note ¶244) -----------------
  { name: "BULLMQ_REDIS_ENABLED", class: "IDENTIFIER_NON_SECRET", requirement: "DEFERRED", group: "redis-b", rotation: "NOT_A_SECRET", note: "Separate database, separate credential (6R.25 / ¶1225)." },
  { name: "BULLMQ_REDIS_URL", class: "INFRA_SECRET", requirement: "DEFERRED", group: "redis-b", rotation: "CUT_OVER", note: "MUST NOT equal REDIS_URL. Validated in environment.ts." },

  // ---- Temporal ----------------------------------------------------------
  { name: "TEMPORAL_ADDRESS", class: "IDENTIFIER_NON_SECRET", requirement: "PRODUCTION_REQUIRED", group: "temporal", rotation: "NOT_A_SECRET", note: "host:port." },
  { name: "TEMPORAL_NAMESPACE", class: "IDENTIFIER_NON_SECRET", requirement: "PRODUCTION_REQUIRED", group: "temporal", rotation: "NOT_A_SECRET", note: "Carries the environment in its name — see environment.ts." },
  { name: "TEMPORAL_API_KEY", class: "INFRA_SECRET", requirement: "PRODUCTION_REQUIRED", group: "temporal", rotation: "DUAL_KEY_OVERLAP", note: "Temporal Cloud issues multiple concurrent API keys." },
  { name: "TEMPORAL_CLIENT_CERT", class: "INFRA_SECRET", requirement: "OPTIONAL", group: "temporal", rotation: "DUAL_KEY_OVERLAP", note: "mTLS alternative. PEM contents, not a path." },
  { name: "TEMPORAL_CLIENT_KEY", class: "INFRA_SECRET", requirement: "OPTIONAL", group: "temporal", rotation: "DUAL_KEY_OVERLAP", note: "mTLS alternative. Pairs with the cert." },
  { name: "TEMPORAL_GENERATION_ENABLED", class: "IDENTIFIER_NON_SECRET", requirement: "PRODUCTION_REQUIRED", group: "temporal", rotation: "NOT_A_SECRET", note: "Ownership switch. Off means the boundary fails closed." },

  // ---- providers — ONE SECRET PER PROVIDER (¶1686, KAPI 9) ---------------
  { name: "FAL_KEY", class: "PROVIDER_SECRET", requirement: "OPTIONAL", group: "provider", rotation: "CUT_OVER", note: "fal.ai." },
  { name: "GEMINI_API_KEY", class: "PROVIDER_SECRET", requirement: "OPTIONAL", group: "provider", rotation: "CUT_OVER", note: "Google Gemini." },
  { name: "OPENAI_API_KEY", class: "PROVIDER_SECRET", requirement: "DEFERRED", group: "provider", rotation: "DUAL_KEY_OVERLAP", note: "Phase 8. OpenAI issues multiple concurrent keys." },
  { name: "ELEVENLABS_API_KEY", class: "PROVIDER_SECRET", requirement: "DEFERRED", group: "provider", rotation: "CUT_OVER", note: "Phase 8." },
  { name: "RUNWARE_API_KEY", class: "PROVIDER_SECRET", requirement: "DEFERRED", group: "provider", rotation: "CUT_OVER", note: "Phase 8." },
  { name: "RUNWAYML_API_SECRET", class: "PROVIDER_SECRET", requirement: "DEFERRED", group: "provider", rotation: "CUT_OVER", note: "Phase 8. Runway's own variable name." },
  { name: "REPLICATE_API_TOKEN", class: "PROVIDER_SECRET", requirement: "DEFERRED", group: "provider", rotation: "CUT_OVER", note: "Phase 8." },
  { name: "XAI_API_KEY", class: "PROVIDER_SECRET", requirement: "DEFERRED", group: "provider", rotation: "CUT_OVER", note: "Phase 8." },
  { name: "KLING_API_KEY", class: "PROVIDER_SECRET", requirement: "DEFERRED", group: "provider", rotation: "CUT_OVER", note: "Phase 8." },
  { name: "SEEDANCE_API_KEY", class: "PROVIDER_SECRET", requirement: "DEFERRED", group: "provider", rotation: "CUT_OVER", note: "Phase 8." },
  { name: "AZURE_OPENAI_API_KEY", class: "PROVIDER_SECRET", requirement: "DEFERRED", group: "provider", rotation: "DUAL_KEY_OVERLAP", note: "Phase 8. Azure issues key1/key2 precisely for rotation." },
  { name: "BEDROCK_ROLE_ARN", class: "IDENTIFIER_NON_SECRET", requirement: "DEFERRED", group: "provider", rotation: "NOT_A_SECRET", note: "Phase 8. A role ARN is assumed, never a stored key." },

  // ---- Cloudflare AI Gateway --------------------------------------------
  { name: "CLOUDFLARE_AI_ENABLED", class: "IDENTIFIER_NON_SECRET", requirement: "OPTIONAL", group: "cloudflare", rotation: "NOT_A_SECRET", note: "Off by default." },
  { name: "CLOUDFLARE_ACCOUNT_ID", class: "IDENTIFIER_NON_SECRET", requirement: "OPTIONAL", group: "cloudflare", rotation: "NOT_A_SECRET", note: "An account identifier." },
  { name: "CLOUDFLARE_AI_GATEWAY_ID", class: "IDENTIFIER_NON_SECRET", requirement: "OPTIONAL", group: "cloudflare", rotation: "NOT_A_SECRET", note: "A gateway identifier." },
  { name: "CLOUDFLARE_API_TOKEN", class: "INFRA_SECRET", requirement: "OPTIONAL", group: "cloudflare", rotation: "DUAL_KEY_OVERLAP", note: "Cloudflare allows multiple scoped tokens." },

  // ---- R2 ----------------------------------------------------------------
  { name: "CLOUDFLARE_R2_ENDPOINT", class: "IDENTIFIER_NON_SECRET", requirement: "PRODUCTION_REQUIRED", group: "r2", rotation: "NOT_A_SECRET", note: "An endpoint URL, no credential in it." },
  { name: "CLOUDFLARE_R2_BUCKET", class: "IDENTIFIER_NON_SECRET", requirement: "PRODUCTION_REQUIRED", group: "r2", rotation: "NOT_A_SECRET", note: "A bucket name." },
  { name: "CLOUDFLARE_R2_ACCESS_KEY_ID", class: "INFRA_SECRET", requirement: "PRODUCTION_REQUIRED", group: "r2", rotation: "DUAL_KEY_OVERLAP", note: "R2 supports multiple concurrent API tokens." },
  { name: "CLOUDFLARE_R2_SECRET_ACCESS_KEY", class: "INFRA_SECRET", requirement: "PRODUCTION_REQUIRED", group: "r2", rotation: "DUAL_KEY_OVERLAP", note: "Pairs with the access key id; rotated together." },

  // ---- AWS / SQS ---------------------------------------------------------
  { name: "AWS_REGION", class: "IDENTIFIER_NON_SECRET", requirement: "OPTIONAL", group: "aws-sqs", rotation: "NOT_A_SECRET", note: "A region name." },
  { name: "SQS_COMMAND_BUS_ENABLED", class: "IDENTIFIER_NON_SECRET", requirement: "OPTIONAL", group: "aws-sqs", rotation: "NOT_A_SECRET", note: "Explicit operator intent." },
  { name: "CINEFIELD_SQS_PROVIDER_QUEUE_URL", class: "IDENTIFIER_NON_SECRET", requirement: "OPTIONAL", group: "aws-sqs", rotation: "NOT_A_SECRET", note: "A queue URL. Authority is IAM, not the URL." },
  { name: "CINEFIELD_SQS_PROVIDER_DLQ_URL", class: "IDENTIFIER_NON_SECRET", requirement: "OPTIONAL", group: "aws-sqs", rotation: "NOT_A_SECRET", note: "Phase 15-D/3. The provider DLQ's URL. Read by the manual read-only investigation entrypoint (scripts/dlq-investigate.ts) and, as of Phase 16-B, by the admin redrive executor (sqs-dlq-redrive-executor.ts) — same env var, both readers narrowly scoped. Authority is IAM, not the URL." },

  // ---- DR ----------------------------------------------------------------
  { name: "CINEFIELD_DR_S3_BUCKET", class: "IDENTIFIER_NON_SECRET", requirement: "OPTIONAL", group: "dr", rotation: "NOT_A_SECRET", note: "A bucket name." },
  { name: "CINEFIELD_DR_AWS_REGION", class: "IDENTIFIER_NON_SECRET", requirement: "OPTIONAL", group: "dr", rotation: "NOT_A_SECRET", note: "A region name." },
  { name: "CINEFIELD_DR_AWS_PROFILE", class: "LOCAL_ONLY", requirement: "OPTIONAL", group: "dr", rotation: "NOT_A_SECRET", note: "A local AWS CLI profile name. Production uses a task role." },

  // ---- Kafka / schema registry (activation-ready) ------------------------
  { name: "KAFKA_ENABLED", class: "IDENTIFIER_NON_SECRET", requirement: "DEFERRED", group: "kafka", rotation: "NOT_A_SECRET", note: "Unset. Kafka is activation-ready downstream distribution only." },
  { name: "KAFKA_BROKERS", class: "IDENTIFIER_NON_SECRET", requirement: "DEFERRED", group: "kafka", rotation: "NOT_A_SECRET", note: "Broker list." },
  { name: "EVENT_SCHEMA_REGISTRY_ENABLED", class: "IDENTIFIER_NON_SECRET", requirement: "DEFERRED", group: "kafka", rotation: "NOT_A_SECRET", note: "Off." },
  { name: "GLUE_REGISTRY_NAME", class: "IDENTIFIER_NON_SECRET", requirement: "DEFERRED", group: "kafka", rotation: "NOT_A_SECRET", note: "A registry name." },

  // ---- Trigger.dev (operational tasks only, not generation) --------------
  { name: "TRIGGER_SECRET_KEY", class: "INFRA_SECRET", requirement: "OPTIONAL", group: "runtime", rotation: "CUT_OVER", note: "Operational tasks only. Not a generation owner since 6R-B." },
  { name: "TRIGGER_PROJECT_REF", class: "IDENTIFIER_NON_SECRET", requirement: "OPTIONAL", group: "runtime", rotation: "NOT_A_SECRET", note: "A project reference." },

  // ---- billing (Phase 10) ------------------------------------------------
  { name: "STRIPE_SECRET_KEY", class: "SERVER_SECRET", requirement: "DEFERRED", group: "billing", rotation: "DUAL_KEY_OVERLAP", note: "Phase 10. Named now; no code reads it." },
  { name: "STRIPE_WEBHOOK_SIGNING_SECRET", class: "SERVER_SECRET", requirement: "DEFERRED", group: "billing", rotation: "DUAL_KEY_OVERLAP", note: "Phase 10. Stripe supports rolling with an overlap window." },

  // ---- security / policy -------------------------------------------------
  { name: "ROUTE_ADMIN_CLERK_USER_IDS", class: "IDENTIFIER_NON_SECRET", requirement: "OPTIONAL", group: "security-policy", rotation: "NOT_A_SECRET", note: "An allowlist of user ids. Empty means nobody is an admin." },
  { name: "CINEFIELD_ADMIN_CLERK_USER_IDS", class: "IDENTIFIER_NON_SECRET", requirement: "OPTIONAL", group: "security-policy", rotation: "NOT_A_SECRET", note: "Phase 16/1. Bootstrap allowlist for the Admin Operations Center (/admin). Separate from ROUTE_ADMIN_CLERK_USER_IDS, which stays scoped to Phase 7-B route mutations. Empty means nobody is an admin." },
  { name: "CINEFIELD_ADMIN_OPERATOR_CLERK_USER_IDS", class: "IDENTIFIER_NON_SECRET", requirement: "OPTIONAL", group: "security-policy", rotation: "NOT_A_SECRET", note: "Phase 16-E. Role-separation allowlist for OPERATOR_MUTATION-tier Phase 16 actions. Empty means no one holds operator authority (viewer only)." },
  { name: "CINEFIELD_ADMIN_TIER0_CLERK_USER_IDS", class: "IDENTIFIER_NON_SECRET", requirement: "OPTIONAL", group: "security-policy", rotation: "NOT_A_SECRET", note: "Phase 16-E. The narrowest allowlist — Tier-0/HIGH_RISK_TIER0 admin action eligibility. Empty (its default state) means no one may perform a Tier-0 action, which is the deliberate, honest default while Clerk step-up assurance is unconfigured." },
  { name: "CINEFIELD_TIER0_ENFORCEMENT_MODE", class: "IDENTIFIER_NON_SECRET", requirement: "OPTIONAL", group: "security-policy", rotation: "NOT_A_SECRET", note: "Phase 16-E. Unset/anything but the literal 'enforce' = shadow mode (decision recorded, never blocks). 'enforce' = a Tier-0 DENY actually refuses the caller. See tier0-authorization.ts's header." },
] as const;

const BY_NAME = new Map(SECRET_REGISTRY.map((e) => [e.name, e]));

export function secretEntry(name: string): SecretEntry | undefined {
  return BY_NAME.get(name);
}

/** Classes whose values must never reach a browser, a log, or a document. */
export const SENSITIVE_CLASSES: ReadonlySet<SecretClass> = new Set<SecretClass>([
  "SERVER_SECRET",
  "INFRA_SECRET",
  "PROVIDER_SECRET",
]);

export function isSensitive(name: string): boolean {
  const entry = BY_NAME.get(name);
  return entry ? SENSITIVE_CLASSES.has(entry.class) : true; // unknown = treat as sensitive
}

/**
 * Providers, and the ONE variable each of them uses.
 *
 * Roadmap ¶1686: "Her provider ayrı secret ve ayrı permission scope kullanır;
 * tek compromised CI logunun blast radius'u sınırlanır." A shared
 * `PROVIDER_API_KEY` would make one leaked CI log a full-network compromise,
 * and a test asserts no such generic name exists.
 *
 * The deferred entries are contract only — naming them now is the cheap half
 * of ¶1118's point that this gate is easy at three providers and painful at
 * ten. No adapter is implemented here.
 */
export const PROVIDER_SECRET_NAMES: Readonly<Record<string, string>> = {
  fal: "FAL_KEY",
  google: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  elevenlabs: "ELEVENLABS_API_KEY",
  runware: "RUNWARE_API_KEY",
  runway: "RUNWAYML_API_SECRET",
  replicate: "REPLICATE_API_TOKEN",
  xai: "XAI_API_KEY",
  kling: "KLING_API_KEY",
  seedance: "SEEDANCE_API_KEY",
  azure: "AZURE_OPENAI_API_KEY",
  bedrock: "BEDROCK_ROLE_ARN",
};

/**
 * Names that must NEVER exist.
 *
 * A generic credential is not a mistake someone makes deliberately — it is
 * what happens when a fourth provider is added in a hurry and an existing
 * variable looks reusable. Failing the build is the only reliable way to stop
 * that, so the forbidden shape is named rather than described.
 */
export const FORBIDDEN_SECRET_NAMES: readonly string[] = [
  "PROVIDER_API_KEY",
  "PROVIDER_SECRET",
  "API_KEY",
  "MASTER_API_KEY",
  "AI_API_KEY",
  "SHARED_PROVIDER_KEY",
  "DEFAULT_API_KEY",
];
