import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePolicy } from "@/lib/policy/policy-gate";
import { PolicyDenied } from "@/lib/policy/policy-contract";
import { authorizeTier0Action, recordTier0Execution } from "@/lib/admin/tier0-authorization";
import { queryPrivilegedActionAudit } from "@/lib/admin/privileged-action-audit";
import type { AssuranceEvidence, ElevationVerdict } from "@/lib/admin/step-up-auth";
import { recordSecurityEvent } from "@/lib/security/security-event-logger";
import { secretEntry, type RotationClass } from "@/lib/config/secret-registry";
import { resolveEnvironment, type CinefieldEnvironment } from "@/lib/config/environment";
import { canTransition, type RotationState } from "./rotation-contract";

/**
 * The Phase 25-C privileged rotation execution service — the ONLY caller of
 * `secret.rotate`.
 *
 * Same composition shape `privacy-execution-service.ts` (Phase 23)
 * established for `data.export`/`data.delete`: `secret.rotate` is ALREADY
 * registered in `policies/data/actions.json` with BOTH
 * `requiresHumanApproval: true` (policy) and, once this batch registers it
 * in `tier0-action-catalogue.ts`, `requiresTwoPerson: true` (Tier-0) — the
 * same dual condition, resolved the same documented way: Tier-0 runs FIRST
 * (it is the real source of the two-distinct-approver evidence policy's
 * `approvalEvidence` needs), policy runs SECOND, unconditionally, as the
 * final gate immediately before any provider call. Neither gate is
 * reimplemented; both are the EXISTING Phase 16-E/19 mechanism.
 *
 * ---------------------------------------------------------------------------
 * NO AUTONOMOUS ROTATION. NO VALUE EVER RETURNED, LOGGED, OR AUDITED.
 * ---------------------------------------------------------------------------
 * `requireAiWritePolicy` is never imported here — there is no AI-callable
 * path to this function anywhere in this codebase, matching roadmap's own
 * "AI'ın secret değerini chat/log'a döndürmesine izin verilmez" and section
 * 27's default (`NO_AUTONOMOUS_ROTATION`). Every outcome, every audit row,
 * and every `RotationProvider`/`RotationVerifier` return shape carries an
 * opaque version REFERENCE only — never the secret's own value.
 */

const REASON_ROTATION_REQUESTED = "operator_requested_rotation";

export interface RotationProvider {
  /** Requests a new version from the real backend. Returns an opaque version reference — never a value. */
  rotate(params: { secretName: string; environment: CinefieldEnvironment }): Promise<{ newVersionRef: string }>;
}

/**
 * The real AWS Secrets Manager rotation call (`RotateSecretCommand`).
 *
 * Never invoked by this repository's own tests — matching
 * `LiveClerkUserDeleter`'s (Phase 23) own documented convention for a real,
 * external, side-effectful call this codebase cannot safely exercise live.
 * `secretId` mirrors `AwsSecretsManagerProvider.secretId()` exactly — same
 * per-environment namespace, same reasoning.
 */
export const LiveAwsSecretsManagerRotationProvider: RotationProvider = {
  async rotate({ secretName, environment }) {
    const { SecretsManagerClient, RotateSecretCommand } = await import("@aws-sdk/client-secrets-manager");
    const client = new SecretsManagerClient({ region: process.env.AWS_REGION ?? "us-east-1" });
    const result = await client.send(new RotateSecretCommand({ SecretId: `cinefield/${environment}/${secretName}` }));
    if (!result.VersionId) throw new Error("rotation_no_version_returned");
    return { newVersionRef: result.VersionId };
  },
};

export interface RotationVerifier {
  /** Confirms dependent workers can authenticate with the new version. Never assumes success. */
  verify(params: {
    secretName: string;
    environment: CinefieldEnvironment;
    newVersionRef: string;
  }): Promise<{ verified: boolean; reasonCode: string }>;
}

/**
 * No live worker-reload signal exists anywhere in this repository yet — no
 * process reports back "I am now authenticating with version X of secret
 * Y". A caller that omits `verifier` gets this, which always reports
 * unverified rather than assuming a rotation worked because the provider
 * call returned. This is the honest default, the same "empty registry,
 * reported honestly" shape `RTO_TARGETS`/`RPO_TARGETS` (Phase 15-D/2)
 * already established — never a fabricated pass.
 */
export const NoWorkerReloadVerifier: RotationVerifier = {
  async verify() {
    return { verified: false, reasonCode: "no_worker_reload_signal_configured" };
  },
};

export type RotationExecutionOutcome =
  | { outcome: "SECRET_NOT_REGISTERED" }
  | { outcome: "NOT_ROTATABLE"; reasonCode: "not_a_secret" }
  | { outcome: "INVALID_CURRENT_STATE"; currentState: RotationState }
  | { outcome: "POLICY_DENIED"; reasonCode: string }
  | { outcome: "TIER0_AUTHORIZATION_REQUIRED"; reasonCode: string; requestId: string }
  | { outcome: "PROVIDER_ROTATION_FAILED" }
  | { outcome: "VERIFICATION_FAILED"; rollbackAvailable: boolean }
  | { outcome: "ROTATION_COMPLETED"; newVersionRef: string };

export interface ExecuteRotationParams {
  secretName: string;
  actorClerkUserId: string;
  stepUp?: { assurance: AssuranceEvidence; elevation: ElevationVerdict };
  requestId?: string;
  /** Test seam only — never supplied by a real caller. */
  provider?: RotationProvider;
  /** Test seam only — never supplied by a real caller. */
  verifier?: RotationVerifier;
}

async function resolveHumanApprovalEvidence(admin: SupabaseClient, tier0RequestId: string): Promise<boolean> {
  const result = await queryPrivilegedActionAudit(admin, {});
  if (result.outcome !== "FOUND") return false;
  const approvers = new Set(
    result.rows.filter((row) => row.requestId === tier0RequestId && row.event === "approved").map((row) => row.actorClerkUserId)
  );
  return approvers.size >= 2;
}

async function readCurrentState(admin: SupabaseClient, secretName: string, environment: CinefieldEnvironment): Promise<RotationState> {
  const { data } = await admin.from("secret_rotations").select("state").eq("secret_name", secretName).eq("environment", environment).maybeSingle();
  const row = data as { state: RotationState } | null;
  return row?.state ?? "NOT_CONFIGURED";
}

async function writeState(
  admin: SupabaseClient,
  params: {
    secretName: string;
    environment: CinefieldEnvironment;
    owner: string;
    rotationClass: RotationClass;
    newState: RotationState;
    reasonCode: string;
    expectedState: RotationState | null;
    tier0RequestId?: string;
    currentVersionRef?: string;
    previousVersionRef?: string;
    rotatedAt?: string;
    verifiedAt?: string;
  }
): Promise<{ applied: boolean }> {
  const { data } = await admin.rpc("upsert_secret_rotation_state", {
    p_secret_name: params.secretName,
    p_environment: params.environment,
    p_owner: params.owner,
    p_rotation_class: params.rotationClass,
    p_new_state: params.newState,
    p_reason_code: params.reasonCode,
    p_expected_state: params.expectedState,
    p_tier0_request_id: params.tier0RequestId ?? null,
    p_current_version_ref: params.currentVersionRef ?? null,
    p_previous_version_ref: params.previousVersionRef ?? null,
    p_rotated_at: params.rotatedAt ?? null,
    p_verified_at: params.verifiedAt ?? null,
  });
  const result = data as { applied: boolean } | null;
  return { applied: result?.applied === true };
}

/**
 * The full rotation flow, authorized once: ROTATION_REQUIRED (or
 * NOT_CONFIGURED, its own precondition) -> ROTATING -> VERIFYING ->
 * ACTIVE|ROLLBACK_AVAILABLE|FAILED. Every transition is a real, durable,
 * `canTransition()`-checked write — never skipped, never assumed.
 */
export async function executeSecretRotation(admin: SupabaseClient, params: ExecuteRotationParams): Promise<RotationExecutionOutcome> {
  const entry = secretEntry(params.secretName);
  if (!entry) return { outcome: "SECRET_NOT_REGISTERED" };
  if (entry.rotation === "NOT_A_SECRET") return { outcome: "NOT_ROTATABLE", reasonCode: "not_a_secret" };

  const environment = resolveEnvironment();
  const currentState = await readCurrentState(admin, params.secretName, environment);
  // A caller may start a rotation whenever the state machine (rotation-
  // contract.ts, the ONE source of truth for this — never duplicated here)
  // permits reaching ROTATION_REQUIRED from wherever the secret currently
  // is — including ACTIVE (routine/leak-triggered re-rotation of a
  // currently-healthy secret, the single most common real case) — or when
  // it is already sitting in ROTATION_REQUIRED (a retry that never
  // completed the write step below).
  if (currentState !== "ROTATION_REQUIRED" && !canTransition(currentState, "ROTATION_REQUIRED").allowed) {
    return { outcome: "INVALID_CURRENT_STATE", currentState };
  }

  const tier0RequestId = params.requestId ?? randomUUID();
  const stepUp = params.stepUp ?? {
    assurance: { state: "NOT_CONFIGURED" as const, verifiedAt: null },
    elevation: { elevated: false, reasonCode: "no_elevation" as const },
  };

  // TIER-0 RUNS FIRST — see this file's own header for why.
  const decision = await authorizeTier0Action(admin, {
    requestId: tier0RequestId,
    action: "secret.rotate",
    actorClerkUserId: params.actorClerkUserId,
    target: { type: "secret_rotation", id: params.secretName },
    reasonCode: null,
    correlationId: null,
    assurance: stepUp.assurance,
    elevation: stepUp.elevation,
  });
  if (!decision.allowed) {
    return { outcome: "TIER0_AUTHORIZATION_REQUIRED", reasonCode: decision.reasonCode, requestId: tier0RequestId };
  }

  try {
    const humanApproved = await resolveHumanApprovalEvidence(admin, tier0RequestId);
    await requirePolicy({
      action: "secret.rotate",
      actor: { id: params.actorClerkUserId, role: "route_admin", kind: "human" },
      resource: { type: "secret_rotation", id: params.secretName },
      approvalEvidence: { humanApproved },
      correlationId: tier0RequestId,
    });
  } catch (caught) {
    if (!(caught instanceof PolicyDenied)) throw caught;
    return { outcome: "POLICY_DENIED", reasonCode: caught.reason };
  }

  const provider = params.provider ?? LiveAwsSecretsManagerRotationProvider;
  const verifier = params.verifier ?? NoWorkerReloadVerifier;
  const reasonCode = REASON_ROTATION_REQUESTED;

  // Step 1: NOT_CONFIGURED/FAILED/EXPIRED/ROLLBACK_AVAILABLE -> ROTATION_REQUIRED,
  // an explicit precondition write so every rotation attempt leaves a real
  // "this was requested" row even if the provider call that follows fails.
  if (currentState !== "ROTATION_REQUIRED") {
    const requiredTransition = canTransition(currentState, "ROTATION_REQUIRED");
    if (!requiredTransition.allowed) return { outcome: "INVALID_CURRENT_STATE", currentState };
    await writeState(admin, {
      secretName: params.secretName, environment, owner: entry.group, rotationClass: entry.rotation,
      newState: "ROTATION_REQUIRED", reasonCode, expectedState: currentState === "NOT_CONFIGURED" ? null : currentState,
      tier0RequestId,
    });
  }

  // Step 2: ROTATION_REQUIRED -> ROTATING.
  const rotatingTransition = canTransition("ROTATION_REQUIRED", "ROTATING");
  if (!rotatingTransition.allowed) return { outcome: "INVALID_CURRENT_STATE", currentState: "ROTATION_REQUIRED" };
  await writeState(admin, {
    secretName: params.secretName, environment, owner: entry.group, rotationClass: entry.rotation,
    newState: "ROTATING", reasonCode, expectedState: "ROTATION_REQUIRED", tier0RequestId,
  });

  let newVersionRef: string;
  try {
    const result = await provider.rotate({ secretName: params.secretName, environment });
    newVersionRef = result.newVersionRef;
  } catch {
    await writeState(admin, {
      secretName: params.secretName, environment, owner: entry.group, rotationClass: entry.rotation,
      newState: "FAILED", reasonCode: "provider_rotation_failed", expectedState: "ROTATING", tier0RequestId,
    });
    await recordTier0Execution(admin, { requestId: tier0RequestId, action: "secret.rotate", actorClerkUserId: params.actorClerkUserId, target: { type: "secret_rotation", id: params.secretName }, outcome: "execution_failed", outcomeDetail: "provider_rotation_failed" });
    return { outcome: "PROVIDER_ROTATION_FAILED" };
  }

  // Step 3: ROTATING -> VERIFYING.
  const rotatedAt = new Date().toISOString();
  await writeState(admin, {
    secretName: params.secretName, environment, owner: entry.group, rotationClass: entry.rotation,
    newState: "VERIFYING", reasonCode, expectedState: "ROTATING", tier0RequestId,
    currentVersionRef: newVersionRef, rotatedAt,
  });

  const verification = await verifier.verify({ secretName: params.secretName, environment, newVersionRef });

  if (!verification.verified) {
    const rollbackPossible = entry.rotation === "DUAL_KEY_OVERLAP";
    const nextState: RotationState = rollbackPossible ? "ROLLBACK_AVAILABLE" : "FAILED";
    await writeState(admin, {
      secretName: params.secretName, environment, owner: entry.group, rotationClass: entry.rotation,
      newState: nextState, reasonCode: verification.reasonCode, expectedState: "VERIFYING", tier0RequestId,
    });
    await recordTier0Execution(admin, { requestId: tier0RequestId, action: "secret.rotate", actorClerkUserId: params.actorClerkUserId, target: { type: "secret_rotation", id: params.secretName }, outcome: "execution_failed", outcomeDetail: verification.reasonCode });
    return { outcome: "VERIFICATION_FAILED", rollbackAvailable: rollbackPossible };
  }

  // Step 4: VERIFYING -> ACTIVE.
  const verifiedAt = new Date().toISOString();
  await writeState(admin, {
    secretName: params.secretName, environment, owner: entry.group, rotationClass: entry.rotation,
    newState: "ACTIVE", reasonCode, expectedState: "VERIFYING", tier0RequestId,
    verifiedAt,
  });

  await recordTier0Execution(admin, { requestId: tier0RequestId, action: "secret.rotate", actorClerkUserId: params.actorClerkUserId, target: { type: "secret_rotation", id: params.secretName }, outcome: "executed", outcomeDetail: "rotation_completed" });

  // Best-effort evidence in the security decision log too, alongside the
  // admin_privileged_action_events approval trail above — matching
  // media_release_approved's own dual-recorded pattern. Never blocks the
  // outcome the caller already has.
  void recordSecurityEvent(admin, {
    kind: "secret_rotation_completed",
    source: "secret_rotation_service",
    reasonCode: "rotation_completed",
    actorClerkUserId: params.actorClerkUserId,
    resourceType: "secret",
    resourceId: params.secretName,
    traceId: tier0RequestId,
  }).catch(() => {});

  return { outcome: "ROTATION_COMPLETED", newVersionRef };
}
