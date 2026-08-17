-- ===========================================================================
-- PHASE 16-E — Durable Tier-0 privileged admin action audit + dual control
-- ===========================================================================
-- Roadmap handoff, stated explicitly by three prior Phase 16 packages rather
-- than inferred: Phase 16-B's own security-gates.md entry names DLQ redrive,
-- BullMQ retry and route disable as needing "dual-control/two-person
-- approval, passkeys, step-up auth, or an OPA integration — those are Phase
-- 16-E's to build", and separately flags the audit gap by name:
-- "a durable, immutable audit store — the natural shape of Phase 16-E
-- hardening — should close [this gap]; it is not silently invented here."
-- Phase 16-C and 16-D repeat the same handoff for Moderation and
-- Temporal/Security respectively. This migration is that closure.
--
-- ---------------------------------------------------------------------------
-- WHY NOT security_events (Phase 12-C/12-E)
-- ---------------------------------------------------------------------------
-- `security_events` is a generic security SIGNAL log: rate limits, auth
-- failures, policy decisions, media-safety terminals. It has no concept of a
-- privileged-action REQUEST LIFECYCLE (requested -> awaiting approval ->
-- approved/rejected -> executed) and no concept of a second, distinct
-- approving actor. Widening its `kind`/`source` CHECK taxonomy to also carry
-- Tier-0 request/approval/execution semantics would mix an operational
-- signal feed with a privileged-action ledger and make both harder to read
-- during an incident — precisely the reasoning 12-E already used to justify
-- extending 12-C instead of creating a THIRD table, applied here in the
-- other direction: this is a genuinely different shape, so it gets its own
-- table rather than a third widening of a taxonomy that is not this.
--
-- WHY NOT media_safety_audit / media_release_approvals (Phase 9-E)
-- ---------------------------------------------------------------------------
-- That pair is domain evidence for exactly one decision (asset quarantine
-- release) and is explicitly "shaped for Phase 16 to adopt" as a PATTERN,
-- not a table to widen — its columns are asset-shaped (`asset_id` FK to
-- `media_assets`), not general (target_type/target_id). Phase 9-E's own
-- dual-control mechanism for quarantine release is REUSED, unmodified, as
-- the canonical two-person gate for that one action; this migration builds
-- the GENERAL mechanism other Tier-0 actions (which have no domain table of
-- their own — a routing control, a DLQ message, a BullMQ job, a Temporal
-- workflow) can use, following the exact same PK-on-(request, approver)
-- discipline this codebase already trusts.
--
-- ---------------------------------------------------------------------------
-- ONE APPEND-ONLY EVENT LOG, NOT A MUTABLE LIFECYCLE ROW
-- ---------------------------------------------------------------------------
-- A privileged action's lifecycle (requested_at / approved_at / executed_at)
-- could be modelled as one row with columns filled in over time via UPDATE.
-- That was deliberately rejected: Phase 16-E's own spec requires "ordinary
-- application/admin flows must not update historical audit rows arbitrarily"
-- and prefers append-only semantics where corrections become new evidence,
-- never a silent rewrite. So every lifecycle transition is its OWN row,
-- correlated by `request_id`, exactly like `security_events` never mutates a
-- row after writing it. A reader reconstructs "when was it requested / when
-- approved / when executed" by querying every row for one `request_id`
-- ordered by `occurred_at` — `privileged_action_audit.ts` does exactly that
-- projection; no column here is ever UPDATEd.
--
-- Dual control falls out of the SAME table for free: an 'approved' event is
-- itself the approval, `actor_clerk_user_id` is the approver, and "two
-- distinct people" is COUNT(DISTINCT actor_clerk_user_id) over 'approved'
-- rows for one `request_id`, EXCLUDING the requester by construction (see
-- `record_admin_privileged_action_approval` below) — no second approvals
-- table needed, and no way for a single human to reach the threshold by
-- approving twice (COUNT DISTINCT, not COUNT).
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- admin_privileged_action_events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."admin_privileged_action_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,

    -- Correlates every event in one action's lifecycle. Supplied by the
    -- caller for the FIRST event ('requested') and reused for every
    -- subsequent one — never derived from a mutable "current state" row,
    -- because there isn't one.
    "request_id" "uuid" NOT NULL,

    "event" "text" NOT NULL,

    -- The Clerk identity of the human or service performing THIS event. For
    -- 'approved', this is the approver, never the requester (enforced below).
    "actor_clerk_user_id" "text" NOT NULL,

    -- The catalogue action name (`tier0-action-catalogue.ts`'s keys, e.g.
    -- "queue.dlq.redrive"). Not FK'd to a table — the catalogue is code, the
    -- same relationship `policies/data/actions.json` has to `security_events`.
    "action_type" "text" NOT NULL,
    "target_type" "text" NOT NULL,
    "target_id" "text",

    "reason_code" "text",
    "correlation_id" "text",

    -- The catalogue's classification AT THE TIME of this event, carried on
    -- every row (not just the first) so a reader never has to join back to
    -- code to know how risky the action was considered.
    "security_classification" "text" NOT NULL,

    -- Short code explaining THIS event (e.g. 'step_up_not_configured',
    -- 'role_not_permitted', 'self_approval_blocked', 'shadow_mode'). Never
    -- free text — same discipline as every reason_code in this codebase.
    "outcome_detail" "text",

    "occurred_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,

    CONSTRAINT "admin_privileged_action_events_pkey" PRIMARY KEY ("id"),

    CONSTRAINT "admin_privileged_action_events_event_check" CHECK ("event" = ANY (ARRAY[
      'requested'::"text",
      'denied'::"text",
      'awaiting_second_approval'::"text",
      'approved'::"text",
      'rejected'::"text",
      'executed'::"text",
      'execution_failed'::"text",
      'expired'::"text"
    ])),

    CONSTRAINT "admin_privileged_action_events_classification_check" CHECK (
      "security_classification" = ANY (ARRAY[
        'READ_ONLY'::"text", 'OPERATOR_MUTATION'::"text", 'HIGH_RISK_TIER0'::"text"
      ])
    ),

    CONSTRAINT "admin_privileged_action_events_action_type_check"
      CHECK ("action_type" ~ '^[a-z][a-z0-9_.]{1,80}$'),
    CONSTRAINT "admin_privileged_action_events_target_type_check"
      CHECK ("target_type" ~ '^[a-z][a-z0-9_]{1,64}$'),
    CONSTRAINT "admin_privileged_action_events_reason_check"
      CHECK ("reason_code" IS NULL OR "reason_code" ~ '^[a-z][a-z0-9_]{1,64}$'),
    CONSTRAINT "admin_privileged_action_events_outcome_detail_check"
      CHECK ("outcome_detail" IS NULL OR "outcome_detail" ~ '^[a-z][a-z0-9_]{1,64}$'),

    -- Bounded identifiers. Never a URL, a prompt, a payload or a secret —
    -- the same forbidden list Phase 16-E's own spec states, enforced at the
    -- schema boundary rather than trusted to application code alone.
    CONSTRAINT "admin_privileged_action_events_bounds_check" CHECK (
      "char_length"("actor_clerk_user_id") > 0 AND "char_length"("actor_clerk_user_id") <= 255
      AND ("target_id" IS NULL OR "char_length"("target_id") <= 200)
      AND ("correlation_id" IS NULL OR "char_length"("correlation_id") <= 200)
    )
);

ALTER TABLE "public"."admin_privileged_action_events" OWNER TO "postgres";

CREATE INDEX IF NOT EXISTS "admin_privileged_action_events_request_idx"
  ON "public"."admin_privileged_action_events" ("request_id", "occurred_at");

CREATE INDEX IF NOT EXISTS "admin_privileged_action_events_actor_idx"
  ON "public"."admin_privileged_action_events" ("actor_clerk_user_id", "occurred_at" DESC);

CREATE INDEX IF NOT EXISTS "admin_privileged_action_events_action_idx"
  ON "public"."admin_privileged_action_events" ("action_type", "occurred_at" DESC);

CREATE INDEX IF NOT EXISTS "admin_privileged_action_events_target_idx"
  ON "public"."admin_privileged_action_events" ("target_type", "target_id", "occurred_at" DESC);

CREATE INDEX IF NOT EXISTS "admin_privileged_action_events_occurred_idx"
  ON "public"."admin_privileged_action_events" ("occurred_at");


-- ---------------------------------------------------------------------------
-- Append-only, enforced — identical mechanism to security_events (12-C)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."admin_privileged_action_events_append_only"() RETURNS "trigger"
    LANGUAGE "plpgsql" AS $$
BEGIN
  RAISE EXCEPTION 'admin_privileged_action_events_is_append_only' USING ERRCODE = '23514';
END;
$$;

ALTER FUNCTION "public"."admin_privileged_action_events_append_only"() OWNER TO "postgres";

DROP TRIGGER IF EXISTS "admin_privileged_action_events_append_only_trg" ON "public"."admin_privileged_action_events";
CREATE TRIGGER "admin_privileged_action_events_append_only_trg"
  BEFORE UPDATE OR DELETE ON "public"."admin_privileged_action_events"
  FOR EACH ROW EXECUTE FUNCTION "public"."admin_privileged_action_events_append_only"();


-- ---------------------------------------------------------------------------
-- No browser reaches this, in any direction — same boundary as security_events
-- ---------------------------------------------------------------------------
ALTER TABLE "public"."admin_privileged_action_events" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."admin_privileged_action_events" FROM "anon", "authenticated";
GRANT SELECT, INSERT ON TABLE "public"."admin_privileged_action_events" TO "service_role";


-- ---------------------------------------------------------------------------
-- record_admin_privileged_action_approval() — the dual-control mechanism
-- ---------------------------------------------------------------------------
-- Inserts an 'approved' event, but ONLY for a distinct second actor: the
-- requester of `p_request_id` (the earliest 'requested' event's actor) may
-- never satisfy their own approval, enforced HERE rather than trusted to the
-- caller — the same reason `assertRouteAdmin`/policy checks live inside
-- `quarantine-release.ts`'s functions rather than only at the route layer.
--
-- `pg_advisory_xact_lock` serialises concurrent approvals for the SAME
-- request so two simultaneous second-approvers cannot both read a stale
-- count of 1 and both believe they completed the threshold — the identical
-- correctness concern `approve_media_release`'s `SELECT ... FOR UPDATE`
-- solves for one asset row, adapted here because there is no single row to
-- lock (the "state" is the set of events itself).
CREATE OR REPLACE FUNCTION "public"."record_admin_privileged_action_approval"(
    "p_request_id" "uuid",
    "p_actor" "text",
    "p_action_type" "text",
    "p_target_type" "text",
    "p_target_id" "text" DEFAULT NULL,
    "p_reason_code" "text" DEFAULT NULL,
    "p_correlation_id" "text" DEFAULT NULL,
    "p_security_classification" "text" DEFAULT 'HIGH_RISK_TIER0',
    "p_required_approvals" integer DEFAULT 2
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_requester text;
  v_count integer;
BEGIN
  IF p_actor IS NULL OR "char_length"(p_actor) = 0 THEN
    RAISE EXCEPTION 'invalid_actor' USING ERRCODE = '22023';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request_id' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_request_id::text));

  SELECT actor_clerk_user_id INTO v_requester
    FROM admin_privileged_action_events
   WHERE request_id = p_request_id AND event = 'requested'
   ORDER BY occurred_at ASC
   LIMIT 1;

  IF v_requester IS NULL THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'no_matching_request');
  END IF;

  -- THE STRUCTURAL GUARD. Not an application-layer "if actor === requester"
  -- check that a future call site could forget — the requester's own
  -- approval is never inserted, so it can never be counted, no matter what
  -- calls this function.
  IF v_requester = p_actor THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'self_approval_blocked');
  END IF;

  INSERT INTO admin_privileged_action_events
    (request_id, event, actor_clerk_user_id, action_type, target_type, target_id,
     reason_code, correlation_id, security_classification)
  VALUES
    (p_request_id, 'approved', p_actor, p_action_type, p_target_type, p_target_id,
     p_reason_code, p_correlation_id, p_security_classification);

  SELECT count(DISTINCT actor_clerk_user_id) INTO v_count
    FROM admin_privileged_action_events
   WHERE request_id = p_request_id AND event = 'approved';

  RETURN jsonb_build_object(
    'recorded', true,
    'approvals', v_count,
    'required', p_required_approvals,
    'satisfied', v_count >= p_required_approvals
  );
END;
$$;

ALTER FUNCTION "public"."record_admin_privileged_action_approval"(
  "uuid","text","text","text","text","text","text","text",integer
) OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."record_admin_privileged_action_approval"(
  "uuid","text","text","text","text","text","text","text",integer
) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."record_admin_privileged_action_approval"(
  "uuid","text","text","text","text","text","text","text",integer
) TO "service_role";


COMMENT ON TABLE "public"."admin_privileged_action_events" IS
  'Phase 16-E. Append-only lifecycle evidence for privileged Tier-0 admin actions: requested/denied/awaiting_second_approval/approved/rejected/executed/execution_failed/expired, correlated by request_id. Never a prompt, payload, secret or raw stack. Dual control is COUNT(DISTINCT actor_clerk_user_id) over approved rows, self-approval structurally blocked in record_admin_privileged_action_approval().';
