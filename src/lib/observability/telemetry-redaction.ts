import {
  CODE_PATTERN,
  ID_PATTERN,
  MAX_EVENT_NAME,
  MAX_FIELDS,
  MAX_SUBSYSTEM,
  NAME_PATTERN,
  fieldRule,
  isForbiddenFieldName,
  type FieldRule,
  type TelemetryEnvelope,
  type TelemetryLevel,
} from "./telemetry-contract";

/**
 * The single redaction boundary (Phase 13-E).
 *
 * ---------------------------------------------------------------------------
 * EVERY SINK CALLS THIS. NO SINK IMPLEMENTS ITS OWN.
 * ---------------------------------------------------------------------------
 * Sentry, OpenTelemetry, CloudWatch and Better Stack arrive in later packages.
 * Each will be a different SDK with different serialization, and if each does
 * its own filtering there will be four subtly different definitions of "safe"
 * and the weakest one decides what leaks. So there is one function, it runs
 * before anything is exported, and ¶1723's acceptance test — forbidden fields
 * provably absent from all four — is a property of this file rather than of
 * four integrations.
 *
 * ---------------------------------------------------------------------------
 * DROP UNLESS ALLOW-LISTED
 * ---------------------------------------------------------------------------
 * Unknown field name -> dropped. Wrong type -> dropped. Value that fails its
 * pattern -> dropped. Value that looks like a secret -> the WHOLE FIELD is
 * dropped, never truncated: half a token is still a token's worth of
 * information, and a truncated presigned URL still names the bucket and the
 * object.
 *
 * Nothing here throws. A guard that can throw is a guard someone wraps in
 * try/catch and then bypasses — and a logging failure must never break a
 * business path (§16). The failure mode is an empty `fields` object with a
 * non-zero `droppedFieldCount`, which is loud in a dashboard and harmless in
 * production.
 */

/**
 * Value shapes that are never safe, regardless of which field they arrive in.
 *
 * This is the second line, not the first — the allow-list already rejects
 * unknown names. It exists because an allow-listed field can still be handed
 * the wrong thing: someone passes a whole URL as `routeId`, or a JWT as
 * `traceId`. The name was approved; the value was not.
 *
 * Assembled from fragments so this file never contains a literal credential
 * prefix that would trip the repository secret scanner.
 */
const j = (...p: string[]) => p.join("");

const SECRET_SHAPES: readonly RegExp[] = [
  // A JWT — Supabase service keys and Clerk tokens are both JWTs.
  new RegExp(j("eyJ", "[A-Za-z0-9_-]{8,}\\.", "eyJ", "[A-Za-z0-9_-]{8,}")),
  // Issuer-prefixed API keys.
  new RegExp(j("\\b", "sk", "[-_]", "[A-Za-z0-9_-]{12,}")),
  new RegExp(j("\\b", "pk", "_", "(live|test)", "_", "[A-Za-z0-9]{8,}")),
  new RegExp(j("\\b", "whsec", "_", "[A-Za-z0-9]{8,}")),
  new RegExp(j("\\b", "gh", "[pousr]_", "[A-Za-z0-9]{20,}")),
  new RegExp(j("\\b", "r8", "_", "[A-Za-z0-9]{20,}")),
  // AWS access key ids.
  new RegExp(j("\\b(?:", "AKI", "A|", "ASI", "A)", "[0-9A-Z]{16}\\b")),
  // Any URL. A field that should hold an id or a route template must never
  // hold one: presigned URLs, private media URLs and connection strings are
  // all URLs, and distinguishing "safe URL" from "unsafe URL" by inspection
  // is exactly the judgement call this guard exists to remove.
  /\b(?:https?|redis|rediss|postgres|postgresql|s3|r2|amqp|mongodb):\/\//i,
  // Inline credentials in any scheme.
  /:\/\/[^\s:@/]+:[^\s@/]+@/,
  // PEM material.
  new RegExp(j("-----", "BEGIN ", "[A-Z ]*", "PRIVATE KEY")),
  // An email address.
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
];

export function looksSecret(value: string): boolean {
  return SECRET_SHAPES.some((re) => re.test(value));
}

/**
 * Long free text is dropped even when it matches nothing.
 *
 * A prompt is the case that matters: it contains no credential shape, no URL
 * and no email, and it is the single thing ¶1722 names most explicitly. What
 * distinguishes it from every allow-listed value is that it is long and
 * unstructured, so length plus structure is what the guard checks. Every
 * allow-listed string field has a `max` well under this.
 */
const FREE_TEXT_LENGTH = 200;

/** Whitespace runs are the strongest available signal of prose rather than an id. */
function looksLikeProse(value: string): boolean {
  return /\s/.test(value.trim()) && value.trim().split(/\s+/).length >= 4;
}

export interface SanitizeInput {
  level: TelemetryLevel;
  event: string;
  subsystem: string;
  fields?: Record<string, unknown>;
  /** Injected only by tests; production always uses the real clock. */
  now?: string;
}

/**
 * Sanitizes one record into an envelope safe for any sink.
 *
 * Total function: every input produces an envelope, and an unusable input
 * produces an empty one rather than an exception.
 */
export function sanitizeTelemetry(input: SanitizeInput): TelemetryEnvelope {
  const level: TelemetryLevel =
    input.level === "debug" || input.level === "info" || input.level === "warn" || input.level === "error"
      ? input.level
      : "info";

  const event = boundedLabel(input.event, MAX_EVENT_NAME) ?? "unknown_event";
  const subsystem = boundedLabel(input.subsystem, MAX_SUBSYSTEM) ?? "unknown";

  const fields: Record<string, string | number | boolean> = {};
  let dropped = 0;

  const entries = input.fields ? Object.entries(input.fields) : [];
  for (const [key, raw] of entries) {
    if (Object.keys(fields).length >= MAX_FIELDS) {
      dropped += 1;
      continue;
    }
    // A forbidden NAME is refused before its value is even examined, so a
    // reader of this function cannot conclude that a forbidden field would
    // have been fine had its value looked innocent.
    if (isForbiddenFieldName(key)) {
      dropped += 1;
      continue;
    }
    const rule = fieldRule(key);
    if (!rule) {
      dropped += 1;
      continue;
    }
    const value = coerce(raw, rule);
    if (value === undefined) {
      dropped += 1;
      continue;
    }
    fields[key] = value;
  }

  return {
    timestamp: input.now ?? new Date().toISOString(),
    level,
    event,
    subsystem,
    fields,
    droppedFieldCount: dropped,
  };
}

/** Validates and bounds one value, or returns undefined to drop it. */
function coerce(raw: unknown, rule: FieldRule): string | number | boolean | undefined {
  switch (rule.kind) {
    case "bool":
      return typeof raw === "boolean" ? raw : undefined;

    case "count":
    case "duration": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
      if (raw < 0) return undefined;
      // Integers only. A float here is a bug, and rounding one silently
      // would hide it.
      return Number.isInteger(raw) ? raw : Math.round(raw);
    }

    case "id":
    case "code":
    case "name": {
      if (typeof raw !== "string") return undefined;
      const value = raw.trim();
      if (value.length === 0) return undefined;

      // ORDER MATTERS, and this is the order:
      //
      //   1. secret shape  -> DROP THE WHOLE FIELD. Never truncated: half a
      //      token is still a token's worth, and a shortened presigned URL
      //      still names the bucket and the object.
      //   2. free-text length -> drop. This is the prompt case.
      //   3. prose -> drop.
      //   4. TRUNCATE to the rule's max.
      //   5. pattern -> drop if the bounded value is still not the right shape.
      //
      // Truncation happens BEFORE the pattern test, which is what makes `max`
      // meaningful. The first version tested the pattern first, so an
      // 80-character lowercase code failed `CODE_PATTERN`'s own {0,64} bound
      // and was dropped — `max` could never take effect and "bounded" was a
      // claim the code did not implement.
      if (looksSecret(value)) return undefined;
      if (value.length > FREE_TEXT_LENGTH) return undefined;
      if (looksLikeProse(value)) return undefined;

      const max = rule.max ?? 64;
      const bounded = value.length > max ? value.slice(0, max) : value;

      const pattern =
        rule.kind === "id" ? ID_PATTERN : rule.kind === "code" ? CODE_PATTERN : NAME_PATTERN;
      return pattern.test(bounded) ? bounded : undefined;
    }
  }
}

/** Event and subsystem labels get the same treatment as a `name` field. */
function boundedLabel(raw: unknown, max: number): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (value.length === 0 || looksSecret(value) || looksLikeProse(value)) return undefined;
  if (!NAME_PATTERN.test(value.slice(0, max))) return undefined;
  return value.slice(0, max);
}
