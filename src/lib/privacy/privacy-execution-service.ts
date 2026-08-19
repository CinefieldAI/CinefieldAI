import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePolicy } from "@/lib/policy/policy-gate";
import { PolicyDenied } from "@/lib/policy/policy-contract";
import { authorizeTier0Action, recordTier0Execution } from "@/lib/admin/tier0-authorization";
import { queryPrivilegedActionAudit } from "@/lib/admin/privileged-action-audit";
import type { AssuranceEvidence, ElevationVerdict } from "@/lib/admin/step-up-auth";
import { createLogger } from "@/lib/observability/logger";
import { getPrivacyRequest, markPrivacyRequestProcessing, resolvePrivacyRequest } from "./privacy-request-store";
import { buildDsarExportBundle, serializeDsarBundle, buildDsarExportObjectKey } from "./dsar-export";
import { putAssetObject, createPresignedDownload, DOWNLOAD_URL_TTL_SECONDS } from "@/lib/media/r2-client";
import { executeAccountDeletion, type AccountDeletionDeps } from "./account-deletion-workflow";

/**
 * The Phase 23-B/23-C privileged execution service — the ONLY caller of
 * `data.export`/`data.delete`.
 *
 * Reuses `router-admin-service.ts`'s two real gates (Phase 16-E/19) —
 * `requirePolicy()` (the OPA-mirrored policy gate, `policies/data/
 * actions.json`) and `authorizeTier0Action()` (role + step-up + two-person
 * dual control, `admin_privileged_action_events`) — but in the OPPOSITE
 * order, for one documented reason: `data.export`/`data.delete` are the
 * only actions in the registry where policy's own `requiresHumanApproval`
 * is true alongside Tier-0's `requiresTwoPerson`, and the approval
 * evidence policy needs is SOURCED from Tier-0's own durable state (see
 * `resolveHumanApprovalEvidence`'s header). Tier-0 runs first so that
 * evidence exists to check; policy still runs, unconditionally, as the
 * final gate immediately before real work happens — followed by
 * `recordTier0Execution()`. Neither gate is a second promotion/authority
 * engine, and neither is ever skipped; both are the EXISTING Phase 16-E/19
 * mechanism, unmodified.
 *
 * `requestId` is optional so a caller can RESUME a pending two-person
 * request — identical contract to `setAdminRouteEnabled`'s own
 * `requestId` parameter.
 */

const auditLog = createLogger("privacy-execution");

const DSAR_EXPORT_DOWNLOAD_TTL_SECONDS = DOWNLOAD_URL_TTL_SECONDS;

export type ExecutePrivacyRequestOutcome =
  | { outcome: "INVALID_REQUEST" }
  | { outcome: "REQUEST_NOT_FOUND" }
  | { outcome: "REQUEST_ALREADY_RESOLVED" }
  | { outcome: "POLICY_DENIED"; reasonCode: string }
  | { outcome: "TIER0_AUTHORIZATION_REQUIRED"; reasonCode: string; requestId: string }
  | { outcome: "EXPORT_TOO_LARGE" }
  | { outcome: "EXECUTION_FAILED" }
  | { outcome: "EXPORT_COMPLETED"; downloadUrl: string; expiresInSeconds: number }
  | {
      outcome: "DELETION_COMPLETED";
      mediaAssetsTombstoned: number;
      mediaAssetsPhysicallyDeleted: number;
      mediaAssetsLegalHoldExcluded: number;
      clerkAccountDeleted: boolean;
    };

export interface ExportR2Deps {
  putObject?: typeof putAssetObject;
  presignDownload?: typeof createPresignedDownload;
}

export interface ExecutePrivacyRequestParams {
  privacyRequestId: string;
  actorClerkUserId: string;
  stepUp?: { assurance: AssuranceEvidence; elevation: ElevationVerdict };
  requestId?: string;
  /** Test seam only — never supplied by a real caller. */
  accountDeletionDeps?: AccountDeletionDeps;
  /** Test seam only — never supplied by a real caller. */
  exportR2Deps?: ExportR2Deps;
}

const REQUEST_ID_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `data.export`/`data.delete` are the one place in this codebase's registry
 * where BOTH `requiresTwoPerson` and `requiresHumanApproval` are true for
 * the same action (pre-existing scaffolding, `policies/data/actions.json`).
 * `requirePolicy()`'s own `approvalEvidence` contract (see
 * `deployment-policy-gate.ts`'s identical comment) says it must be
 * "resolved from durable state by the caller — never 'assume yes'". Rather
 * than inventing a THIRD approval concept, this reads the exact same
 * `admin_privileged_action_events` evidence `authorizeTier0Action`'s own
 * two-person check already relies on: two DISTINCT approvers already
 * recorded for this `tier0RequestId` IS the human approval evidence — one
 * durable fact, read twice, never a second approval mechanism.
 */
async function resolveHumanApprovalEvidence(admin: SupabaseClient, tier0RequestId: string): Promise<boolean> {
  const result = await queryPrivilegedActionAudit(admin, {});
  if (result.outcome !== "FOUND") return false;
  const approvers = new Set(
    result.rows.filter((row) => row.requestId === tier0RequestId && row.event === "approved").map((row) => row.actorClerkUserId)
  );
  return approvers.size >= 2;
}

export async function executePrivacyRequest(
  admin: SupabaseClient,
  params: ExecutePrivacyRequestParams
): Promise<ExecutePrivacyRequestOutcome> {
  if (!REQUEST_ID_UUID.test(params.privacyRequestId)) return { outcome: "INVALID_REQUEST" };

  const record = await getPrivacyRequest(admin, params.privacyRequestId);
  if (!record) return { outcome: "REQUEST_NOT_FOUND" };
  if (record.status !== "pending" && record.status !== "processing") return { outcome: "REQUEST_ALREADY_RESOLVED" };

  const action = record.requestType === "export" ? "data.export" : "data.delete";
  const tier0RequestId = params.requestId ?? randomUUID();
  const stepUp = params.stepUp ?? {
    assurance: { state: "NOT_CONFIGURED" as const, verifiedAt: null },
    elevation: { elevated: false, reasonCode: "no_elevation" as const },
  };

  // TIER-0 RUNS FIRST HERE — a deliberate, documented deviation from
  // `router-admin-service.ts`'s "policy is the first gate" convention.
  // `data.export`/`data.delete` are the one action pair in this registry
  // where `requiresHumanApproval` (OPA/`requirePolicy`) is true ALONGSIDE
  // `requiresTwoPerson` (Tier-0) — and `resolveHumanApprovalEvidence` above
  // sources that approval evidence FROM Tier-0's own
  // `admin_privileged_action_events` state. Policy cannot honestly evaluate
  // approval evidence that does not exist yet, so Tier-0 (the evidence's
  // real owner) authorizes first; policy still runs, unskippable, as the
  // final confirmation immediately before real work happens — it is not
  // bypassed, only reordered for the one class of action whose evidence
  // requires it.
  const decision = await authorizeTier0Action(admin, {
    requestId: tier0RequestId,
    action,
    actorClerkUserId: params.actorClerkUserId,
    target: { type: "privacy_request", id: record.id },
    reasonCode: null,
    correlationId: null,
    assurance: stepUp.assurance,
    elevation: stepUp.elevation,
  });
  if (!decision.allowed) {
    auditLog.info("privacy_request_execution_attempted", { requestId: record.id, action, outcome: "TIER0_AUTHORIZATION_REQUIRED", tier0ReasonCode: decision.reasonCode });
    return { outcome: "TIER0_AUTHORIZATION_REQUIRED", reasonCode: decision.reasonCode, requestId: tier0RequestId };
  }

  try {
    const humanApproved = await resolveHumanApprovalEvidence(admin, tier0RequestId);
    await requirePolicy({
      action,
      actor: { id: params.actorClerkUserId, role: "route_admin", kind: "human" },
      resource: { type: "privacy_request", id: record.id },
      approvalEvidence: { humanApproved },
      correlationId: tier0RequestId,
    });
  } catch (caught) {
    if (!(caught instanceof PolicyDenied)) throw caught;
    auditLog.info("privacy_request_execution_attempted", { requestId: record.id, action, outcome: "POLICY_DENIED", policyReasonCode: caught.reason });
    return { outcome: "POLICY_DENIED", reasonCode: caught.reason };
  }

  if (record.status === "pending") {
    await markPrivacyRequestProcessing(admin, record.id, tier0RequestId);
  }

  if (record.requestType === "export") {
    return executeExport(admin, record.id, record.clerkUserId, params.actorClerkUserId, tier0RequestId, action, params.exportR2Deps);
  }
  return executeDeletion(admin, record.id, record.clerkUserId, params.actorClerkUserId, tier0RequestId, action, params.accountDeletionDeps);
}

async function executeExport(
  admin: SupabaseClient,
  requestId: string,
  clerkUserId: string,
  actorClerkUserId: string,
  tier0RequestId: string,
  action: string,
  deps: ExportR2Deps = {}
): Promise<ExecutePrivacyRequestOutcome> {
  const putObject = deps.putObject ?? putAssetObject;
  const presignDownload = deps.presignDownload ?? createPresignedDownload;
  try {
    const bundle = await buildDsarExportBundle(admin, clerkUserId);
    const serialized = serializeDsarBundle(bundle);
    if (serialized.outcome === "too_large") {
      await resolvePrivacyRequest(admin, { requestId, status: "failed", resolvedBy: actorClerkUserId, tier0RequestId, reasonCode: "export_too_large" });
      await recordTier0Execution(admin, { requestId: tier0RequestId, action, actorClerkUserId, target: { type: "privacy_request", id: requestId }, outcome: "execution_failed", outcomeDetail: "export_too_large" });
      return { outcome: "EXPORT_TOO_LARGE" };
    }

    const objectKey = buildDsarExportObjectKey(clerkUserId, requestId);
    await putObject({ objectKey, bytes: new TextEncoder().encode(serialized.json), declaredContentType: "application/json" });
    const { downloadUrl, expiresInSeconds } = await presignDownload({ objectKey, expiresInSeconds: DSAR_EXPORT_DOWNLOAD_TTL_SECONDS });
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    await resolvePrivacyRequest(admin, {
      requestId,
      status: "completed",
      resolvedBy: actorClerkUserId,
      tier0RequestId,
      exportObjectKey: objectKey,
      exportExpiresAt: expiresAt,
    });
    await recordTier0Execution(admin, { requestId: tier0RequestId, action, actorClerkUserId, target: { type: "privacy_request", id: requestId }, outcome: "executed", outcomeDetail: "export_completed" });
    auditLog.info("privacy_request_execution_attempted", { requestId, action, outcome: "EXPORT_COMPLETED" });
    return { outcome: "EXPORT_COMPLETED", downloadUrl, expiresInSeconds };
  } catch {
    await resolvePrivacyRequest(admin, { requestId, status: "failed", resolvedBy: actorClerkUserId, tier0RequestId, reasonCode: "export_execution_failed" });
    await recordTier0Execution(admin, { requestId: tier0RequestId, action, actorClerkUserId, target: { type: "privacy_request", id: requestId }, outcome: "execution_failed", outcomeDetail: "export_execution_failed" });
    return { outcome: "EXECUTION_FAILED" };
  }
}

async function executeDeletion(
  admin: SupabaseClient,
  requestId: string,
  clerkUserId: string,
  actorClerkUserId: string,
  tier0RequestId: string,
  action: string,
  deps: AccountDeletionDeps | undefined
): Promise<ExecutePrivacyRequestOutcome> {
  try {
    const result = await executeAccountDeletion(
      admin,
      { clerkUserId, reasonCode: "dsar_deletion_request", requestedBy: clerkUserId, executedBy: actorClerkUserId, privacyRequestId: requestId },
      deps ?? {}
    );

    await resolvePrivacyRequest(admin, {
      requestId,
      status: "completed",
      resolvedBy: actorClerkUserId,
      tier0RequestId,
      reasonCode: result.outcome === "already_tombstoned" ? "already_tombstoned" : "deletion_completed",
    });
    await recordTier0Execution(admin, { requestId: tier0RequestId, action, actorClerkUserId, target: { type: "privacy_request", id: requestId }, outcome: "executed", outcomeDetail: result.outcome });
    auditLog.info("privacy_request_execution_attempted", { requestId, action, outcome: "DELETION_COMPLETED" });

    if (result.outcome === "already_tombstoned") {
      return { outcome: "DELETION_COMPLETED", mediaAssetsTombstoned: 0, mediaAssetsPhysicallyDeleted: 0, mediaAssetsLegalHoldExcluded: 0, clerkAccountDeleted: false };
    }
    return {
      outcome: "DELETION_COMPLETED",
      mediaAssetsTombstoned: result.mediaAssetsTombstoned,
      mediaAssetsPhysicallyDeleted: result.mediaAssetsPhysicallyDeleted,
      mediaAssetsLegalHoldExcluded: result.mediaAssetsLegalHoldExcluded,
      clerkAccountDeleted: result.clerkAccountDeleted,
    };
  } catch {
    await resolvePrivacyRequest(admin, { requestId, status: "failed", resolvedBy: actorClerkUserId, tier0RequestId, reasonCode: "deletion_execution_failed" });
    await recordTier0Execution(admin, { requestId: tier0RequestId, action, actorClerkUserId, target: { type: "privacy_request", id: requestId }, outcome: "execution_failed", outcomeDetail: "deletion_execution_failed" });
    return { outcome: "EXECUTION_FAILED" };
  }
}
