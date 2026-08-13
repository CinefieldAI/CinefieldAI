-- ===========================================================================
-- WORKFLOW START RELIABILITY — closing the DB→Temporal dual-write gap (M6)
-- ===========================================================================
-- THE BUG THIS CLOSES
-- `POST /api/generate` commits the generation row and THEN starts Temporal,
-- as two separate operations. Its own comment called the result "a durable,
-- recoverable generation" — but nothing recovered it. A crash, a redeploy or
-- a Temporal outage between the commit and the start left a row in `queued`
-- that no worker would ever pick up, forever. Once Phase 10 reserves credit
-- inside that same transaction, the stranded row takes an open reservation
-- with it.
--
-- WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT
-- The intent to start a workflow becomes durable, written in the SAME
-- transaction as the generation. Delivery of that intent becomes a retryable
-- job. Nothing else moves: Temporal is still the only lifecycle owner, the
-- relay may ONLY call workflow start, and it can neither submit provider work
-- nor touch billing. This is a delivery guarantee, not a second owner.
--
-- WHY A DEDICATED TABLE RATHER THAN outbox_events
-- `outbox_events` is owned by the Kafka publisher lane, and
-- `claim_outbox_events()` claims every pending row regardless of event_type.
-- Putting start intents there would hand them to a publisher that would try
-- to publish them as domain events. Two different consumers, two different
-- resolution vocabularies ("published" vs "started"), and this one needs
-- `available_at` for backoff, which the event outbox has no notion of. The
-- claim discipline below is copied from it deliberately — same lease, same
-- token verification, same SKIP LOCKED — so there is one pattern to reason
-- about, not two.
--
-- IDEMPOTENCY IS ALREADY SOLVED UPSTREAM
-- `generationWorkflowId()` derives the id from the generation id, and the
-- starter passes WorkflowIdConflictPolicy.USE_EXISTING. So a duplicate
-- delivery cannot open a second workflow — Temporal refuses it at the server.
-- That is what makes an at-least-once relay safe here: the unsafe direction
-- (never starting) is the one this table removes, and the "safe" direction
-- (starting twice) is already impossible.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- workflow_start_outbox
-- ---------------------------------------------------------------------------
-- One row per generation, ever. The UNIQUE on generation_id is the guard that
-- makes an idempotent create-replay unable to produce a second intent, and it
-- is why the relay cannot fan one generation out into two workflows.
CREATE TABLE IF NOT EXISTS "public"."workflow_start_outbox" (
    "generation_id" "uuid" NOT NULL
      REFERENCES "public"."generations"("id") ON DELETE CASCADE,

    -- Stored rather than re-derived, so an operator reading this table sees
    -- exactly which workflow id was intended, even if the derivation ever
    -- changes. The relay still derives it independently and would refuse a
    -- mismatch.
    "workflow_id" "text" NOT NULL,

    -- The owner the workflow runs for. Needed to start; carries no secret.
    "clerk_user_id" "text" NOT NULL,

    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,

    -- Backoff. A Temporal outage should not be retried in a tight loop.
    "available_at" timestamp with time zone DEFAULT "now"() NOT NULL,

    -- Claim lease, same shape as outbox_events: a crashed relay's rows become
    -- reclaimable after the lease elapses instead of being stranded.
    "claim_token" "uuid",
    "claimed_at" timestamp with time zone,

    "delivered_at" timestamp with time zone,
    "last_error_code" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,

    CONSTRAINT "workflow_start_outbox_pkey" PRIMARY KEY ("generation_id"),

    CONSTRAINT "workflow_start_outbox_status_check" CHECK (("status" = ANY (ARRAY[
      'pending'::"text", 'starting'::"text", 'delivered'::"text"
    ]))),
    CONSTRAINT "workflow_start_outbox_attempts_check" CHECK (("attempts" >= 0)),

    -- A delivered row records when, and never holds a live claim.
    CONSTRAINT "workflow_start_outbox_delivered_consistency_check" CHECK (
      (("status" = 'delivered'::"text") AND ("delivered_at" IS NOT NULL) AND ("claim_token" IS NULL))
      OR (("status" <> 'delivered'::"text") AND ("delivered_at" IS NULL))
    ),

    CONSTRAINT "workflow_start_outbox_workflow_id_check" CHECK (
      ("char_length"("workflow_id") > 0) AND ("char_length"("workflow_id") <= 200)
    )
);

ALTER TABLE "public"."workflow_start_outbox" OWNER TO "postgres";

-- The relay's only query: undelivered work that is due. Partial, so the index
-- does not grow with the delivered history.
CREATE INDEX IF NOT EXISTS "workflow_start_outbox_due_idx"
  ON "public"."workflow_start_outbox" ("available_at")
  WHERE ("status" <> 'delivered'::"text");


-- ---------------------------------------------------------------------------
-- Access control — server-only, no exceptions
-- ---------------------------------------------------------------------------
-- RLS on with NO permissive policy: a browser can neither read nor write a
-- start intent. Creating one is not something a client may do — it is a
-- consequence of create_generation_tx() succeeding, nothing else.
ALTER TABLE "public"."workflow_start_outbox" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."workflow_start_outbox" FROM "anon";
REVOKE ALL ON TABLE "public"."workflow_start_outbox" FROM "authenticated";
GRANT SELECT, INSERT, UPDATE ON TABLE "public"."workflow_start_outbox" TO "service_role";


-- ---------------------------------------------------------------------------
-- create_generation_tx() — now writes the start intent in the same transaction
-- ---------------------------------------------------------------------------
-- Identical to 20260816000000 except for the single INSERT marked below.
-- Replacing the function rather than adding a trigger keeps the atomicity
-- visible at the call site: whoever reads this function sees that a generation
-- and its start intent are one write.
--
-- The replay paths return WITHOUT inserting an intent. That is deliberate: an
-- idempotent replay resolves to a generation that already has one, and a
-- second intent for the same generation is exactly what the primary key
-- forbids.
CREATE OR REPLACE FUNCTION "public"."create_generation_tx"(
    "p_clerk_user_id" "text",
    "p_project_id" "uuid",
    "p_generation_type" "text",
    "p_provider" "text",
    "p_model" "text",
    "p_prompt" "text",
    "p_metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "p_input_url" "text" DEFAULT NULL,
    "p_negative_prompt" "text" DEFAULT NULL,
    "p_idempotency_key" "text" DEFAULT NULL,
    "p_request_hash" "text" DEFAULT NULL
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_existing generations%ROWTYPE;
  v_id       uuid;
  v_owner    text;
BEGIN
  IF p_clerk_user_id IS NULL OR "char_length"(p_clerk_user_id) = 0 THEN
    RAISE EXCEPTION 'invalid_owner' USING ERRCODE = '22023';
  END IF;

  SELECT clerk_user_id INTO v_owner FROM projects WHERE id = p_project_id;
  IF NOT FOUND OR v_owner IS DISTINCT FROM p_clerk_user_id THEN
    RAISE EXCEPTION 'project_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
      FROM generations
     WHERE clerk_user_id = p_clerk_user_id
       AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'generation_id', v_existing.id,
        'created',       false,
        'request_hash',  v_existing.request_hash,
        'status',        v_existing.status
      );
    END IF;
  END IF;

  INSERT INTO generations
    (project_id, clerk_user_id, generation_type, provider, model, prompt,
     negative_prompt, input_url, metadata, idempotency_key, request_hash)
  VALUES
    (p_project_id, p_clerk_user_id, p_generation_type, p_provider, p_model, p_prompt,
     p_negative_prompt, p_input_url, COALESCE(p_metadata, '{}'::jsonb),
     p_idempotency_key, p_request_hash)
  RETURNING id INTO v_id;

  -- ---- THE FIX (M6) ------------------------------------------------------
  -- Same transaction as the row above. Either both exist or neither does, so
  -- "committed" and "someone is obliged to start this" become the same fact.
  -- The workflow id mirrors generationWorkflowId() in
  -- src/lib/temporal/workflow-ids.ts; the relay re-derives it and refuses a
  -- row whose stored id disagrees.
  INSERT INTO workflow_start_outbox (generation_id, workflow_id, clerk_user_id)
  VALUES (v_id, 'gen:' || v_id::text, p_clerk_user_id);

  RETURN jsonb_build_object(
    'generation_id', v_id,
    'created',       true,
    'request_hash',  p_request_hash,
    'status',        'queued'
  );

EXCEPTION
  WHEN unique_violation THEN
    SELECT * INTO v_existing
      FROM generations
     WHERE clerk_user_id = p_clerk_user_id
       AND idempotency_key = p_idempotency_key;

    RETURN jsonb_build_object(
      'generation_id', v_existing.id,
      'created',       false,
      'request_hash',  v_existing.request_hash,
      'status',        v_existing.status
    );
END;
$$;

ALTER FUNCTION "public"."create_generation_tx"("text", "uuid", "text", "text", "text", "text", "jsonb", "text", "text", "text", "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."create_generation_tx"("text", "uuid", "text", "text", "text", "text", "jsonb", "text", "text", "text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."create_generation_tx"("text", "uuid", "text", "text", "text", "text", "jsonb", "text", "text", "text", "text") FROM "anon";
REVOKE ALL ON FUNCTION "public"."create_generation_tx"("text", "uuid", "text", "text", "text", "text", "jsonb", "text", "text", "text", "text") FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."create_generation_tx"("text", "uuid", "text", "text", "text", "text", "jsonb", "text", "text", "text", "text") TO "service_role";


-- ---------------------------------------------------------------------------
-- Backfill — generations that predate this table
-- ---------------------------------------------------------------------------
-- Only rows still in a pre-terminal state get an intent: a generation that
-- already completed or failed has nothing left to start, and manufacturing an
-- intent for it would make the relay open a workflow for finished work.
INSERT INTO "public"."workflow_start_outbox" ("generation_id", "workflow_id", "clerk_user_id", "status", "delivered_at")
SELECT g."id", 'gen:' || g."id"::text, g."clerk_user_id", 'delivered', "now"()
FROM "public"."generations" g
WHERE g."status" IN ('completed', 'failed', 'cancelled')
ON CONFLICT ("generation_id") DO NOTHING;

INSERT INTO "public"."workflow_start_outbox" ("generation_id", "workflow_id", "clerk_user_id")
SELECT g."id", 'gen:' || g."id"::text, g."clerk_user_id"
FROM "public"."generations" g
WHERE g."status" NOT IN ('completed', 'failed', 'cancelled')
ON CONFLICT ("generation_id") DO NOTHING;


-- ---------------------------------------------------------------------------
-- claim_workflow_start_intents()
-- ---------------------------------------------------------------------------
-- SKIP LOCKED + lease, the same discipline claim_outbox_events() uses. Two
-- relays running concurrently take disjoint sets; a relay that dies mid-batch
-- leaves rows that become claimable again once the lease elapses.
CREATE OR REPLACE FUNCTION "public"."claim_workflow_start_intents"(
    "p_limit" integer DEFAULT 50,
    "p_lease_seconds" integer DEFAULT 120
) RETURNS TABLE (
    "generation_id" "uuid",
    "workflow_id" "text",
    "clerk_user_id" "text",
    "attempts" integer,
    "claim_token" "uuid"
)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_claim_token uuid := gen_random_uuid();
  v_cutoff timestamp with time zone := now() - make_interval(secs => p_lease_seconds);
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'invalid_limit' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH claimed AS (
    SELECT w.generation_id
    FROM workflow_start_outbox w
    WHERE w.available_at <= now()
      AND (w.status = 'pending'
           OR (w.status = 'starting' AND w.claimed_at < v_cutoff))
    ORDER BY w.created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE workflow_start_outbox o
  SET status = 'starting',
      claim_token = v_claim_token,
      claimed_at = now(),
      attempts = o.attempts + 1
  FROM claimed c
  WHERE o.generation_id = c.generation_id
  RETURNING o.generation_id, o.workflow_id, o.clerk_user_id, o.attempts, o.claim_token;
END;
$$;

ALTER FUNCTION "public"."claim_workflow_start_intents"(integer, integer) OWNER TO "postgres";


-- ---------------------------------------------------------------------------
-- mark_workflow_start_delivered() / mark_workflow_start_failed()
-- ---------------------------------------------------------------------------
-- Claim-token verified, exactly like the event outbox: a relay whose lease
-- expired and was reclaimed by another cannot overwrite the new owner's work.
CREATE OR REPLACE FUNCTION "public"."mark_workflow_start_delivered"(
    "p_generation_id" "uuid",
    "p_claim_token" "uuid"
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE workflow_start_outbox
  SET status = 'delivered',
      delivered_at = now(),
      claim_token = NULL,
      claimed_at = NULL,
      last_error_code = NULL
  WHERE generation_id = p_generation_id
    AND claim_token = p_claim_token
    AND status = 'starting';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

ALTER FUNCTION "public"."mark_workflow_start_delivered"("uuid", "uuid") OWNER TO "postgres";


-- Returns the row to pending with backoff. Never terminal: a start that
-- cannot be delivered stays owed, because the alternative is the stuck
-- generation this migration exists to prevent.
CREATE OR REPLACE FUNCTION "public"."mark_workflow_start_failed"(
    "p_generation_id" "uuid",
    "p_claim_token" "uuid",
    "p_error_code" "text" DEFAULT NULL,
    "p_retry_delay_seconds" integer DEFAULT 30
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_retry_delay_seconds IS NULL OR p_retry_delay_seconds < 0 OR p_retry_delay_seconds > 86400 THEN
    RAISE EXCEPTION 'invalid_retry_delay' USING ERRCODE = '22023';
  END IF;

  UPDATE workflow_start_outbox
  SET status = 'pending',
      claim_token = NULL,
      claimed_at = NULL,
      available_at = now() + make_interval(secs => p_retry_delay_seconds),
      last_error_code = p_error_code
  WHERE generation_id = p_generation_id
    AND claim_token = p_claim_token
    AND status = 'starting';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

ALTER FUNCTION "public"."mark_workflow_start_failed"("uuid", "uuid", "text", integer) OWNER TO "postgres";


-- ---------------------------------------------------------------------------
-- Function grants — service_role only
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION "public"."claim_workflow_start_intents"(integer, integer) FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."mark_workflow_start_delivered"("uuid", "uuid") FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."mark_workflow_start_failed"("uuid", "uuid", "text", integer) FROM PUBLIC, "anon", "authenticated";

GRANT EXECUTE ON FUNCTION "public"."claim_workflow_start_intents"(integer, integer) TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."mark_workflow_start_delivered"("uuid", "uuid") TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."mark_workflow_start_failed"("uuid", "uuid", "text", integer) TO "service_role";


COMMENT ON TABLE "public"."workflow_start_outbox" IS
  'M6. Durable intent to start ONE Temporal workflow, written in the same transaction as its generation. Delivery only — Temporal remains the sole generation lifecycle owner. Server-only; RLS enabled with no permissive policy.';
