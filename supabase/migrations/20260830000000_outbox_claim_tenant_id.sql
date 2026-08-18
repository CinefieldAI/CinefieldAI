-- ===========================================================================
-- PHASE 20 CORRECTIVE BATCH — surface outbox_events.tenant_id through claim
-- ===========================================================================
-- `20260824000000_event_contract_and_tenant_routing.sql` added
-- `outbox_events.tenant_id`, captured automatically inside `emit_outbox_event`
-- from the aggregate at write time (see that migration's own header for why a
-- caller-supplied `p_tenant_id` parameter was tried once and reverted: two
-- ways to supply a tenant means two ways to supply the wrong one). The COLUMN
-- has existed since that migration; this one closes the gap the Phase 20
-- closure audit found — `claim_outbox_events()` never SELECTed it, so the
-- captured tenant never reached the TypeScript layer, and from there never
-- reached the Kafka-bound `DomainEventEnvelope`, even though the roadmap's
-- own envelope standard names a tenant/workspace field explicitly.
--
-- ---------------------------------------------------------------------------
-- WHY DROP + CREATE, NOT CREATE OR REPLACE
-- ---------------------------------------------------------------------------
-- PostgreSQL's CREATE OR REPLACE FUNCTION refuses to change a function's
-- OUT-parameter set (which is what RETURNS TABLE desugars to) — adding
-- `tenant_id` as a new output column is exactly that kind of change. The
-- function's INPUT signature (`p_limit integer, p_lease_seconds integer`) is
-- untouched, so this is not the "different arity, silent overload" hazard
-- `emit_outbox_event`'s history warns about — it is a same-signature,
-- output-only widening, which is why DROP immediately followed by CREATE
-- (not REPLACE) is required and safe here specifically.
--
-- ---------------------------------------------------------------------------
-- BACKWARD COMPATIBLE FOR EVERY EXISTING CALLER
-- ---------------------------------------------------------------------------
-- Every caller reads this RPC's rows as JSON objects keyed by column name
-- (`src/lib/events/outbox-repository.ts`'s `row.event_id`, `row.trace_id`,
-- etc. — never positional/array access), so an ADDITIONAL named column is
-- invisible to any caller that does not ask for it. No existing row shape
-- narrows, no existing column is renamed or removed, no existing grant
-- changes — ownership and EXECUTE privilege are re-stated identically to the
-- original migration, not altered.
-- ===========================================================================

DROP FUNCTION IF EXISTS "public"."claim_outbox_events"(integer, integer);

CREATE FUNCTION "public"."claim_outbox_events"(
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
    "tenant_id" "text",
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
            e.tenant_id, e.publish_attempts, e.claim_token;
END;
$$;

ALTER FUNCTION "public"."claim_outbox_events"(integer, integer) OWNER TO "postgres";

-- Re-stated identically to 20260812130000_outbox_events.sql — DROP removed
-- the prior grants, so they are not merely preserved here, they are restored.
REVOKE ALL ON FUNCTION "public"."claim_outbox_events"(integer, integer) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."claim_outbox_events"(integer, integer) TO "service_role";

COMMENT ON FUNCTION "public"."claim_outbox_events"(integer, integer) IS
  'Phase 6R.9, extended Phase 20 corrective batch: atomic batch claim of pending outbox rows, now surfacing tenant_id (captured once, at write time, inside emit_outbox_event) so publishers can carry it onto the wire envelope. FOR UPDATE SKIP LOCKED + a bounded claim lease, unchanged from the original.';
