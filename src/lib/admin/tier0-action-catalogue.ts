/**
 * Phase 16-E — the Tier-0 privileged action catalogue.
 *
 * ---------------------------------------------------------------------------
 * CLASSIFIES AUTHORITY ONLY. NEVER A SECOND ACTION OWNER.
 * ---------------------------------------------------------------------------
 * This module is a lookup table, nothing else: no I/O, no Supabase, no
 * Clerk, no mutation of anything. It answers "how risky is this action, and
 * what does Phase 16-E require before it may proceed?" — the canonical
 * OWNER of each action (Phase 7 routing, Phase 9-E quarantine, Phase 15-D
 * DLQ redrive, BullMQ, Temporal) is completely unchanged and is never
 * imported here. `tier0-authorization.ts` reads this catalogue as ONE input
 * among several (alongside `admin-privilege.ts`'s role resolution and
 * `step-up-auth.ts`'s assurance evidence) and composes a decision; it never
 * invokes the action itself.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT `policies/data/actions.json`
 * ---------------------------------------------------------------------------
 * That registry is Phase 12-E's OPA-mirrored embedded policy engine's own
 * vocabulary, bound line-for-line to `policies/cinefield/policy.rego` and
 * `policies/conformance/cases.json` — extending it means deciding a new
 * action's `requiredRoles`/`requiresHumanApproval` under the SAME ladder
 * every other critical action uses (AI-write-authority-off, risk state,
 * environment, origin class) and keeping three files in lockstep. Step-up
 * assurance is a DIFFERENT concern from that ladder — it is about Clerk
 * session assurance level, not action policy — and folding it into the OPA
 * mirror would make Phase 12/19's policy engine also the owner of MFA
 * state, which Section 2 of the 16-E spec forbids ("must NOT become... a
 * second policy owner"). This catalogue is Phase 16-E's OWN, narrower
 * concern: privileged-admin surface authority. Where an action IS already
 * registered in `policies/data/actions.json` (`media.quarantine.release`,
 * `routing.control.set`/`.clear`), that registry's gate keeps running,
 * completely unmodified, inside its own canonical owner — this catalogue's
 * classification is an ADDITIONAL, composed condition, never a replacement.
 *
 * ---------------------------------------------------------------------------
 * CLASSIFICATION IS EVIDENCE, ENFORCEMENT IS A SEPARATE DECISION
 * ---------------------------------------------------------------------------
 * `requiresTwoPerson`/`requiresStepUp` describe what Phase 16-E has decided
 * an action SHOULD require. Whether that requirement is currently
 * hard-enforced (denies) or shadow-evaluated (recorded but non-blocking) at
 * a given call site is `tier0-authorization.ts`'s / the enforcement mode's
 * concern (`CINEFIELD_TIER0_ENFORCEMENT_MODE`) — see that file's header for
 * exactly why blanket hard-enforcement is not switched on by this batch.
 */

export type Tier0SecurityClassification = "READ_ONLY" | "OPERATOR_MUTATION" | "HIGH_RISK_TIER0";

export interface Tier0ActionEntry {
  readonly classification: Tier0SecurityClassification;
  /** The minimum `AdminPrivilegeRole` (admin-privilege.ts) required. */
  readonly minimumRole: "viewer" | "operator" | "tier0_admin";
  readonly requiresStepUp: boolean;
  /**
   * Whether a SECOND, distinct human must approve before execution. `false`
   * here does not mean "no dual control exists" — `media.quarantine.release`
   * already has real, structural two-person enforcement inside its own
   * canonical owner (Phase 9-E); this catalogue does not duplicate that
   * mechanism, only records that it exists elsewhere.
   */
  readonly requiresTwoPerson: boolean;
  /** Free-text ONLY here — documentation for operators reading the catalogue, never persisted verbatim as a reason_code. */
  readonly owner: string;
  readonly note: string;
}

/**
 * Every mutation Phase 16-A/B/C/D actually exposes, classified. Read actions
 * (investigation panels, health, security-center reads) are uniformly
 * READ_ONLY and are not enumerated individually — none of them mutates
 * anything, and Section 6 of the spec asks for the MUTATION surface to be
 * catalogued, not a duplicate of the admin nav.
 *
 * `deploy.rollback.execute` / `restore.execute` are deliberately ABSENT:
 * `deploy-restore-admin-service.ts` (16-D) is READ-ONLY — `evaluateRollback`
 * and `runRestoreVerification` are evaluations, not mutations, and no
 * execute action exists yet anywhere in this repository to classify. Adding
 * a catalogue entry for an action that cannot be invoked would be exactly
 * the "invent policy" Section 10 warns against.
 */
export const TIER0_ACTION_CATALOGUE: Readonly<Record<string, Tier0ActionEntry>> = {
  "media.quarantine.request": {
    classification: "OPERATOR_MUTATION",
    minimumRole: "operator",
    requiresStepUp: false,
    requiresTwoPerson: false,
    owner: "phase-9e (src/lib/media/quarantine-release.ts) via phase-16c (moderation-admin-service.ts)",
    note: "Records one admin's request. Does not release anything on its own.",
  },
  "media.quarantine.release": {
    classification: "HIGH_RISK_TIER0",
    minimumRole: "tier0_admin",
    requiresStepUp: true,
    // Already real, structural, SQL-enforced two-person control in
    // approve_media_release() (media_release_approvals PK). Not duplicated
    // here — see this file's header.
    requiresTwoPerson: false,
    owner: "phase-9e (src/lib/media/quarantine-release.ts) via phase-16c (moderation-admin-service.ts)",
    note: "Irreversibly exposes quarantined media. Two-person control already structural in Phase 9-E's own SQL.",
  },
  "media.quarantine.reject": {
    classification: "OPERATOR_MUTATION",
    minimumRole: "operator",
    requiresStepUp: false,
    requiresTwoPerson: false,
    owner: "phase-9e (src/lib/media/quarantine-release.ts) via phase-16c (moderation-admin-service.ts)",
    note: "The safe direction (keeps media out of circulation) — single-admin by Phase 9-E's own design.",
  },
  "routing.control.set": {
    classification: "HIGH_RISK_TIER0",
    minimumRole: "tier0_admin",
    requiresStepUp: true,
    requiresTwoPerson: false,
    owner: "phase-7e (src/lib/routing/admin-route-service.ts, setRuntimeRoutingControl)",
    note:
      "Roadmap-named for two-person control (docs/security-gates.md, admin-route-service.ts header, cites roadmap ¶2284) " +
      "but not currently reachable from any Phase 16 admin route (16-B wired setRouteEnabled instead — see route.disable " +
      "below). Classified for completeness; BUSINESS_DECISION_REQUIRED before wiring an admin UI to it.",
  },
  "routing.control.clear": {
    classification: "HIGH_RISK_TIER0",
    minimumRole: "tier0_admin",
    requiresStepUp: true,
    requiresTwoPerson: false,
    owner: "phase-7e (src/lib/routing/admin-route-service.ts, clearRuntimeRoutingControl)",
    note: "Same as routing.control.set — restoring traffic is the riskier direction, not the safer one.",
  },
  "route.disable": {
    classification: "HIGH_RISK_TIER0",
    minimumRole: "tier0_admin",
    requiresStepUp: true,
    // PHASE 19 CLOSURE FIX: the roadmap's own Phase 19 Two-Person Approval
    // list (¶2344) names "provider enable/disable" explicitly, and
    // `route.disable` (setRouteEnabled) is the REAL, production-reachable
    // route/provider-disable path — see `router-admin-service.ts`'s header
    // for why `setRouteEnabled` rather than `setRuntimeRoutingControl` is
    // the one an admin route actually calls. Previously false with a
    // BUSINESS_DECISION_REQUIRED note; that decision is now made. This
    // activates the ALREADY-BUILT dual-control branch in
    // `authorizeTier0Action` (the generic `admin_privileged_action_events`
    // mechanism this file's own header describes) rather than adding a
    // second one.
    requiresTwoPerson: true,
    owner: "phase-7b (src/lib/routing/admin-route-service.ts, setRouteEnabled) via phase-16b (router-admin-service.ts)",
    note: "Reversible (same function re-enables), but redirects production traffic — named explicitly in the 16-B/16-E handoff and the roadmap's Two-Person Approval list.",
  },
  "queue.dlq.redrive": {
    classification: "HIGH_RISK_TIER0",
    minimumRole: "tier0_admin",
    requiresStepUp: true,
    // PHASE 19 CLOSURE FIX: roadmap ¶2344 names "DLQ redrive" explicitly on
    // the Two-Person Approval list. Activates the same generic dual-control
    // mechanism as `route.disable` above.
    requiresTwoPerson: true,
    owner: "phase-15d (src/lib/aws/dlq-redrive/) via phase-16b (dlq-admin-service.ts)",
    note: "Re-submits a message to a live provider queue. Named explicitly in the 16-B/16-E handoff and the roadmap's Two-Person Approval list.",
  },
  "queue.bullmq.retry": {
    classification: "OPERATOR_MUTATION",
    minimumRole: "operator",
    requiresStepUp: false,
    requiresTwoPerson: false,
    owner: "phase-6r8 (BullMQ foundation) via phase-16b (bullmq-admin-service.ts)",
    note: "Auxiliary-queue retry, not a production provider dispatch — lower severity than DLQ redrive by design.",
  },
  "temporal.workflow.cancel": {
    classification: "HIGH_RISK_TIER0",
    minimumRole: "tier0_admin",
    requiresStepUp: true,
    // PHASE 19 CLOSURE FIX: roadmap ¶2344 names "Temporal workflow cancel"
    // explicitly on the Two-Person Approval list. Activates the same
    // generic dual-control mechanism as `route.disable`/`queue.dlq.redrive`
    // above.
    requiresTwoPerson: true,
    owner: "phase-6rh (cancel-intent.ts, generation-starter.ts) via phase-16d (temporal-admin-service.ts)",
    note: "Stops a running generation on an admin's own initiative, distinct from the owner's cancel path. Named explicitly in the roadmap's Two-Person Approval list.",
  },
  "flag.set.operator": {
    classification: "OPERATOR_MUTATION",
    minimumRole: "operator",
    requiresStepUp: false,
    requiresTwoPerson: false,
    owner: "phase-21 (src/lib/feature-flags/flag-store.ts, writeFlag) via phase-21 (feature-flag-admin-service.ts)",
    note: "Fast, reversible, single-target kill switches (feature.video.enabled, uploads.enabled) — the SAFE (kill) direction stays single-admin, mirroring media.quarantine.request/.reject's own asymmetry.",
  },
  "flag.set.tier0": {
    classification: "HIGH_RISK_TIER0",
    minimumRole: "tier0_admin",
    requiresStepUp: true,
    requiresTwoPerson: false,
    owner: "phase-21 (src/lib/feature-flags/flag-store.ts, writeFlag) via phase-21 (feature-flag-admin-service.ts)",
    note: "maintenance_mode (whole-site blast radius) and every release_stage transition except the one below. Fast single-operator authorization is intentional — an incident kill switch that requires coordinating a second human defeats its own purpose.",
  },
  "data.export": {
    classification: "HIGH_RISK_TIER0",
    minimumRole: "tier0_admin",
    requiresStepUp: true,
    // Phase 23. Already registered in policies/data/actions.json
    // (requiresTwoPerson: true, requiresHumanApproval: true, owner:
    // "phase-23") — that gate keeps running, unmodified, as the composed
    // OPA-mirrored condition this file's own header describes. Activates
    // the SAME generic dual-control mechanism as route.disable/queue.dlq.
    // redrive/temporal.workflow.cancel/release_stage.activate_public — a
    // bulk export of one user's personal data is at least as consequential
    // as any of those.
    requiresTwoPerson: true,
    owner: "phase-23 (src/lib/privacy/privacy-execution-service.ts)",
    note: "Bulk personal-data export for one data subject. A misauthorized DSAR endpoint is directly a \"give all user data as ZIP\" API — the roadmap's own stated risk.",
  },
  "data.delete": {
    classification: "HIGH_RISK_TIER0",
    minimumRole: "tier0_admin",
    requiresStepUp: true,
    requiresTwoPerson: true,
    owner: "phase-23 (src/lib/privacy/privacy-execution-service.ts, AccountDeletionWorkflow)",
    note: "Irreversible account erasure across Postgres/R2/Clerk. The single highest-consequence data mutation this system can make against one user's own data.",
  },
  "secret.rotate": {
    classification: "HIGH_RISK_TIER0",
    minimumRole: "tier0_admin",
    requiresStepUp: true,
    // Phase 25. Already registered in policies/data/actions.json
    // (requiresTwoPerson: true, requiresHumanApproval: true, owner:
    // "phase-25") — that gate keeps running, unmodified, as the composed
    // OPA-mirrored condition this file's own header describes. Activates
    // the SAME generic dual-control mechanism as data.export/data.delete/
    // route.disable/queue.dlq.redrive above — an automated credential
    // revoker/rotator is itself a denial-of-service tool if it can act
    // alone (docs/runbooks/secret-leak.md's own stated reasoning).
    requiresTwoPerson: true,
    owner: "phase-25 (src/lib/secrets/rotation-execution-service.ts, src/lib/secrets/leak-runbook.ts)",
    note: "Rotates or revokes a live provider/infrastructure credential. The single highest-consequence action this system can take against its own operational integrity — a wrong rotation can take every dependent worker down at once.",
  },
  "release_stage.activate_public": {
    classification: "HIGH_RISK_TIER0",
    minimumRole: "tier0_admin",
    requiresStepUp: true,
    // The single highest-consequence flag flip this system can make: real
    // Stripe live keys, open signup, no Cloudflare Access wall — the
    // roadmap's own "public aşamasına geçiş... GERÇEK PARA EŞİĞİ" language.
    // Activates the same generic dual-control mechanism as
    // route.disable/queue.dlq.redrive/temporal.workflow.cancel above.
    requiresTwoPerson: true,
    owner: "phase-21 (src/lib/feature-flags/flag-store.ts, writeFlag) via phase-21 (feature-flag-admin-service.ts)",
    note: "release_stage -> \"public\" specifically. Every OTHER release_stage transition (alpha<->beta) uses flag.set.tier0 above, not this action.",
  },
  "chaos.game_day.record": {
    classification: "OPERATOR_MUTATION",
    minimumRole: "operator",
    requiresStepUp: false,
    requiresTwoPerson: false,
    owner: "phase-26 (src/lib/chaos/game-day-execution-service.ts)",
    note:
      "Records the server-recomputed outcome of an already-completed local/test/staging drill — never triggers fault " +
      "injection, never accepts a caller-supplied verdict. Lower risk than a destructive/irreversible action, so single-" +
      "operator authorization is intentional: over-gating evidence recording would discourage the frequent drilling the " +
      "roadmap wants. No production-targeting path exists to classify — chaos-environment-guard.ts refuses it unconditionally.",
  },
} as const;

export type Tier0ActionName = keyof typeof TIER0_ACTION_CATALOGUE;

export function tier0ActionEntry(action: string): Tier0ActionEntry | null {
  return Object.prototype.hasOwnProperty.call(TIER0_ACTION_CATALOGUE, action)
    ? TIER0_ACTION_CATALOGUE[action as Tier0ActionName]
    : null;
}

export function registeredTier0Actions(): string[] {
  return Object.keys(TIER0_ACTION_CATALOGUE).sort();
}
