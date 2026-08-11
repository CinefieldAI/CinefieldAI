-- Cinefield Phase 6R.9 — Transactional outbox.
--
-- ===========================================================================
-- WHY AN OUTBOX EXISTS AT ALL
-- ===========================================================================
-- A domain event must never disagree with the database. Publishing to Kafka
-- directly after committing a business change has an unavoidable gap: the
-- commit succeeds, the process dies before the publish, and the event is
-- lost forever with no record that it should have existed. The reverse
-- order is worse — publish first, then fail to commit, and consumers have
-- acted on a fact that never became true.
--
-- The outbox closes that gap by making the event row part of THE SAME
-- transaction as the business change. Either both commit or neither does.
-- A separate publisher then reads committed outbox rows and forwards them
-- to Kafka, retrying until it succeeds. Kafka being down delays delivery;
-- it can never lose the event or desynchronize it from the database.
--
-- ===========================================================================
-- WHAT "SAME TRANSACTION" MEANS HERE, CONCRETELY
-- ===========================================================================
-- Supabase's PostgREST client cannot span one transaction across two HTTP
-- requests. Calling `.update(...)` and then `.insert(outbox)` from
-- TypeScript is TWO transactions and is NOT a transactional outbox, no
-- matter how the code is arranged.
--
-- The mechanism this project already uses for atomic money operations is a
-- PL/pgSQL SECURITY DEFINER function: every statement inside one function
-- body runs in a single implicit transaction, and an exception anywhere
-- rolls the whole thing back (see 20260811120000_credit_system.sql's
-- reserve_credits/settle_reservation, whose own comments rely on exactly
-- this property). `emit_outbox_event()` below is designed to be CALLED FROM
-- INSIDE such a function, so the event insert joins the caller's existing
-- transaction. That is the real boundary — not a TypeScript sequence.
--
-- WHAT IS AND IS NOT WIRED YET (do not overstate this):
--   WIRED      the mechanism itself, provably (emit_outbox_event, plus the
--              zero-cost proof functions at the end of this file that
--              demonstrate commit-together and rollback-together).
--   NOT WIRED  generation finalization and the credit lifecycle. Neither
--              reserve_credits, settle_reservation, refund_reservation, nor
--              any generation state change calls emit_outbox_event yet.
--              Adding those calls is a deliberate, separately-reviewed
--              change — this migration does not modify any existing
--              function, so no current behavior changes.
--
-- ===========================================================================
-- DELIVERY SEMANTICS — AT-LEAST-ONCE, NEVER EXACTLY-ONCE
-- ===========================================================================
-- A publisher can succeed at Kafka and then crash before marking the row
-- published; the row is retried and the event is delivered twice. This is
-- inherent to the pattern and is not a defect. `event_id` is stable across
-- every retry precisely so consumers can deduplicate on it. Nothing in
-- this system provides exactly-once processing or exactly-once business
-- effects — consumers must be idempotent, exactly as the SQS provider
-- worker and generation_attempts CAS already assume for commands.
-- ===========================================================================


CREATE TABLE IF NOT EXISTS "public"."outbox_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,

    -- Stable across every publish retry. THE consumer-side deduplication
    -- identity — unique so a caller cannot accidentally enqueue the same
    -- logical event twice under one id.
    "event_id" "uuid" NOT NULL,

    "event_type" "text" NOT NULL,
    "event_version" integer NOT NULL,
    "aggregate_type" "text" NOT NULL,
    "aggregate_id" "text" NOT NULL,

    -- Correlation id, matching the `traceId` convention the SQS command
    -- wire (src/lib/contracts/command-wire.ts) already carries.
    "trace_id" "text",

    "payload" "jsonb" NOT NULL,
    "occurred_at" timestamp with time zone NOT NULL,

    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "publish_attempts" integer DEFAULT 0 NOT NULL,

    -- Claim lease: a publisher stamps both when it takes a batch, so a
    -- crashed publisher's rows become reclaimable after the lease elapses
    -- rather than being stranded forever.
    "claim_token" "uuid",
    "claimed_at" timestamp with time zone,

    "published_at" timestamp with time zone,
    "last_error_code" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "outbox_events_event_id_uniq" UNIQUE ("event_id"),

    CONSTRAINT "outbox_events_status_check" CHECK (("status" = ANY (ARRAY[
      'pending'::"text", 'publishing'::"text", 'published'::"text"
    ]))),
    CONSTRAINT "outbox_events_event_version_check" CHECK (("event_version" >= 1)),
    CONSTRAINT "outbox_events_publish_attempts_check" CHECK (("publish_attempts" >= 0)),

    -- A published row must record when, and must never carry a live claim.
    CONSTRAINT "outbox_events_published_consistency_check" CHECK (
      (("status" = 'published'::"text") AND ("published_at" IS NOT NULL) AND ("claim_token" IS NULL))
      OR (("status" <> 'published'::"text") AND ("published_at" IS NULL))
    ),

    -- Bounded payload: an outbox row carries identifiers and small facts,
    -- never media, never a raw provider response. 64KB is a technical
    -- ceiling to keep the table and Kafka messages sane, not a business rule.
    CONSTRAINT "outbox_events_payload_size_check" CHECK (("pg_column_size"("payload") <= 65536))
);

ALTER TABLE "public"."outbox_events" OWNER TO "postgres";

-- The publisher's only hot query: oldest pending rows first.
CREATE INDEX IF NOT EXISTS "outbox_events_pending_idx"
  ON "public"."outbox_events" ("created_at")
  WHERE ("status" <> 'published'::"text");

-- Stale-claim recovery scan.
CREATE INDEX IF NOT EXISTS "outbox_events_claimed_at_idx"
  ON "public"."outbox_events" ("claimed_at")
  WHERE ("status" = 'publishing'::"text");


-- ---------------------------------------------------------------------------
-- IMMUTABILITY OF A PUBLISHED EVENT
-- ---------------------------------------------------------------------------
-- A published event must never silently become pending again — that would
-- republish a fact consumers already acted on, with no record of why. The
-- trigger below refuses that specific transition outright. (Rows may still
-- be deleted by a future retention/archival job; this guards against
-- accidental status regression, not against deliberate cleanup.)
CREATE OR REPLACE FUNCTION "public"."outbox_events_no_unpublish"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF OLD.status = 'published' AND NEW.status <> 'published' THEN
    RAISE EXCEPTION 'outbox_events: a published event cannot return to %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."outbox_events_no_unpublish"() OWNER TO "postgres";

DROP TRIGGER IF EXISTS "outbox_events_no_unpublish_trg" ON "public"."outbox_events";
CREATE TRIGGER "outbox_events_no_unpublish_trg"
  BEFORE UPDATE ON "public"."outbox_events"
  FOR EACH ROW EXECUTE FUNCTION "public"."outbox_events_no_unpublish"();


-- ---------------------------------------------------------------------------
-- emit_outbox_event() — THE TRANSACTIONAL BOUNDARY
-- ---------------------------------------------------------------------------
-- CALL THIS FROM INSIDE another PL/pgSQL function that is performing a
-- business mutation. Because a PL/pgSQL function body executes in one
-- implicit transaction, the caller's business writes and this insert commit
-- together or roll back together. Calling it as a standalone RPC from
-- TypeScript still works, but then it is only an insert — the transactional
-- guarantee comes from being inside the caller's transaction, not from this
-- function itself.
CREATE OR REPLACE FUNCTION "public"."emit_outbox_event"(
    "p_event_type" "text",
    "p_event_version" integer,
    "p_aggregate_type" "text",
    "p_aggregate_id" "text",
    "p_payload" "jsonb",
    "p_trace_id" "text" DEFAULT NULL,
    "p_event_id" "uuid" DEFAULT NULL,
    "p_occurred_at" timestamp with time zone DEFAULT NULL
) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_event_id uuid;
BEGIN
  IF p_event_type IS NULL OR "char_length"(p_event_type) = 0 THEN
    RAISE EXCEPTION 'invalid_event_type' USING ERRCODE = '22023';
  END IF;
  IF p_aggregate_id IS NULL OR "char_length"(p_aggregate_id) = 0 THEN
    RAISE EXCEPTION 'invalid_aggregate_id' USING ERRCODE = '22023';
  END IF;

  -- Caller may supply the event id so the SAME identity survives an
  -- application-level retry; otherwise one is generated server-side.
  v_event_id := COALESCE(p_event_id, gen_random_uuid());

  INSERT INTO outbox_events
    (event_id, event_type, event_version, aggregate_type, aggregate_id,
     trace_id, payload, occurred_at)
  VALUES
    (v_event_id, p_event_type, p_event_version, p_aggregate_type, p_aggregate_id,
     p_trace_id, COALESCE(p_payload, '{}'::jsonb), COALESCE(p_occurred_at, now()));

  RETURN v_event_id;
END;
$$;

ALTER FUNCTION "public"."emit_outbox_event"("text", integer, "text", "text", "jsonb", "text", "uuid", timestamp with time zone) OWNER TO "postgres";


-- ---------------------------------------------------------------------------
-- claim_outbox_events() — ATOMIC, NON-OVERLAPPING BATCH CLAIM
-- ---------------------------------------------------------------------------
-- Multiple publishers may run concurrently. SELECT-then-UPDATE would let two
-- of them read the same pending rows and both publish them. `FOR UPDATE SKIP
-- LOCKED` inside this function's single transaction is what makes the claim
-- exclusive: the second publisher's SELECT skips rows the first has locked
-- and takes different ones. No row is ever owned by two active publishers.
--
-- STALE CLAIM RECOVERY: a row stuck in 'publishing' past p_lease_seconds is
-- reclaimable — a publisher that crashed mid-batch cannot strand its events.
-- Recovery relies on that bounded lease, not on the crashed process ever
-- coming back.
CREATE OR REPLACE FUNCTION "public"."claim_outbox_events"(
    "p_limit" integer DEFAULT 100,
    "p_lease_seconds" integer DEFAULT 300
) RETURNS TABLE (
    "event_id" "uuid",
    "event_type" "text",
    "event_version" integer,
    "aggregate_type" "text",
    "aggregate_id" "text",
    "trace_id" "text",
    "payload" "jsonb",
    "occurred_at" timestamp with time zone,
    "publish_attempts" integer,
    "claim_token" "uuid"
)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_claim_token uuid := gen_random_uuid();
  v_cutoff timestamp with time zone := now() - make_interval(secs => p_lease_seconds);
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'invalid_limit' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH claimed AS (
    SELECT o.id
    FROM outbox_events o
    WHERE o.status = 'pending'
       OR (o.status = 'publishing' AND o.claimed_at < v_cutoff)
    ORDER BY o.created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE outbox_events e
  SET status = 'publishing',
      claim_token = v_claim_token,
      claimed_at = now(),
      publish_attempts = e.publish_attempts + 1
  FROM claimed c
  WHERE e.id = c.id
  RETURNING e.event_id, e.event_type, e.event_version, e.aggregate_type,
            e.aggregate_id, e.trace_id, e.payload, e.occurred_at,
            e.publish_attempts, e.claim_token;
END;
$$;

ALTER FUNCTION "public"."claim_outbox_events"(integer, integer) OWNER TO "postgres";


-- ---------------------------------------------------------------------------
-- mark_outbox_event_published() / mark_outbox_event_failed()
-- ---------------------------------------------------------------------------
-- Both are claim-token-verified: only the publisher that currently holds the
-- claim may resolve the row. A stale publisher whose lease already expired
-- and was reclaimed by another cannot overwrite the new owner's work — the
-- same ownership-token discipline the Redis distributed lock and the
-- idempotency store already use.
CREATE OR REPLACE FUNCTION "public"."mark_outbox_event_published"(
    "p_event_id" "uuid",
    "p_claim_token" "uuid"
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE outbox_events
  SET status = 'published',
      published_at = now(),
      claim_token = NULL,
      claimed_at = NULL,
      last_error_code = NULL
  WHERE event_id = p_event_id
    AND claim_token = p_claim_token
    AND status = 'publishing';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

ALTER FUNCTION "public"."mark_outbox_event_published"("uuid", "uuid") OWNER TO "postgres";

-- Publish failed: the row returns to 'pending' so it is retried. It is NEVER
-- dropped and never marked published — Kafka being unavailable must leave
-- the durable event intact, which is the entire point of the outbox.
CREATE OR REPLACE FUNCTION "public"."mark_outbox_event_failed"(
    "p_event_id" "uuid",
    "p_claim_token" "uuid",
    "p_error_code" "text" DEFAULT NULL
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE outbox_events
  SET status = 'pending',
      claim_token = NULL,
      claimed_at = NULL,
      last_error_code = p_error_code
  WHERE event_id = p_event_id
    AND claim_token = p_claim_token
    AND status = 'publishing';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

ALTER FUNCTION "public"."mark_outbox_event_failed"("uuid", "uuid", "text") OWNER TO "postgres";


-- ---------------------------------------------------------------------------
-- ZERO-COST TRANSACTION PROOF HELPERS
-- ---------------------------------------------------------------------------
-- These exist so the same-transaction invariant can be PROVEN against a real
-- PostgreSQL instance rather than asserted in a comment. They touch only a
-- dedicated scratch table, never a real business table.
--
-- outbox_tx_proof is the synthetic "business state" — deliberately separate
-- from generations/credits so a proof run can never affect real data.
CREATE TABLE IF NOT EXISTS "public"."outbox_tx_proof" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "label" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "outbox_tx_proof_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "public"."outbox_tx_proof" OWNER TO "postgres";
ALTER TABLE "public"."outbox_tx_proof" ENABLE ROW LEVEL SECURITY;

-- Mutates synthetic business state AND emits an outbox event in ONE function
-- body = one transaction. `p_fail_after_outbox` forces an exception AFTER
-- both writes, proving they roll back together rather than leaving a
-- half-applied state.
CREATE OR REPLACE FUNCTION "public"."outbox_tx_proof_run"(
    "p_label" "text",
    "p_fail_after_outbox" boolean DEFAULT false,
    "p_fail_before_outbox" boolean DEFAULT false
) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_event_id uuid;
BEGIN
  INSERT INTO outbox_tx_proof (label) VALUES (p_label);

  IF p_fail_before_outbox THEN
    RAISE EXCEPTION 'forced_failure_before_outbox' USING ERRCODE = 'P0001';
  END IF;

  v_event_id := emit_outbox_event(
    'proof.executed', 1, 'outbox_tx_proof', p_label,
    jsonb_build_object('label', p_label), NULL, NULL, NULL
  );

  IF p_fail_after_outbox THEN
    RAISE EXCEPTION 'forced_failure_after_outbox' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_event_id;
END;
$$;

ALTER FUNCTION "public"."outbox_tx_proof_run"("text", boolean, boolean) OWNER TO "postgres";


-- ---------------------------------------------------------------------------
-- RLS AND GRANTS — SERVER-ONLY
-- ---------------------------------------------------------------------------
-- The browser must never create a trusted domain event. RLS is enabled with
-- NO policy for `authenticated`, exactly like generation_attempts and
-- credit_reservations, so only service_role can touch this table, and every
-- function's EXECUTE is revoked from the browser roles.
ALTER TABLE "public"."outbox_events" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."outbox_events" TO "service_role";
GRANT ALL ON TABLE "public"."outbox_tx_proof" TO "service_role";

REVOKE ALL ON FUNCTION "public"."emit_outbox_event"("text", integer, "text", "text", "jsonb", "text", "uuid", timestamp with time zone) FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."claim_outbox_events"(integer, integer) FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."mark_outbox_event_published"("uuid", "uuid") FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."mark_outbox_event_failed"("uuid", "uuid", "text") FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."outbox_tx_proof_run"("text", boolean, boolean) FROM PUBLIC, "anon", "authenticated";

GRANT EXECUTE ON FUNCTION "public"."emit_outbox_event"("text", integer, "text", "text", "jsonb", "text", "uuid", timestamp with time zone) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."claim_outbox_events"(integer, integer) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."mark_outbox_event_published"("uuid", "uuid") TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."mark_outbox_event_failed"("uuid", "uuid", "text") TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."outbox_tx_proof_run"("text", boolean, boolean) TO "service_role";
