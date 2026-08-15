/**
 * The telemetry contract (Phase 13-E — Sensitive Data Guard).
 *
 * Roadmap ¶1753, and it is the whole reason this file exists:
 *
 *   "Telemetry = İkinci Veri Kopyası: Daha fazla observability daha fazla
 *    sensitive veri kopyası demektir. … Yaklaşım deny-list değil ALLOW-LIST
 *    olmalıdır."
 *
 * ¶1722 names what must never appear — Clerk token, Stripe payload secret,
 * provider Authorization header, presigned URL, private media URL, cookie,
 * Supabase service key, raw prompt body. ¶1723 is the acceptance test:
 * forbidden fields provably absent from Sentry/OTel/CloudWatch/Better Stack
 * records, with `trace_id`, `generation_id` and `provider_attempt_id`
 * preserved.
 *
 * ---------------------------------------------------------------------------
 * WHY AN ALLOW-LIST IS THE ONLY WORKABLE DIRECTION
 * ---------------------------------------------------------------------------
 * A deny-list has to predict every field anyone will ever add. It fails the
 * first time a developer logs a helpfully-named object, and it fails silently
 * — the data is already in a third party by the time anyone notices, and
 * telemetry cannot be recalled. An allow-list fails in the opposite
 * direction: a useful field goes missing until someone adds it here, which is
 * a code review rather than an incident.
 *
 * ---------------------------------------------------------------------------
 * THIS LIST WAS BUILT FROM WHAT THE CODE ACTUALLY LOGS
 * ---------------------------------------------------------------------------
 * Every field below was found by extracting the keys passed to the 24 existing
 * `log({...})` helpers across src/lib, src/app and worker/ — 37 distinct names,
 * zero object spreads — and then classified one at a time. Nothing was added
 * speculatively, and nothing that existed was admitted without a reason.
 *
 * No "server-only" here on purpose: this is a data contract with no runtime
 * behaviour, and the test suite plus future client-side telemetry contracts
 * need to read it. It touches no environment variable and holds no value.
 */

export type TelemetryLevel = "debug" | "info" | "warn" | "error";

/** How a field's value is validated. */
export type FieldKind =
  | "id" //      an opaque server-side identifier
  | "code" //    a short lowercase code from a bounded vocabulary
  | "name" //    a short human-meaningful label from a bounded set
  | "count" //   a non-negative integer
  | "duration" // milliseconds
  | "bool";

export interface FieldRule {
  kind: FieldKind;
  /** Max characters. Strings longer than this are truncated, never secrets. */
  max?: number;
  /** Why this field is safe AND useful. Both halves are required. */
  why: string;
}

/**
 * Identifier shape.
 *
 * Deliberately narrow: uuids, slugs, short codes, hashed buckets. It rejects
 * anything containing `:`, `/`, `@`, `?`, `.` runs or whitespace — which is
 * most of the ways a URL, a connection string or a JWT could arrive in a field
 * that was supposed to hold an id.
 */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** Short codes, matching the discipline 12-C and 12-E already use. */
export const CODE_PATTERN = /^[a-z][a-z0-9_.-]{0,64}$/;

/** A bounded label — allows a few more characters, still no separators. */
export const NAME_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

/**
 * THE ALLOW-LIST.
 *
 * Anything not named here is dropped. Adding an entry is a deliberate act
 * with a written justification, which is the point.
 */
export const TELEMETRY_ALLOWLIST: Readonly<Record<string, FieldRule>> = {
  // ---- correlation identifiers, named by ¶1753 ---------------------------
  traceId: {
    kind: "id",
    max: 128,
    why: "The correlation id ¶1723 requires end to end. Server-minted, opaque, meaningless outside our own systems.",
  },
  correlationId: {
    kind: "id",
    max: 128,
    why: "The existing name for the same concept in the policy gate and command bus. Kept so 12-E call sites need no rewrite; 13-A converges the two.",
  },
  generationId: {
    kind: "id",
    max: 64,
    why: "Named by ¶1753. A uuid its owner already has; it identifies a row, not a person or a prompt.",
  },
  providerAttemptId: {
    kind: "id",
    max: 64,
    why: "Named by ¶1753 as provider_attempt_id. The roadmap's spelling.",
  },
  attemptId: {
    kind: "id",
    max: 64,
    why: "What the codebase actually calls provider_attempt_id today (179 uses). Same value, existing name — reconciling the spelling is 13-A's job, and dropping it now would blind the provider path.",
  },
  workflowId: {
    kind: "id",
    max: 128,
    why: "Temporal workflow identity, derived from the generation id. Carries no user content.",
  },
  eventId: {
    kind: "id",
    max: 64,
    why: "Outbox and domain event identity — the dedupe key a consumer already sees.",
  },

  /**
   * The tenant scope.
   *
   * ¶1753 explicitly allows `workspace_id`. ONE THING MUST BE SAID PLAINLY:
   * workspaces do not exist yet, so `resolveEffectiveTenant` sets the tenant
   * to the Clerk principal id — logging this field today therefore logs a
   * Clerk user id under a different name.
   *
   * It is still allowed, for two reasons. It is the identifier the roadmap
   * approves for tenant correlation, and it is a pseudonymous account handle
   * rather than PII — no email, no name, nothing that identifies a person
   * outside our own database. And the field name is the one that stays
   * correct once Phase 12-B lands real workspaces, at which point the value
   * diverges from the principal with no call site changing.
   *
   * A field literally named `clerkUserId` is NOT allow-listed and is dropped,
   * so the acting principal cannot be logged in contexts that are not
   * tenant-scoped. See the test for that.
   */
  workspaceId: {
    kind: "id",
    max: 128,
    why: "Named by ¶1753. Tenant scope. Today equals the Clerk principal id because workspaces do not exist yet — see the note above.",
  },

  // ---- what happened -----------------------------------------------------
  op: { kind: "code", max: 64, why: "The operation a module performed. 35 existing uses; a fixed verb per call site." },
  result: { kind: "code", max: 64, why: "Outcome code — 93 existing uses, the single most common field. Never a message." },
  status: { kind: "code", max: 64, why: "Domain status of the subject, from the generation state machine." },
  attemptStatus: { kind: "code", max: 64, why: "Provider attempt state such as submitted or completed." },
  generationStatus: { kind: "code", max: 64, why: "Generation row state such as queued, processing or completed." },
  stage: { kind: "code", max: 64, why: "Internal orchestration stage. An operator label, not user content." },
  action: { kind: "code", max: 64, why: "What the module decided to do, such as delete or retain a queue message." },
  decision: { kind: "code", max: 64, why: "The policy or routing decision reached, from a closed set of outcomes." },
  classification: { kind: "code", max: 64, why: "How a queue message was classified, from a closed set defined by 6R-C." },
  capability: { kind: "code", max: 64, why: "Which adapter capability was used. A name from the provider registry." },
  controlSource: { kind: "code", max: 64, why: "Which runtime control source applied — flag, default, or override." },
  eventType: { kind: "code", max: 64, why: "Domain event type — already constrained to two dotted segments." },
  workflow: { kind: "code", max: 64, why: "Workflow type such as image or video. A catalog label." },
  kind: { kind: "code", max: 64, why: "A discriminator from a closed set, used to read the rest of the record." },
  subject: { kind: "code", max: 32, why: "Rate-limit subject KIND — literally the string 'user' or 'ip'. Never a subject id." },
  from: { kind: "code", max: 64, why: "The state a record moved FROM, from a closed vocabulary." },
  to: { kind: "code", max: 64, why: "The state a record moved TO, from a closed vocabulary." },

  // ---- why it happened ---------------------------------------------------
  reason: { kind: "code", max: 64, why: "Bounded reason code. The same short-code discipline as 12-C and 12-E." },
  reasonCode: { kind: "code", max: 64, why: "Bounded reason code under its explicit spelling. Same discipline as 12-C." },
  /**
   * `name`, not `code`, and this was found by the live proof rather than by
   * reading.
   *
   * Every `OrchestrationError` code in this codebase is SCREAMING_SNAKE —
   * `OUTPUT_DOWNLOAD_FAILED`, `PROVIDER_TIMEOUT`, `AUTH_REQUIRED` — and every
   * `error` field carries `caught.name`, which is PascalCase. The lowercase
   * `CODE_PATTERN` would have dropped all of them, silently blinding error
   * observability across 33 call sites while every test still passed.
   *
   * `name` is no weaker: same length bound, same secret and prose checks, and
   * still no separators, so a URL or a message cannot arrive here either.
   */
  errorCode: { kind: "name", max: 64, why: "Normalized error code such as OUTPUT_DOWNLOAD_FAILED — never a provider message, which can echo a prompt." },
  error: {
    kind: "name",
    max: 64,
    why: "Verified across all 33 existing uses to carry a CODE or an Error class name, never an Error object. The redactor enforces that regardless, since the field name invites the opposite.",
  },
  errorClass: { kind: "name", max: 64, why: "Constructor name only, e.g. ConfigurationError. No message, no stack." },
  severity: { kind: "code", max: 16, why: "Severity from a closed set: 12-C uses info/low/medium/high, 13-D uses info/warning/error/critical. Both are enum labels chosen server-side." },
  resource: {
    kind: "code",
    max: 64,
    why: "Phase 13-D. WHAT an alert is about, from a closed internal vocabulary: a dependency name, a runtime name, a provider id or a security event kind. The alert contract pattern-checks it before it can reach a dedupe key or a log line, so it cannot hold a URL, an address, an email or user text.",
  },
  retryable: { kind: "bool", why: "Whether the caller may retry. A boolean cannot carry content." },

  // ---- where it happened -------------------------------------------------
  subsystem: { kind: "name", max: 64, why: "Which module emitted this. Replaces the '[cinefield:x]' prefix as a field." },
  routeId: { kind: "name", max: 128, why: "Normalized route TEMPLATE, never a resolved URL with a query string." },
  routeClass: { kind: "code", max: 64, why: "Rate-limit route class from the PRE-12 policy table. A policy name." },
  queue: { kind: "name", max: 128, why: "Queue NAME. Authority is IAM, not the name." },
  region: { kind: "name", max: 32, why: "AWS region name. A public infrastructure fact, not a credential." },
  provider: { kind: "name", max: 64, why: "Provider identifier, e.g. fal. Non-secret and essential to provider observability." },
  providerId: { kind: "name", max: 64, why: "Provider identifier under its explicit spelling. Non-secret catalog data." },
  modelId: { kind: "name", max: 128, why: "Model identifier from the public catalog. Essential to provider observability." },
  targetId: { kind: "name", max: 128, why: "Routing control target — a model or provider id, not a user." },
  policyVersion: { kind: "name", max: 64, why: "Which policy produced a 12-E decision. Required for reproducibility." },
  dedupeKey: {
    kind: "name",
    max: 128,
    why: "Phase 14-F. Phase 13-D's incident identity, `source:type:resource` — three closed vocabularies joined by colons, which is why it is a NAME (colons) rather than an id or code (neither permits them). It is the join key for a whole incident timeline in the audit trail, and it is derived entirely from enum labels: no user, tenant, prompt or provider value can appear in it.",
  },

  // ---- numbers -----------------------------------------------------------
  durationMs: { kind: "duration", why: "Latency. A number about our system, not about the output." },
  count: { kind: "count", why: "A generic magnitude. A number cannot carry user content by construction." },
  attempts: { kind: "count", why: "How many times an attempt has been retried. A magnitude, not a payload." },
  claimed: { kind: "count", why: "How many rows a dispatcher pass claimed. A count with no identity in it." },
  rejected: { kind: "count", why: "How many items a dispatcher pass rejected. A count with no identity in it." },
  applied: { kind: "count", why: "How many rows a write affected. A magnitude, not their contents." },
  targets: { kind: "count", why: "How MANY targets — the existing call site already passes targets.length." },
  eventVersion: { kind: "count", why: "Event schema version, an integer from the registry." },
  riskScore: { kind: "count", why: "12-C risk score, 0-100. A number derived from counts, not from content." },
  willDeadLetterAfterReceives: { kind: "count", why: "The queue redrive threshold. Configuration, not traffic." },
  sizeBytes: { kind: "count", why: "Byte size of a payload — the size, never the payload." },
} as const;

/**
 * Field names that must NEVER be allow-listed.
 *
 * Belt and braces: the allow-list already drops them by omission. This list
 * exists so that ADDING one becomes a loud test failure rather than a quiet
 * commit, and so the forbidden set from ¶1722/¶1753 is written down somewhere
 * a reader can check against the roadmap.
 */
export const TELEMETRY_FORBIDDEN_FIELDS: readonly string[] = [
  // ¶1722 / ¶1753, verbatim
  "prompt", "promptText", "rawPrompt", "negativePrompt", "systemPrompt",
  "authorization", "authorizationHeader", "cookie", "cookies", "setCookie",
  "clerkToken", "sessionToken", "jwt", "idToken", "accessToken", "refreshToken",
  "supabaseServiceKey", "serviceRoleKey", "stripeSecret", "stripePayload",
  "presignedUrl", "signedUrl", "mediaUrl", "privateUrl", "downloadUrl", "uploadUrl",
  // secrets by any other name
  "apiKey", "api_key", "secret", "password", "credential", "token",
  "redisUrl", "databaseUrl", "connectionString", "dsn",
  // raw payloads
  "body", "requestBody", "responseBody", "payload", "rawResponse", "providerResponse",
  "request", "response", "headers", "metadata", "env", "environmentDump",
  "stack", "stackTrace", "cause", "message", "errorMessage",
  // media and files
  "bytes", "buffer", "fileContents", "media", "image", "video", "audio",
  // people
  "email", "emailAddress", "name", "displayName", "fullName", "organizationName",
  "ip", "ipAddress", "clientIp", "xForwardedFor", "userAgent",
  "clerkUserId", "userId", "actorId",
  "card", "cardNumber", "paymentMethod",
];

/**
 * Fields that may travel only in a reduced, irreversible form.
 *
 * Not "allowed if you are careful" — the allow-list has no entry for them, so
 * the raw value is dropped. This records the policy for the reduced twin.
 *
 *   client IP      -> `subjectHash`, the sha256 bucket 11-D/12-C already
 *                     computes. Reversible logging of an address is never
 *                     acceptable, and a raw X-Forwarded-For never is either.
 *   filenames      -> extension or MIME class only. A filename is user text
 *                     and routinely contains a person's name.
 *   user agent     -> not carried at all. It is a fingerprinting surface and
 *                     nothing in Cinefield needs it for correlation.
 */
export const TELEMETRY_REDUCED_ONLY: Readonly<Record<string, string>> = {
  clientIp: "subjectHash (sha256 bucket, 20 hex chars) — never the address",
  fileName: "fileExtension or mimeType only",
  userAgent: "not carried",
  email: "not carried in any form",
};

/** The hashed-bucket twin, which IS allowed. */
export const SUBJECT_HASH_RULE: FieldRule = {
  kind: "id",
  max: 64,
  why: "The sha256 bucket 11-D and 12-C already use for anonymous rate limiting. Irreversible in practice for correlation purposes, and it is the only network identity that may be logged.",
};

/**
 * The bounded envelope.
 *
 * There is deliberately no index signature and no `extra` object: a field
 * that is not named cannot be carried, which is what makes the allow-list an
 * allow-list rather than a suggestion.
 */
export interface TelemetryEnvelope {
  timestamp: string;
  level: TelemetryLevel;
  /** A short, stable event name from the emitting module. */
  event: string;
  subsystem: string;
  /** Allow-listed fields only, already validated and bounded. */
  fields: Readonly<Record<string, string | number | boolean>>;
  /**
   * How many fields the guard removed.
   *
   * A count, never the names — a dropped field name can itself be a hint
   * ("stripeCustomerSecret" tells a reader plenty). It exists so that silent
   * loss is visible: a call site quietly logging nothing useful shows up as a
   * high drop count instead of looking healthy.
   */
  droppedFieldCount: number;
}

export const MAX_EVENT_NAME = 64;
export const MAX_SUBSYSTEM = 64;
/** A hard ceiling on the number of fields one record may carry. */
export const MAX_FIELDS = 24;

export function isForbiddenFieldName(name: string): boolean {
  const n = name.toLowerCase();
  return TELEMETRY_FORBIDDEN_FIELDS.some((f) => f.toLowerCase() === n);
}

export function fieldRule(name: string): FieldRule | undefined {
  if (name === "subjectHash") return SUBJECT_HASH_RULE;
  return Object.prototype.hasOwnProperty.call(TELEMETRY_ALLOWLIST, name)
    ? TELEMETRY_ALLOWLIST[name]
    : undefined;
}
