import { CLERK_USER_ID_PATTERN } from "./user-investigation-contract";
import { GENERATION_ID_PATTERN } from "@/lib/orchestration/generation-api-contract";
import type { RiskAction, SecurityEventKind, SecuritySeverity, SecuritySource } from "@/lib/security/security-event-contract";

/**
 * Phase 16-A "Risk" admin investigation contract — read-only.
 *
 * ---------------------------------------------------------------------------
 * THE CANONICAL RISK/SECURITY EVIDENCE, NOT A SECOND ONE
 * ---------------------------------------------------------------------------
 * `public.security_events` (`supabase/migrations/20260826000000_security_events.sql`,
 * extended by `20260827000000_policy_decision_evidence.sql` — that migration
 * ALTERs `security_events`, it does not create a separate table; there is no
 * `policy_decision_evidence` table anywhere in this schema) is the one
 * append-only security/risk evidence log in this repository. It already
 * carries a `risk_score` and `recommended_action` per row, written by the
 * Phase 12-C Risk Engine (`src/lib/security/risk-engine.ts`, pure
 * `assessRisk()`) at record time. This surface reads those STORED columns —
 * it never re-invokes `assessRisk()` itself, which would double-count
 * recurrence and produce a second, disagreeing score for the same evidence.
 * `service_role` has `SELECT` on `security_events`
 * (`20260826000000_security_events.sql` line 212, `GRANT SELECT, INSERT`),
 * unchanged by every later migration (`20260828000000_rls_grant_hardening.sql`
 * only revokes from `anon`/`authenticated`, never touches `service_role`).
 * No TypeScript anywhere else in this repository reads `security_events` back
 * — this admin surface is its first reader, exactly the intended design (the
 * migration's own comment: "Raw security evidence is operator data").
 *
 * Secondary, supporting evidence: `media_assets`' `quarantine_status` /
 * `moderation_status` / `moderation_engine` / `moderated_at` / `ingest_status`
 * columns — real per-asset safety state, joinable by `clerk_user_id` (NOT
 * NULL on every row) and `generation_id` (nullable FK,
 * `ON DELETE SET NULL`). `generation-investigation-service.ts` (16-A/2)
 * already reads `media_assets` but never selected these columns — this is
 * the first surface to.
 *
 * ---------------------------------------------------------------------------
 * THREE LOOKUP AXES, EACH BACKED BY A REAL COLUMN — NO FABRICATED ONES
 * ---------------------------------------------------------------------------
 * `clerk_user_id` -> `security_events.actor_clerk_user_id` (the verified
 * actor, never a browser claim) + `media_assets.clerk_user_id`.
 * `generation_id` -> `security_events.resource_type = 'generation' AND
 * resource_id = <id>` (a real but GENERIC text column, not a dedicated FK —
 * `resource_type`/`resource_id` is a deliberately generic reference the
 * table uses for every resource kind, per its own schema) +
 * `media_assets.generation_id` (an actual FK here).
 * `trace_id` -> `security_events.trace_id` only; `media_assets` has no
 * `trace_id` column, so a trace-id lookup never queries it — this is a real
 * schema boundary, not an omission, and the result type reflects it (no
 * `PARTIAL_RISK_EVIDENCE` branch is reachable for this axis; only one source
 * is ever attempted).
 *
 * `project_id` is deliberately NOT a lookup axis: `security_events` has no
 * `project_id` column, and inventing a join through a project's owner
 * (`projects.clerk_user_id`) would silently answer "does this project's
 * OWNER have risk evidence" while labelled as a project lookup — a
 * fabricated correlation this contract does not make. An operator
 * investigating a workspace/project follows its owner reference
 * (`/admin/users`) or its generations (already on the Workspace screen) into
 * a `clerk_user_id` or `generation_id` risk lookup instead.
 *
 * `subject_hash` (present on `security_events` for unauthenticated/anonymous
 * signals) is also NOT a lookup axis: it is a one-way hash, and re-deriving
 * it from an operator-supplied value would mean guessing or reimplementing
 * the hash function used at write time — out of scope, and a wrong guess
 * would silently return "no evidence" for evidence that exists.
 */

export type RiskLookupIdentifierType = "clerk_user_id" | "generation_id" | "trace_id";

/** W3C: 32 lowercase hex characters. Mirrors `trace-context.ts`'s own (module-private) shape. */
export const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/;

export function identifierPatternFor(type: RiskLookupIdentifierType): RegExp {
  if (type === "clerk_user_id") return CLERK_USER_ID_PATTERN;
  if (type === "generation_id") return GENERATION_ID_PATTERN;
  return TRACE_ID_PATTERN;
}

export interface RiskEvidenceView {
  readonly eventId: string;
  readonly kind: SecurityEventKind;
  readonly severity: SecuritySeverity;
  readonly source: SecuritySource;
  readonly reasonCode: string;
  /** Null only for rows recorded before this column existed, in principle — never omitted when present. */
  readonly riskScore: number | null;
  readonly recommendedAction: RiskAction | null;
  readonly occurredAt: string;
  readonly traceId: string | null;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  /** The verified actor, when one exists. Never a browser-supplied claim. */
  readonly actorClerkUserId: string | null;
  readonly policyVersion: string | null;
}

export interface MediaSafetySummaryView {
  readonly mediaId: string;
  readonly generationId: string | null;
  readonly quarantineStatus: string;
  readonly moderationStatus: string;
  readonly moderationEngine: string | null;
  readonly moderatedAt: string | null;
  readonly ingestStatus: string;
  readonly createdAt: string;
}

export type RiskInvestigationResult =
  | { readonly outcome: "INVALID_IDENTIFIER" }
  | { readonly outcome: "RISK_SOURCE_UNAVAILABLE"; readonly reasonCode: string }
  | { readonly outcome: "NO_RISK_EVIDENCE" }
  | {
      readonly outcome: "PARTIAL_RISK_EVIDENCE";
      readonly events: readonly RiskEvidenceView[];
      readonly mediaSafety: readonly MediaSafetySummaryView[];
      readonly reasonCode: string;
    }
  | {
      readonly outcome: "FOUND";
      readonly events: readonly RiskEvidenceView[];
      readonly mediaSafety: readonly MediaSafetySummaryView[];
    };
