import "server-only";
import { OrchestrationError } from "@/lib/orchestration/errors";

/**
 * Cloudflare R2 configuration (Phase 9-A).
 *
 * R2 is the hot/live production media store from this phase on. S3 is
 * DR/backup only and belongs to 9-D — it must never appear in a user delivery
 * path. Supabase Storage remains as an explicitly time-boxed compatibility
 * layer; see docs/architecture/CINEFIELD_ARCHITECTURE_CONTRACT.md.
 *
 * ITS OWN CREDENTIALS, DELIBERATELY. R2 does not reuse AWS_ACCESS_KEY_ID:
 * those belong to SQS, and collapsing two different clouds onto one variable
 * name means rotating one breaks the other. Same two-key discipline as every
 * other Cinefield boundary — an explicit name AND a real value.
 *
 * Fails fast the way `getRedisConfig` learned to (M4): configured-but-broken
 * is a typed configuration error carrying only the SHAPE of the mistake, never
 * the endpoint, the key id, or the secret.
 */

export interface R2Config {
  accessKeyId: string;
  secretAccessKey: string;
  /** S3 API endpoint, e.g. https://<account>.r2.cloudflarestorage.com */
  endpoint: string;
  bucket: string;
}

export type R2ConfigProblem =
  | "missing_access_key_id"
  | "missing_secret_access_key"
  | "missing_endpoint"
  | "missing_bucket"
  | "endpoint_invalid"
  | "endpoint_scheme"
  | "endpoint_has_path"
  | "bucket_invalid";

function read(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Bucket naming rules, enforced so a misconfiguration cannot smuggle a path
 * segment into the bucket position and address a different bucket.
 */
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

export function validateR2Env(env: {
  accessKeyId?: string;
  secretAccessKey?: string;
  endpoint?: string;
  bucket?: string;
}): R2ConfigProblem | null {
  if (!env.accessKeyId) return "missing_access_key_id";
  if (!env.secretAccessKey) return "missing_secret_access_key";
  if (!env.endpoint) return "missing_endpoint";
  if (!env.bucket) return "missing_bucket";

  let url: URL;
  try {
    url = new URL(env.endpoint);
  } catch {
    return "endpoint_invalid";
  }
  if (url.protocol !== "https:") return "endpoint_scheme";
  // Cloudflare shows the endpoint with the bucket appended in some views.
  // Accepting that would give the SDK two bucket segments and address
  // `/bucket/bucket/key`, which fails in a confusing way much later.
  if (url.pathname !== "/" && url.pathname !== "") return "endpoint_has_path";

  if (!BUCKET_PATTERN.test(env.bucket)) return "bucket_invalid";

  return null;
}

/** True when all four variables are present. Does not imply they are valid. */
export function isR2Configured(): boolean {
  return (
    read("CLOUDFLARE_R2_ACCESS_KEY_ID") !== undefined &&
    read("CLOUDFLARE_R2_SECRET_ACCESS_KEY") !== undefined &&
    read("CLOUDFLARE_R2_ENDPOINT") !== undefined &&
    read("CLOUDFLARE_R2_BUCKET") !== undefined
  );
}

/**
 * Resolves R2 configuration or throws a sanitized configuration error.
 *
 * Throws rather than returning null: unlike Redis, there is no "R2 is
 * legitimately off" deployment shape once Phase 9-A owns media. A caller that
 * reaches here needs storage.
 */
export function getR2Config(): R2Config {
  const env = {
    accessKeyId: read("CLOUDFLARE_R2_ACCESS_KEY_ID"),
    secretAccessKey: read("CLOUDFLARE_R2_SECRET_ACCESS_KEY"),
    endpoint: read("CLOUDFLARE_R2_ENDPOINT"),
    bucket: read("CLOUDFLARE_R2_BUCKET"),
  };

  const problem = validateR2Env(env);
  if (problem) {
    throw new OrchestrationError("R2_CONFIGURATION_INVALID", {
      // One of eight fixed strings. No endpoint, no key id, no secret.
      context: { reason: problem },
    });
  }

  return {
    accessKeyId: env.accessKeyId as string,
    secretAccessKey: env.secretAccessKey as string,
    endpoint: env.endpoint as string,
    bucket: env.bucket as string,
  };
}
