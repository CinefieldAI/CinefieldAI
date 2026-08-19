import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createLogger } from "@/lib/observability/logger";
import { authorizeTier0Action, recordTier0Execution } from "./tier0-authorization";
import { requirePolicy } from "@/lib/policy/policy-gate";
import { PolicyDenied } from "@/lib/policy/policy-contract";
import type { AssuranceEvidence, ElevationVerdict } from "./step-up-auth";
import { flagDefinition, isValidFlagValue, registeredFlagKeys } from "@/lib/feature-flags/flag-registry";
import { LocalSupabaseFlagProvider, writeFlag } from "@/lib/feature-flags/flag-store";
import { evaluateFlag } from "@/lib/feature-flags/flag-evaluation";
import { enqueueEventStandalone } from "@/lib/events/outbox-repository";
import { buildDomainEvent } from "@/lib/events/domain-event";
import {
  isValidFlagSetReason,
  isValidTicketRef,
  type FeatureFlagAdminListResult,
  type FeatureFlagAdminSetResult,
  type FeatureFlagAdminView,
} from "./feature-flag-admin-contract";

/**
 * The Phase 21-B admin Feature Flags read + mutation service.
 *
 * ---------------------------------------------------------------------------
 * SAME GATE ORDER AS `route.disable` (router-admin-service.ts) — DELIBERATE
 * ---------------------------------------------------------------------------
 * `requirePolicy()` first, `authorizeTier0Action()` second, the real write
 * (`writeFlag`) only after both allow, `recordTier0Execution()` last. This
 * is not a stylistic echo — it is the SAME policy/Tier-0 composition Phase
 * 16-E's own header insists on reusing rather than inventing a second
 * approval engine for a second kind of admin mutation.
 *
 * ---------------------------------------------------------------------------
 * WHICH POLICY ACTION A FLAG CHANGE USES
 * ---------------------------------------------------------------------------
 * `flag.set.operator`   OPERATOR_MUTATION flags (`feature.video.enabled`,
 *                        `uploads.enabled`) — fast, single-operator kill
 *                        switches, matching Phase 9-E's own
 *                        request/reject-vs-release asymmetry (the SAFE
 *                        direction stays single-admin).
 * `flag.set.tier0`      HIGH_RISK_TIER0 flags (`maintenance_mode`, and every
 *                        `release_stage` transition EXCEPT the one below).
 * `release_stage.activate_public`
 *                        The one flag change with a dedicated action name of
 *                        its own: moving `release_stage` to `"public"`
 *                        specifically. Registered `requiresTwoPerson: true`
 *                        — this is the single highest-consequence flip this
 *                        whole system can make (roadmap: "public aşamasına
 *                        geçiş pratikte... GERÇEK PARA EŞİĞİ", real Stripe
 *                        live keys, open signup, no Cloudflare Access wall).
 *
 * ---------------------------------------------------------------------------
 * THE AUDIT EVENT IS BEST-EFFORT, THE FLAG WRITE IS NOT
 * ---------------------------------------------------------------------------
 * `writeFlag()` (the SQL RPC) already captures the durable, authoritative
 * history in `feature_flag_audit` inside its own transaction — the domain
 * event emitted after it is a SEPARATE, non-transactional
 * `enqueueEventStandalone` call (Kafka/consumer notification only). If it
 * fails, the flag change already happened and is already durably audited;
 * the event is not retried inline and not treated as a reason to report the
 * mutation itself as failed.
 */

const auditLog = createLogger("admin-feature-flags");

export async function getFeatureFlagAdminView(admin: SupabaseClient): Promise<FeatureFlagAdminListResult> {
  try {
    const provider = new LocalSupabaseFlagProvider(admin);
    const flags: FeatureFlagAdminView[] = [];
    for (const key of registeredFlagKeys()) {
      const definition = flagDefinition(key);
      if (!definition) continue;
      const details = await evaluateFlag(key, provider);
      flags.push({
        key,
        riskTier: definition.riskTier,
        valueType: definition.valueType,
        allowedValues: definition.allowedValues,
        description: definition.description,
        record: await provider.resolve(key),
        // `details` is not surfaced directly here — the admin view shows the
        // real durable record (or null); evaluateFlag's default-fallback
        // reasoning is for product call sites, not this screen.
      });
      void details;
    }
    return { outcome: "FOUND", flags };
  } catch {
    return { outcome: "SOURCE_UNAVAILABLE", reasonCode: "flag_read_failed" };
  }
}

function policyActionFor(key: string, newValue: boolean | string): string {
  if (key === "release_stage" && newValue === "public") return "release_stage.activate_public";
  const definition = flagDefinition(key);
  return definition?.riskTier === "HIGH_RISK_TIER0" ? "flag.set.tier0" : "flag.set.operator";
}

export async function setFeatureFlagAdmin(
  admin: SupabaseClient,
  actorClerkUserId: string,
  key: string,
  newValue: boolean | string,
  reason: string,
  ticketRef: string | undefined,
  expiresAt: string | null,
  stepUp: { assurance: AssuranceEvidence; elevation: ElevationVerdict } = {
    assurance: { state: "NOT_CONFIGURED", verifiedAt: null },
    elevation: { elevated: false, reasonCode: "no_elevation" },
  },
  requestId: string = randomUUID()
): Promise<FeatureFlagAdminSetResult> {
  const definition = flagDefinition(key);
  if (!definition || !isValidFlagValue(definition, newValue) || !isValidFlagSetReason(reason) || !isValidTicketRef(ticketRef)) {
    return { outcome: "INVALID_TARGET" };
  }

  const action = policyActionFor(key, newValue);

  try {
    await requirePolicy({
      action,
      actor: { id: actorClerkUserId, role: "route_admin", kind: "human" },
      resource: { type: "feature_flag", id: key },
      correlationId: requestId,
    });
  } catch (caught) {
    if (!(caught instanceof PolicyDenied)) throw caught;
    auditLog.info("flag_set_attempted", { actorClerkUserId, key, action, outcome: "POLICY_DENIED", policyReasonCode: caught.reason });
    return { outcome: "POLICY_DENIED", reasonCode: caught.reason };
  }

  const decision = await authorizeTier0Action(admin, {
    requestId,
    action,
    actorClerkUserId,
    target: { type: "feature_flag", id: key },
    reasonCode: null,
    correlationId: null,
    assurance: stepUp.assurance,
    elevation: stepUp.elevation,
  });
  if (!decision.allowed) {
    auditLog.info("flag_set_attempted", { actorClerkUserId, key, action, outcome: "TIER0_AUTHORIZATION_REQUIRED", tier0ReasonCode: decision.reasonCode });
    return { outcome: "TIER0_AUTHORIZATION_REQUIRED", reasonCode: decision.reasonCode, requestId };
  }

  const provider = new LocalSupabaseFlagProvider(admin);
  const before = await provider.resolve(key);

  const written = await writeFlag(admin, {
    key,
    valueType: definition.valueType,
    newValue,
    actorClerkUserId,
    rollbackValue: before?.value ?? definition.defaultValue,
    reasonCode: null,
    ticketRef: ticketRef ?? null,
    expiresAt,
  });

  if (written.outcome === "failed") {
    auditLog.info("flag_set_attempted", { actorClerkUserId, key, action, outcome: "WRITE_FAILED" });
    await recordTier0Execution(admin, {
      requestId,
      action,
      actorClerkUserId,
      target: { type: "feature_flag", id: key },
      outcome: "execution_failed",
      outcomeDetail: "write_failed",
    });
    return { outcome: "WRITE_FAILED", reasonCode: written.errorCode };
  }

  auditLog.info("flag_set_attempted", { actorClerkUserId, key, action, outcome: "APPLIED" });
  await recordTier0Execution(admin, {
    requestId,
    action,
    actorClerkUserId,
    target: { type: "feature_flag", id: key },
    outcome: "executed",
    outcomeDetail: "applied",
  });

  // Best-effort domain event — see this file's header. Never blocks or
  // changes the outcome the caller sees.
  try {
    await enqueueEventStandalone(
      buildDomainEvent({
        eventType: "audit.flag-changed",
        eventVersion: 1,
        aggregateType: "feature_flag",
        aggregateId: key,
        payload: {
          flagKey: key,
          riskTier: definition.riskTier,
          newValue: String(newValue),
          previousValue: written.previousValue === null ? null : String(written.previousValue),
        },
      })
    );
  } catch {
    // Deliberately swallowed — see header.
  }

  return { outcome: "APPLIED", key, value: newValue, previousValue: written.previousValue };
}
