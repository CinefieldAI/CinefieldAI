import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordTier0Execution } from "@/lib/admin/tier0-authorization";
import {
  executeSecretRotation,
  type ExecuteRotationParams,
  type RotationExecutionOutcome,
} from "./rotation-execution-service";

/**
 * The credential-leak auto-runbook (Phase 25-D).
 *
 * Roadmap 25's own component table names this "Leak Runbook: Revoke→
 * rotate→reload→verify→audit". `docs/runbooks/secret-leak.md`'s own header
 * (written in Phase 12-D) says exactly what this fills in: "Phase 25
 * automates the revoke → reload → verify → dead-check loop... an automated
 * credential revoker is itself a denial-of-service tool, and it belongs
 * behind the two-person approval [secret.rotate] already requires."
 *
 * ---------------------------------------------------------------------------
 * NO SECOND POLICY ACTION. REUSES secret.rotate's EXACT AUTHORIZATION.
 * ---------------------------------------------------------------------------
 * A leak response IS an urgent rotation — not a structurally different
 * privileged action. Registering a second `secret.leak_response` policy
 * action would mean a second three-file lockstep
 * (policies/data/actions.json + policy.rego + conformance/cases.json) for
 * an action with an identical risk shape to one that already exists, and
 * section 15's own instruction is explicit: "reuse existing approval
 * engine... do not create another approval mechanism." This module calls
 * `executeSecretRotation()` for the authorize+rotate+verify+ACTIVE core,
 * unmodified, then adds exactly the two steps a routine rotation does not
 * need: explicit old-version revocation and a dead-check that the
 * previous credential no longer authenticates.
 *
 * ---------------------------------------------------------------------------
 * EVERY STEP IS RECORDED, EVEN A FAILED ONE
 * ---------------------------------------------------------------------------
 * `LeakResponseResult.timeline` is the durable "revoke→rotate→reload→
 * verify→dead-check→audit" trail the roadmap names — bounded outcome codes
 * only, never a value, matching every other audit surface in this
 * codebase.
 */

export interface RevocationProvider {
  /** Explicitly invalidates the PREVIOUS version — never the one just created. */
  revoke(params: { secretName: string; previousVersionRef: string }): Promise<{ revoked: boolean }>;
}

export const NoRevocationProvider: RevocationProvider = {
  async revoke() {
    // Honest default: DUAL_KEY_OVERLAP providers keep the old version valid
    // until it is explicitly revoked, and no live per-provider revocation
    // call exists in this repository yet for any of them (Clerk/Supabase/
    // AWS/Cloudflare/provider APIs each have their OWN revoke endpoint,
    // undocumented as code until a real integration is built against a
    // specific provider's dashboard — see docs/runbooks/secret-leak.md).
    return { revoked: false };
  },
};

export interface DeadCheckVerifier {
  /** Proves the OLD credential no longer authenticates. Never assumes it. */
  confirmDead(params: { secretName: string; previousVersionRef: string }): Promise<{ confirmedDead: boolean }>;
}

export const NoDeadCheckVerifier: DeadCheckVerifier = {
  async confirmDead() {
    return { confirmedDead: false };
  },
};

export type LeakResponseStep = "rotate" | "revoke" | "dead_check";
export type LeakResponseStepOutcome = "completed" | "skipped_no_previous_version" | "failed" | "not_configured";

export interface LeakResponseTimelineEntry {
  readonly step: LeakResponseStep;
  readonly outcome: LeakResponseStepOutcome;
}

export type LeakResponseResult =
  | { readonly outcome: "ROTATION_STAGE_FAILED"; readonly rotationOutcome: RotationExecutionOutcome; readonly timeline: readonly LeakResponseTimelineEntry[] }
  | { readonly outcome: "LEAK_RESPONSE_COMPLETED"; readonly newVersionRef: string; readonly timeline: readonly LeakResponseTimelineEntry[] };

export interface ExecuteLeakResponseParams extends ExecuteRotationParams {
  /** Test seam only — never supplied by a real caller. */
  revocationProvider?: RevocationProvider;
  /** Test seam only — never supplied by a real caller. */
  deadCheckVerifier?: DeadCheckVerifier;
}

export async function executeLeakResponse(admin: SupabaseClient, params: ExecuteLeakResponseParams): Promise<LeakResponseResult> {
  const timeline: LeakResponseTimelineEntry[] = [];
  // One request id threads through both the rotation's own Tier-0
  // authorization and this module's follow-up audit row, so an operator
  // reading admin_privileged_action_events sees ONE correlated timeline
  // rather than two unrelated requests.
  const requestId = params.requestId ?? randomUUID();

  const rotationOutcome = await executeSecretRotation(admin, { ...params, requestId });

  if (rotationOutcome.outcome !== "ROTATION_COMPLETED") {
    timeline.push({ step: "rotate", outcome: "failed" });
    return { outcome: "ROTATION_STAGE_FAILED", rotationOutcome, timeline };
  }
  timeline.push({ step: "rotate", outcome: "completed" });

  // The previous version is read back from the durable record — never
  // trusted from the caller, matching every other "read the durable fact,
  // don't accept a claim" rule this codebase already applies.
  const state = await currentStateFor(admin, params.secretName);
  const previousVersionRef = state?.previousVersionRef ?? null;

  const revocationProvider = params.revocationProvider ?? NoRevocationProvider;
  const deadCheckVerifier = params.deadCheckVerifier ?? NoDeadCheckVerifier;

  if (!previousVersionRef) {
    timeline.push({ step: "revoke", outcome: "skipped_no_previous_version" });
    timeline.push({ step: "dead_check", outcome: "skipped_no_previous_version" });
  } else {
    const revocation = await revocationProvider.revoke({ secretName: params.secretName, previousVersionRef });
    timeline.push({ step: "revoke", outcome: revocation.revoked ? "completed" : "not_configured" });

    const deadCheck = await deadCheckVerifier.confirmDead({ secretName: params.secretName, previousVersionRef });
    timeline.push({ step: "dead_check", outcome: deadCheck.confirmedDead ? "completed" : "not_configured" });
  }

  // Best-effort second audit row, correlated by the SAME requestId as the
  // rotation's own — bounded outcome codes only, joined with `,`, never a
  // value. This is what makes "leak runbook eski anahtarı geçersiz kıldığını
  // doğruluyor" (the roadmap's own done-criterion) queryable after the fact
  // rather than only visible in one HTTP response.
  const summary = timeline.map((t) => `${t.step}=${t.outcome}`).join(",").slice(0, 200);
  void recordTier0Execution(admin, {
    requestId,
    action: "secret.rotate",
    actorClerkUserId: params.actorClerkUserId,
    target: { type: "secret_rotation", id: params.secretName },
    outcome: "executed",
    outcomeDetail: `leak_response:${summary}`,
  }).catch(() => {});

  return { outcome: "LEAK_RESPONSE_COMPLETED", newVersionRef: rotationOutcome.newVersionRef, timeline };
}

async function currentStateFor(admin: SupabaseClient, secretName: string): Promise<{ previousVersionRef: string | null } | null> {
  const { data } = await admin.from("secret_rotations").select("previous_version_ref").eq("secret_name", secretName).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  const row = data as { previous_version_ref: string | null } | null;
  return row ? { previousVersionRef: row.previous_version_ref } : null;
}
