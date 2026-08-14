-- ===========================================================================
-- PHASE 11 CLOSURE — a second, independent delivery lane on the outbox
-- ===========================================================================
-- THE BLOCKER THIS MIGRATION EXISTS TO REMOVE.
--
-- `outbox_events` was built for exactly ONE delivery:
--
--   status ∈ {pending, publishing, published}
--   published_at, claim_token, claimed_at, publish_attempts, last_error_code
--   CONSTRAINT  published <=> published_at IS NOT NULL AND claim_token IS NULL
--   INDEX       ... WHERE status <> 'published'
--
-- One row, one status, one claim. That was correct when Kafka was the only
-- sink. It is now wrong: Phase 11 needs the SAME row delivered to Redis
-- Streams as well, and the two destinations fail independently.
--
-- Overloading the existing columns would produce a silent correctness bug in
-- whichever direction ran first:
--
--   Kafka drains a row -> status = 'published' -> the realtime dispatcher's
--   claim (which reads `status <> 'published'`) can never see it again, and
--   the user never receives the notification.
--
--   Realtime drains it first -> the same row is invisible to Kafka, and a
--   downstream analytics/audit consumer silently loses an event.
--
-- So the lanes are SEPARATED rather than shared. The existing columns keep
-- their exact meaning and become, explicitly, the KAFKA lane; a parallel set
-- of `realtime_*` columns carries the realtime lane with its own claim,
-- attempts, error and completion.
--
-- WHY COLUMNS AND NOT A DELIVERIES TABLE. A generic
-- `outbox_deliveries(event_id, sink, ...)` table would be the textbook answer
-- and is the wrong amount of machinery here: exactly two sinks exist, both are
-- known by name, and a join on the hottest path in the phase buys nothing a
-- second partial index does not already give. When a third sink is genuinely
-- needed — email/push, which the roadmap puts on BullMQ and which is deferred
-- with Redis B — the table can be introduced then, with a real third case to
-- design against instead of an imagined one.
--
-- ADDITIVE ONLY. No column is dropped, no constraint relaxed, no function
-- rewritten. `claim_outbox_events`, `mark_outbox_event_published` and
-- `mark_outbox_event_failed` are untouched and keep serving Kafka exactly as
-- before; every existing proof still describes them accurately.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- The realtime lane
-- ---------------------------------------------------------------------------
-- Mirrors the Kafka lane's shape deliberately. A reader who understands one
-- understands the other, and the ownership discipline — claim token verified
-- on completion — is identical rather than merely similar.
ALTER TABLE "public"."outbox_events"
  ADD COLUMN IF NOT EXISTS "realtime_status" "text" DEFAULT 'pending' NOT NULL,
  ADD COLUMN IF NOT EXISTS "realtime_claim_token" "uuid",
  ADD COLUMN IF NOT EXISTS "realtime_claimed_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "realtime_attempts" integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS "realtime_completed_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "realtime_disposition" "text",
  ADD COLUMN IF NOT EXISTS "realtime_last_error_code" "text";

DO $$
BEGIN
  -- The dispositions are NOT collapsed into success/failure, because they
  -- demand different operational responses:
  --
  --   published        delivered to a stream a browser can read.
  --   not_user_facing  a valid event with no browser projection — asset
  --                    safety, provider internals. TERMINAL: retrying a
  --                    correct decision forever is a busy loop, not
  --                    reliability.
  --   unroutable       no provable tenant. TERMINAL and visible: it means an
  --                    emitter forgot to capture one, or the row predates
  --                    capture. Never broadcast, never guessed at.
  --   invalid          fails the event contract. TERMINAL: redelivering a
  --                    malformed event reproduces it identically forever.
  --   retired          historical debt deliberately disposed of by an
  --                    operator, never delivered. See 20260825000100.
  IF NOT EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'outbox_events_realtime_status_check') THEN
    ALTER TABLE "public"."outbox_events"
      ADD CONSTRAINT "outbox_events_realtime_status_check" CHECK (
        "realtime_status" = ANY (ARRAY['pending'::"text", 'dispatching'::"text", 'done'::"text"])
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'outbox_events_realtime_disposition_check') THEN
    ALTER TABLE "public"."outbox_events"
      ADD CONSTRAINT "outbox_events_realtime_disposition_check" CHECK (
        "realtime_disposition" IS NULL OR "realtime_disposition" = ANY (ARRAY[
          'published'::"text",
          'not_user_facing'::"text",
          'unroutable'::"text",
          'invalid'::"text",
          'retired'::"text"
        ])
      );
  END IF;

  -- A finished row records WHEN and WHAT, and holds no live claim. The same
  -- shape the Kafka lane's constraint enforces, for the same reason: a state
  -- that can be half-written is a state an operator cannot reason about.
  IF NOT EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'outbox_events_realtime_done_check') THEN
    ALTER TABLE "public"."outbox_events"
      ADD CONSTRAINT "outbox_events_realtime_done_check" CHECK (
        ("realtime_status" = 'done'::"text"
           AND "realtime_completed_at" IS NOT NULL
           AND "realtime_disposition" IS NOT NULL
           AND "realtime_claim_token" IS NULL)
        OR ("realtime_status" <> 'done'::"text"
           AND "realtime_completed_at" IS NULL
           AND "realtime_disposition" IS NULL)
      );
  END IF;
END $$;

-- The dispatcher's hot path: unfinished realtime work, oldest first.
CREATE INDEX IF NOT EXISTS "outbox_events_realtime_pending_idx"
  ON "public"."outbox_events" ("created_at")
  WHERE "realtime_status" <> 'done'::"text";

COMMENT ON COLUMN "public"."outbox_events"."realtime_status" IS
  'Realtime (Redis Streams) delivery lane. Independent of status/published_at, which belong to the Kafka lane. One row can be owed to both sinks and completes them separately.';


-- ---------------------------------------------------------------------------
-- claim_realtime_outbox_events()
-- ---------------------------------------------------------------------------
-- Deliberately a mirror of claim_outbox_events, on the realtime columns.
--
-- `FOR UPDATE SKIP LOCKED` is what makes two dispatchers safe: the second
-- one's SELECT skips rows the first has locked and takes different ones. No
-- row is ever owned by two active dispatchers.
--
-- A row whose lease expired is re-claimable, which is the ONLY reason a
-- crashed dispatcher does not strand its batch forever. The lease is time,
-- not a heartbeat: nothing has to be alive for recovery to work.
--
-- `tenant_id` is returned because the Notification Service needs it and a
-- second query per event would put the whole point of the capture back on the
-- hot path.
CREATE OR REPLACE FUNCTION "public"."claim_realtime_outbox_events"(
    "p_limit" integer DEFAULT 100,
    "p_lease_seconds" integer DEFAULT 60
) RETURNS TABLE (
    "event_id" "uuid",
    "event_type" "text",
    "event_version" integer,
    "aggregate_type" "text",
    "aggregate_id" "text",
    "tenant_id" "text",
    "trace_id" "text",
    "payload" "jsonb",
    "occurred_at" timestamp with time zone,
    "realtime_attempts" integer,
    "realtime_claim_token" "uuid"
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
    WHERE o.realtime_status = 'pending'
       OR (o.realtime_status = 'dispatching' AND o.realtime_claimed_at < v_cutoff)
    ORDER BY o.created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE outbox_events e
  SET realtime_status = 'dispatching',
      realtime_claim_token = v_claim_token,
      realtime_claimed_at = now(),
      realtime_attempts = e.realtime_attempts + 1
  FROM claimed c
  WHERE e.id = c.id
  RETURNING e.event_id, e.event_type, e.event_version, e.aggregate_type,
            e.aggregate_id, e.tenant_id, e.trace_id, e.payload, e.occurred_at,
            e.realtime_attempts, e.realtime_claim_token;
END;
$$;

ALTER FUNCTION "public"."claim_realtime_outbox_events"(integer, integer) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."claim_realtime_outbox_events"(integer, integer) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."claim_realtime_outbox_events"(integer, integer) TO "service_role";


-- ---------------------------------------------------------------------------
-- resolve_realtime_outbox_event() — the ONLY way a realtime lane finishes
-- ---------------------------------------------------------------------------
-- CLAIM-TOKEN VERIFIED. Only the dispatcher that currently holds the claim
-- may finish the row. A stale dispatcher whose lease expired and was reclaimed
-- by another cannot overwrite the new owner's work — the same ownership-token
-- discipline the Kafka lane, the Redis distributed lock and the idempotency
-- store already use.
--
-- Returns false rather than raising when the token does not match: losing a
-- lease is a normal outcome under recovery, not an error to alarm on.
CREATE OR REPLACE FUNCTION "public"."resolve_realtime_outbox_event"(
    "p_event_id" "uuid",
    "p_claim_token" "uuid",
    "p_disposition" "text",
    "p_error_code" "text" DEFAULT NULL
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_disposition NOT IN ('published', 'not_user_facing', 'unroutable', 'invalid', 'retired') THEN
    RAISE EXCEPTION 'invalid_disposition' USING ERRCODE = '22023';
  END IF;
  -- Short codes only, never free text and never a driver message.
  IF p_error_code IS NOT NULL AND p_error_code !~ '^[a-z][a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'invalid_error_code' USING ERRCODE = '22023';
  END IF;

  UPDATE outbox_events
     SET realtime_status = 'done',
         realtime_completed_at = now(),
         realtime_disposition = p_disposition,
         realtime_last_error_code = p_error_code,
         realtime_claim_token = NULL
   WHERE event_id = p_event_id
     AND realtime_claim_token = p_claim_token;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

ALTER FUNCTION "public"."resolve_realtime_outbox_event"("uuid", "uuid", "text", "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."resolve_realtime_outbox_event"("uuid", "uuid", "text", "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."resolve_realtime_outbox_event"("uuid", "uuid", "text", "text") TO "service_role";


-- ---------------------------------------------------------------------------
-- release_realtime_outbox_event() — a transport failure, returned for retry
-- ---------------------------------------------------------------------------
-- Distinct from resolving: the row is NOT finished. It goes back to pending
-- with its attempt count already incremented by the claim, so a permanently
-- failing row is visible as a rising number rather than as silence.
--
-- The row is never marked delivered. Redis being unreachable leaves
-- recoverable debt, which is the entire reason the outbox exists.
CREATE OR REPLACE FUNCTION "public"."release_realtime_outbox_event"(
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
  IF p_error_code IS NOT NULL AND p_error_code !~ '^[a-z][a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'invalid_error_code' USING ERRCODE = '22023';
  END IF;

  UPDATE outbox_events
     SET realtime_status = 'pending',
         realtime_claim_token = NULL,
         realtime_claimed_at = NULL,
         realtime_last_error_code = p_error_code
   WHERE event_id = p_event_id
     AND realtime_claim_token = p_claim_token;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

ALTER FUNCTION "public"."release_realtime_outbox_event"("uuid", "uuid", "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."release_realtime_outbox_event"("uuid", "uuid", "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."release_realtime_outbox_event"("uuid", "uuid", "text") TO "service_role";


-- ---------------------------------------------------------------------------
-- realtime_outbox_debt() — the minimum Phase 13 will need
-- ---------------------------------------------------------------------------
-- Counts and ages only. NO payload, NO tenant, NO event id, NO user data —
-- an operational metric that carries a user's content is a data leak with a
-- dashboard in front of it.
--
-- This is not an observability platform; Phase 13 owns that. It is the shape
-- Phase 13 can read without the dispatcher having to grow one.
CREATE OR REPLACE FUNCTION "public"."realtime_outbox_debt"()
RETURNS TABLE (
    "pending" bigint,
    "dispatching" bigint,
    "oldest_pending_seconds" integer,
    "max_attempts" integer,
    "published" bigint,
    "not_user_facing" bigint,
    "unroutable" bigint,
    "invalid" bigint,
    "retired" bigint,
    "with_transport_error" bigint
)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    count(*) FILTER (WHERE realtime_status = 'pending'),
    count(*) FILTER (WHERE realtime_status = 'dispatching'),
    COALESCE(EXTRACT(EPOCH FROM (now() - min(created_at) FILTER (WHERE realtime_status <> 'done')))::integer, 0),
    COALESCE(max(realtime_attempts) FILTER (WHERE realtime_status <> 'done'), 0),
    count(*) FILTER (WHERE realtime_disposition = 'published'),
    count(*) FILTER (WHERE realtime_disposition = 'not_user_facing'),
    count(*) FILTER (WHERE realtime_disposition = 'unroutable'),
    count(*) FILTER (WHERE realtime_disposition = 'invalid'),
    count(*) FILTER (WHERE realtime_disposition = 'retired'),
    count(*) FILTER (WHERE realtime_last_error_code IS NOT NULL AND realtime_status <> 'done')
  FROM outbox_events;
$$;

ALTER FUNCTION "public"."realtime_outbox_debt"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."realtime_outbox_debt"() FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."realtime_outbox_debt"() TO "service_role";
