-- Cinefield Phase 6R-E Gate 0 — transactional COMPLETED / FAILED finalization.
--
-- 6R-E wired cancellation transactionally and explicitly left the hot
-- finalization path alone, on the grounds that it deserved its own reviewed
-- change. This is that change. The two remaining terminal transitions now
-- commit their state and their domain event together, on the same pattern.
--
-- WHAT IS AND IS NOT INSIDE THE TRANSACTION
-- Only durable DB state plus the outbox row. The provider call and the
-- Storage upload stay firmly outside: collectAndFinalize() downloads,
-- normalizes and uploads BEFORE it asks for the terminal transition, and
-- that ordering is deliberate. Holding a PostgreSQL transaction open across
-- an object-storage upload would pin a connection for the length of a
-- network transfer and make a slow upload look like a database problem.
-- The DB transition is a single statement's worth of work; the event belongs
-- with it, and nothing else does.
--
-- METADATA IS MERGED IN PLACE, NOT REPLACED
-- The TypeScript versions rebuilt the whole metadata JSON from the caller's
-- snapshot and wrote it wholesale, which silently discarded anything written
-- concurrently — including the providerJob record the async path maintains.
-- These functions merge only the orchestration keys they own, so a
-- concurrent writer's keys survive. Same observable outcome on the happy
-- path; strictly safer under a race.
--
-- THE PREDICATES ARE UNCHANGED. Both guard on status = 'processing', exactly
-- as markCompleted() and markFailed() always have. A generation that already
-- reached a terminal state loses, and a lost transition emits NO event — an
-- event for a completion that did not happen is indistinguishable downstream
-- from one that did.

-- ---------------------------------------------------------------------------
-- complete_generation_tx()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."complete_generation_tx"(
    "p_generation_id" "uuid",
    "p_output_url" "text",
    "p_provider" "text",
    "p_workflow" "text",
    "p_is_mock" boolean,
    "p_thumbnail_url" "text" DEFAULT NULL,
    "p_duration_ms" integer DEFAULT NULL,
    "p_trace_id" "text" DEFAULT NULL,
    "p_event_id" "uuid" DEFAULT NULL
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_current    text;
  v_attempt_no integer;
  v_event_id   uuid;
BEGIN
  IF p_generation_id IS NULL THEN
    RAISE EXCEPTION 'invalid_generation_id' USING ERRCODE = '22023';
  END IF;
  IF p_output_url IS NULL OR "char_length"(p_output_url) = 0 THEN
    RAISE EXCEPTION 'invalid_output_url' USING ERRCODE = '22023';
  END IF;

  UPDATE generations
     SET status        = 'completed',
         output_url    = p_output_url,
         thumbnail_url = p_thumbnail_url,
         error_message = NULL,
         completed_at  = now(),
         metadata      = jsonb_set(
                           COALESCE(metadata, '{}'::jsonb),
                           '{orchestration}',
                           COALESCE(metadata -> 'orchestration', '{}'::jsonb)
                             || jsonb_build_object(
                                  'stage', 'completed',
                                  'provider', p_provider,
                                  'workflow', p_workflow,
                                  'isMock', p_is_mock,
                                  'updatedAt', to_char(now() AT TIME ZONE 'UTC',
                                                       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                                ),
                           true
                         )
   WHERE id = p_generation_id
     AND status = 'processing';

  IF NOT FOUND THEN
    SELECT status INTO v_current FROM generations WHERE id = p_generation_id;
    RETURN jsonb_build_object('applied', false, 'status', v_current, 'event_id', NULL);
  END IF;

  -- The attempt number is derived here rather than passed in: the
  -- finalization tail is shared by transports that do not all carry an
  -- attempt, and reading it from the durable row is both correct and
  -- impossible to get wrong at a call site. NULL when this generation
  -- predates attempts, and jsonb_strip_nulls then omits it.
  SELECT attempt_no INTO v_attempt_no
    FROM generation_attempts
   WHERE generation_id = p_generation_id
   ORDER BY attempt_no DESC
   LIMIT 1;

  v_event_id := emit_outbox_event(
    'generation.completed',
    1,
    'generation',
    p_generation_id::text,
    -- Matches cinefield.generation.completed. Identifiers and a duration —
    -- deliberately NOT the output path, which is an access-bearing locator
    -- and events are retained and widely read.
    jsonb_strip_nulls(jsonb_build_object(
      'generationId', p_generation_id::text,
      'provider', p_provider,
      'attemptNo', v_attempt_no,
      'durationMs', p_duration_ms
    )),
    p_trace_id,
    p_event_id
  );

  RETURN jsonb_build_object('applied', true, 'status', 'completed', 'event_id', v_event_id);
END;
$$;

ALTER FUNCTION "public"."complete_generation_tx"("uuid", "text", "text", "text", boolean, "text", integer, "text", "uuid") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."complete_generation_tx"("uuid", "text", "text", "text", boolean, "text", integer, "text", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."complete_generation_tx"("uuid", "text", "text", "text", boolean, "text", integer, "text", "uuid") FROM "anon";
REVOKE ALL ON FUNCTION "public"."complete_generation_tx"("uuid", "text", "text", "text", boolean, "text", integer, "text", "uuid") FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."complete_generation_tx"("uuid", "text", "text", "text", boolean, "text", integer, "text", "uuid") TO "service_role";

COMMENT ON FUNCTION "public"."complete_generation_tx"("uuid", "text", "text", "text", boolean, "text", integer, "text", "uuid") IS
  'Phase 6R-E Gate 0. Completes a generation and records generation.completed in the outbox within ONE transaction. Guarded on status=processing; a lost race returns applied=false and emits nothing.';

-- ---------------------------------------------------------------------------
-- fail_generation_tx()
-- ---------------------------------------------------------------------------
-- Mirrors markFailed(), including its most important property: it is guarded
-- on status = 'processing' so a failure raised BECAUSE the row already went
-- terminal cannot drag completed or cancelled back to failed.
--
-- Unlike its TypeScript predecessor this function does NOT swallow its own
-- errors. markFailed() ran inside a catch and stayed silent so it could not
-- mask the original error; that behaviour is preserved at the call site,
-- which is the right place for it — a SQL function that hides a failed write
-- would hide a failed EVENT too, and silently losing the event is exactly
-- what the outbox exists to prevent.
CREATE OR REPLACE FUNCTION "public"."fail_generation_tx"(
    "p_generation_id" "uuid",
    "p_error_message" "text",
    "p_error_code" "text",
    "p_retryable" boolean,
    "p_provider" "text" DEFAULT NULL,
    "p_provider_job" "jsonb" DEFAULT NULL,
    "p_trace_id" "text" DEFAULT NULL,
    "p_event_id" "uuid" DEFAULT NULL
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_current    text;
  v_attempt_no integer;
  v_provider   text;
  v_event_id   uuid;
  v_patch      jsonb;
BEGIN
  IF p_generation_id IS NULL THEN
    RAISE EXCEPTION 'invalid_generation_id' USING ERRCODE = '22023';
  END IF;
  -- A normalized OrchestrationErrorCode. Never a provider message: this value
  -- is copied into a retained event.
  IF p_error_code IS NULL OR p_error_code !~ '^[A-Z][A-Z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'invalid_error_code' USING ERRCODE = '22023';
  END IF;

  v_patch := jsonb_build_object(
    'stage', 'failed',
    'errorCode', p_error_code,
    'retryable', p_retryable,
    'updatedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  -- Only when the caller learned of a job that is not already persisted, so
  -- a richer continuation record is never overwritten by a poorer one.
  IF p_provider_job IS NOT NULL THEN
    v_patch := v_patch || jsonb_build_object('providerJob', p_provider_job);
  END IF;

  UPDATE generations
     SET status        = 'failed',
         error_message = p_error_message,
         completed_at  = now(),
         metadata      = jsonb_set(
                           COALESCE(metadata, '{}'::jsonb),
                           '{orchestration}',
                           COALESCE(metadata -> 'orchestration', '{}'::jsonb) || v_patch,
                           true
                         )
   WHERE id = p_generation_id
     AND status = 'processing'
  RETURNING provider INTO v_provider;

  IF NOT FOUND THEN
    SELECT status INTO v_current FROM generations WHERE id = p_generation_id;
    RETURN jsonb_build_object('applied', false, 'status', v_current, 'event_id', NULL);
  END IF;

  SELECT attempt_no INTO v_attempt_no
    FROM generation_attempts
   WHERE generation_id = p_generation_id
   ORDER BY attempt_no DESC
   LIMIT 1;

  v_event_id := emit_outbox_event(
    'generation.failed',
    1,
    'generation',
    p_generation_id::text,
    -- Matches cinefield.generation.failed. The normalized CODE only — never
    -- p_error_message, which is user-facing prose and can echo request
    -- content back into a retained event.
    jsonb_strip_nulls(jsonb_build_object(
      'generationId', p_generation_id::text,
      'provider', COALESCE(p_provider, v_provider),
      'errorCode', p_error_code,
      'attemptNo', v_attempt_no
    )),
    p_trace_id,
    p_event_id
  );

  RETURN jsonb_build_object('applied', true, 'status', 'failed', 'event_id', v_event_id);
END;
$$;

ALTER FUNCTION "public"."fail_generation_tx"("uuid", "text", "text", boolean, "text", "jsonb", "text", "uuid") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."fail_generation_tx"("uuid", "text", "text", boolean, "text", "jsonb", "text", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."fail_generation_tx"("uuid", "text", "text", boolean, "text", "jsonb", "text", "uuid") FROM "anon";
REVOKE ALL ON FUNCTION "public"."fail_generation_tx"("uuid", "text", "text", boolean, "text", "jsonb", "text", "uuid") FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."fail_generation_tx"("uuid", "text", "text", boolean, "text", "jsonb", "text", "uuid") TO "service_role";

COMMENT ON FUNCTION "public"."fail_generation_tx"("uuid", "text", "text", boolean, "text", "jsonb", "text", "uuid") IS
  'Phase 6R-E Gate 0. Fails a generation and records generation.failed in the outbox within ONE transaction. Guarded on status=processing so a terminal row is never dragged back to failed.';

-- ---------------------------------------------------------------------------
-- finalization_rollback_probe() — test affordance
-- ---------------------------------------------------------------------------
-- Same purpose as outbox_tx_rollback_probe: makes the event insert fail AFTER
-- a successful terminal UPDATE, inside one transaction, so the rollback can
-- be proven for the completion path rather than assumed by analogy with
-- cancellation. Always raises.
CREATE OR REPLACE FUNCTION "public"."finalization_rollback_probe"(
    "p_generation_id" "uuid"
) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE generations
     SET status = 'completed', output_url = 'probe/output.png', completed_at = now()
   WHERE id = p_generation_id
     AND status = 'processing';

  PERFORM emit_outbox_event('', 1, 'generation', p_generation_id::text, '{}'::jsonb);

  RAISE EXCEPTION 'finalization_rollback_probe_unreachable' USING ERRCODE = 'P0001';
END;
$$;

ALTER FUNCTION "public"."finalization_rollback_probe"("uuid") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."finalization_rollback_probe"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."finalization_rollback_probe"("uuid") FROM "anon";
REVOKE ALL ON FUNCTION "public"."finalization_rollback_probe"("uuid") FROM "authenticated";

COMMENT ON FUNCTION "public"."finalization_rollback_probe"("uuid") IS
  'Test affordance (Phase 6R-E Gate 0). Performs a terminal UPDATE then forces the event insert to fail in the same transaction. Always raises.';
