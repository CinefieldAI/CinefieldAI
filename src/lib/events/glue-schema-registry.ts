import "server-only";
import { getSchemaRegistryConfig } from "./schema-registry-config";
import { EVENT_SCHEMAS } from "./event-schemas";

/**
 * Cinefield AWS Glue Schema Registry adapter — DISABLED FOUNDATION
 * (Phase 6R.15).
 *
 * WHAT THIS IS NOT: it is not registered, not provisioned, and has never
 * talked to AWS. Glue is external setup that has not happened, so the honest
 * behaviour of every function here is to report WHY it cannot act rather
 * than to pretend a registry exists.
 *
 * NO IMPORT-TIME AWS, AND NO NEW DEPENDENCY
 * The Glue client is `require`d lazily inside the one function that would
 * need it, inside a try/catch. `@aws-sdk/client-glue` is deliberately NOT
 * added to package.json: nothing calls AWS yet, so installing an SDK now
 * would add weight and a version to maintain for a code path that cannot
 * run. A missing package reports `unavailable: sdk_not_installed`, which is
 * exactly what it is. Installing it is a one-line change on the day the
 * registry is actually provisioned.
 *
 * WHY IT EXISTS AT ALL
 * So the boundary is decided and reviewable now: which identity a schema has
 * (`schemaName`), what compatibility mode Cinefield intends, and the fact
 * that Glue is distribution rather than a validation bypass. Wiring that
 * later, under deadline, is how a registry ends up with a mode nobody chose.
 */

/**
 * The compatibility mode Cinefield's policy corresponds to in Glue's own
 * vocabulary. Documented here so provisioning cannot silently pick another:
 * BACKWARD means a consumer using the previous schema can read data written
 * with the new one — the exact rule `classifyCompatibility` enforces
 * locally.
 */
export const INTENDED_GLUE_COMPATIBILITY = "BACKWARD" as const;

/** Glue's data format for JSON envelopes. Avro/Protobuf are NOT used — Cinefield's events are JSON end to end. */
export const INTENDED_GLUE_DATA_FORMAT = "JSON" as const;

export type RegistryStatus =
  /** The operator has not turned it on. Not an error. */
  | { status: "disabled" }
  /** Enabled, but AWS_REGION / GLUE_REGISTRY_NAME are missing. */
  | { status: "unconfigured" }
  /** Configured, but the call could not be made. Carries a code, never a raw AWS error. */
  | { status: "unavailable"; reason: string }
  | { status: "ready"; registryName: string; region: string };

/**
 * Reports whether a live Glue call could even be attempted. Performs no
 * network I/O of its own — it inspects configuration and the presence of the
 * SDK, nothing more.
 */
export function describeGlueRegistry(): RegistryStatus {
  const config = getSchemaRegistryConfig();
  if (config === null) {
    return process.env.EVENT_SCHEMA_REGISTRY_ENABLED === "true"
      ? { status: "unconfigured" }
      : { status: "disabled" };
  }
  return { status: "ready", registryName: config.registryName, region: config.region };
}

/**
 * What WOULD be pushed to Glue: one registry entry per locally registered
 * schema, named by its stable `schemaName`. Pure — computed from the local
 * registry, callable in a test, and useful as the review artifact for the
 * day provisioning happens.
 */
export function plannedGlueSchemas(): {
  schemaName: string;
  dataFormat: typeof INTENDED_GLUE_DATA_FORMAT;
  compatibility: typeof INTENDED_GLUE_COMPATIBILITY;
  eventType: string;
  eventVersion: number;
}[] {
  return [...EVENT_SCHEMAS.values()].map((entry) => ({
    schemaName: entry.schemaName,
    dataFormat: INTENDED_GLUE_DATA_FORMAT,
    compatibility: INTENDED_GLUE_COMPATIBILITY,
    eventType: entry.eventType,
    eventVersion: entry.eventVersion,
  }));
}

/**
 * The only function that would ever reach AWS. It refuses before doing so
 * unless explicitly enabled AND configured, and it never throws a raw AWS
 * error at a caller.
 *
 * Today it always resolves to a non-"ready" status in this repository,
 * because Glue is not provisioned and the SDK is not installed. That is the
 * truthful answer, not a stub pretending success.
 */
export async function syncSchemasToGlue(): Promise<RegistryStatus> {
  const described = describeGlueRegistry();
  if (described.status !== "ready") return described;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("@aws-sdk/client-glue");
  } catch {
    return { status: "unavailable", reason: "sdk_not_installed" };
  }

  // Reaching here means someone enabled the flag, supplied a region and a
  // registry name, and installed the SDK — i.e. provisioning happened. The
  // actual CreateSchema/RegisterSchemaVersion calls belong to that change,
  // reviewed with the IAM policy that permits them, not guessed at here.
  return { status: "unavailable", reason: "sync_not_implemented" };
}
