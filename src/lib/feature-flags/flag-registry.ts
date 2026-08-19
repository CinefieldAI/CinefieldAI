import type { FlagDefinition, FlagValue } from "./flag-contract";
import { FLAG_KEY_PATTERN } from "./flag-contract";

/**
 * Phase 21-B — the registered critical flag set.
 *
 * A closed, reviewed list, the same discipline `tier0-action-catalogue.ts`
 * and `event-schemas.ts` already apply to their own registries: a flag key
 * that is not here cannot be evaluated or set, so a typo is a refusal, never
 * an unguarded write of an ad-hoc key.
 *
 * `provider.*.enabled` / `model.*.enabled` / `route.*.weight`, named in the
 * roadmap's 21-B text, are DELIBERATELY absent — Phase 7 already owns that
 * exact mutation (`model_providers.enabled`, `model_routes.enabled`,
 * `POST /api/admin/router/disable`). Registering a second, parallel flag
 * for the same target would be the "two ways to supply the wrong one"
 * failure mode this codebase has already named and rejected once (see
 * `outbox-repository.ts`'s header on `emit_outbox_event`'s tenant
 * resolution). Reading provider/model/route state through this registry
 * remains a real, available, UNTAKEN option — see `docs/security-gates.md`'s
 * Phase 21 section for why this batch does not wire it.
 */
export const FLAG_REGISTRY: Readonly<Record<string, FlagDefinition>> = {
  maintenance_mode: {
    key: "maintenance_mode",
    valueType: "boolean",
    riskTier: "HIGH_RISK_TIER0",
    defaultValue: false,
    description: "Global site maintenance mode. Takes the whole product down for every tenant — the highest-blast-radius kill switch this registry holds.",
  },
  "feature.video.enabled": {
    key: "feature.video.enabled",
    valueType: "boolean",
    riskTier: "OPERATOR",
    defaultValue: true,
    description: "Whether video generation is offered. A fast, reversible kill switch for one product surface, not the whole site.",
  },
  "uploads.enabled": {
    key: "uploads.enabled",
    valueType: "boolean",
    riskTier: "OPERATOR",
    defaultValue: true,
    description: "Whether media upload is accepted. A fast, reversible kill switch for abuse/incident response.",
  },
  release_stage: {
    key: "release_stage",
    valueType: "enum",
    allowedValues: ["alpha", "beta", "public"],
    riskTier: "HIGH_RISK_TIER0",
    defaultValue: "alpha",
    description:
      "The single server-side release-maturity value docs/security-gates.md's 12-gate table names. Moving it to \"public\" is gated by an EXTRA policy action (release_stage.activate_public) beyond the generic tier0 gate every other flag here uses — see feature-flag-admin-service.ts.",
  },
} as const;

export type RegisteredFlagKey = keyof typeof FLAG_REGISTRY;

export function flagDefinition(key: string): FlagDefinition | null {
  return Object.prototype.hasOwnProperty.call(FLAG_REGISTRY, key)
    ? FLAG_REGISTRY[key as RegisteredFlagKey]
    : null;
}

export function registeredFlagKeys(): string[] {
  return Object.keys(FLAG_REGISTRY).sort();
}

/** Structural validation only — is this a value this flag's definition could ever hold. */
export function isValidFlagValue(definition: FlagDefinition, value: unknown): value is FlagValue {
  if (definition.valueType === "boolean") return typeof value === "boolean";
  if (definition.valueType === "enum") {
    return typeof value === "string" && (definition.allowedValues ?? []).includes(value);
  }
  // "string"
  return typeof value === "string" && value.length > 0 && value.length <= 500;
}

// Fails the module, the test run, and the build — never a request — the same
// discipline policy-engine.ts's validateRegistry() applies to its own table.
for (const [key, def] of Object.entries(FLAG_REGISTRY)) {
  if (key !== def.key) throw new Error(`flag-registry: key "${key}" does not match its own definition.key`);
  if (!FLAG_KEY_PATTERN.test(key)) throw new Error(`flag-registry: "${key}" does not match FLAG_KEY_PATTERN`);
  if (!isValidFlagValue(def, def.defaultValue)) {
    throw new Error(`flag-registry: "${key}"'s own defaultValue does not satisfy its valueType`);
  }
}
