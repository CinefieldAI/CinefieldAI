import "server-only";
import { OrchestrationError } from "@/lib/orchestration/errors";

/**
 * AWS S3 disaster-recovery configuration (Phase 9-D).
 *
 * S3 IS BACKUP. NOT STORAGE. R2 is the canonical hot/live media truth and the
 * only thing a user is ever served from. Nothing in this module or its
 * neighbours may make S3 a delivery path, an upload target, or a fallback
 * read when R2 is unavailable — the roadmap red note is explicit that S3 must
 * not appear in the user delivery path, and a "helpful" fallback is exactly
 * how a DR copy quietly becomes a second production store nobody is
 * maintaining.
 *
 * NO ACCESS KEYS IN THIS REPOSITORY'S ENVIRONMENT. `.env.example` states the
 * rule outright: "NO AWS ACCESS KEYS BELONG HERE OR ANYWHERE IN THIS FILE."
 * Credentials come from the AWS SDK's default provider chain — the ECS task
 * role in production, a named profile locally. What lives in `.env.local` is
 * the PROFILE NAME, which identifies rather than authenticates.
 *
 * That is also why this reads a profile at all: the default chain would pick
 * whichever identity happens to be first, and the DR writer must be the
 * least-privileged one that can write this bucket and nothing else.
 */

export interface DrConfig {
  bucket: string;
  region: string;
  /** Local development only. Absent in production, where the task role applies. */
  profile?: string;
}

export type DrConfigProblem = "missing_bucket" | "bucket_invalid" | "region_invalid";

function read(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

const BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const REGION_PATTERN = /^[a-z]{2}-[a-z]+-\d$/;

/** The locked production region, matching sqs-config's own default. */
export const DEFAULT_DR_REGION = "eu-central-1";

export function validateDrEnv(env: {
  bucket?: string;
  region?: string;
}): DrConfigProblem | null {
  if (!env.bucket) return "missing_bucket";
  if (!BUCKET_PATTERN.test(env.bucket)) return "bucket_invalid";
  if (env.region && !REGION_PATTERN.test(env.region)) return "region_invalid";
  return null;
}

/**
 * True when a DR target is configured. DR is genuinely optional: a deployment
 * without it still stores, serves and completes media correctly — it simply
 * has no second copy. Unlike R2, absence here is a valid state, so callers get
 * a boolean rather than an exception.
 */
export function isDrConfigured(): boolean {
  return read("CINEFIELD_DR_S3_BUCKET") !== undefined;
}

/**
 * Resolves DR configuration, or throws a sanitized configuration error.
 *
 * Only call after `isDrConfigured()`. Throwing here means the operator asked
 * for DR and got the details wrong, which is worth failing loudly rather than
 * silently skipping every backup.
 */
export function getDrConfig(): DrConfig {
  const env = {
    bucket: read("CINEFIELD_DR_S3_BUCKET"),
    region: read("CINEFIELD_DR_AWS_REGION") ?? read("AWS_REGION") ?? DEFAULT_DR_REGION,
  };

  const problem = validateDrEnv(env);
  if (problem) {
    throw new OrchestrationError("DR_CONFIGURATION_INVALID", {
      // One of three fixed strings. No bucket name, no account id, no ARN.
      context: { reason: problem },
    });
  }

  return {
    bucket: env.bucket as string,
    region: env.region as string,
    profile: read("CINEFIELD_DR_AWS_PROFILE"),
  };
}
