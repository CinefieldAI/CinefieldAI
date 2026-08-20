/**
 * Phase 25-D Admin Secrets Lifecycle dashboard contract — read-only.
 *
 * Mirrors `privacy-admin-contract.ts`'s own shape: every row is exactly
 * what `secret-registry.ts` (Phase 12-D, unchanged) and `secret_rotations`
 * (Phase 25-C) already say — no second opinion computed here, and NEVER a
 * secret value. Satisfies 25's own "Admin visibility" requirement: secret
 * identifier, owner, provider, environment, rotation state, lastRotatedAt,
 * expiresAt, verification status, reason code — nothing else.
 */

import type { SecretClass, SecretGroup, SecretRequirement, RotationClass } from "@/lib/config/secret-registry";
import type { RotationState } from "@/lib/secrets/rotation-contract";

export interface SecretLifecycleRow {
  readonly name: string;
  readonly class: SecretClass;
  readonly requirement: SecretRequirement;
  readonly group: SecretGroup;
  readonly rotationClass: RotationClass;
  readonly note: string;
  /** `NOT_CONFIGURED` when no secret_rotations row exists yet for this name/environment. */
  readonly state: RotationState;
  readonly lastRotatedAt: string | null;
  readonly expiresAt: string | null;
  readonly verifiedAt: string | null;
  readonly reasonCode: string | null;
}

export interface SecretsAdminView {
  readonly environment: string;
  readonly secrets: readonly SecretLifecycleRow[];
  readonly secretManagerBackend: "environment" | "aws-secrets-manager";
}

export type SecretsAdminResult =
  | { readonly outcome: "SOURCE_UNAVAILABLE"; readonly reasonCode: string }
  | { readonly outcome: "FOUND"; readonly view: SecretsAdminView };
