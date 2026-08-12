-- Cinefield — corrective migration: cancel_generation_tx dropped its stage
-- marker on a generation with no prior orchestration metadata.
--
-- THE DEFECT
-- 20260813000000_cancellation_outbox.sql wrote the marker with
--
--   jsonb_set(COALESCE(metadata,'{}'), '{orchestration,stage}', '"cancelled"', true)
--
-- and `create_missing => true` does NOT create intermediate objects. Given
-- metadata = '{}' — which is the DEFAULT for the generations table, and so
-- the state of every generation cancelled before it ever reached the
-- orchestrator — PostgreSQL returns '{}' unchanged. The write silently did
-- nothing:
--
--   SELECT jsonb_set('{}'::jsonb, '{orchestration,stage}', '"cancelled"', true);
--   -- {}
--   SELECT jsonb_set('{}'::jsonb, '{orchestration}', '{"stage":"cancelled"}', true);
--   -- {"orchestration": {"stage": "cancelled"}}
--
-- BLAST RADIUS, HONESTLY
-- Small but real. `status`, `completed_at` and the outbox event are separate
-- SET expressions and were always written correctly, so no generation was
-- ever wrongly left uncancelled and no event was lost. What went missing was
-- the `orchestration.stage` marker on cancellations of not-yet-started
-- generations — which is exactly the audit breadcrumb an operator reads when
-- asking why a row is cancelled. A cosmetic field, on the path where it is
-- most likely to be consulted.
--
-- It was found by a concurrency test, not by review: six racing cancels all
-- reported success because each one's guard read a marker the previous write
-- had failed to leave behind. The one-level merge below is the same shape
-- 20260814000000_finalization_outbox.sql already uses, which is why
-- complete/fail were never affected.
--
-- Historical migrations are not rewritten. This replaces the function.

CREATE OR REPLACE FUNCTION "public"."cancel_generation_tx"(
    "p_generation_id" "uuid",
    "p_reason" "text" DEFAULT NULL,
    "p_trace_id" "text" DEFAULT NULL,
    "p_event_id" "uuid" DEFAULT NULL
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_row      generations%ROWTYPE;
  v_current  text;
  v_event_id uuid;
BEGIN
  IF p_generation_id IS NULL THEN
    RAISE EXCEPTION 'invalid_generation_id' USING ERRCODE = '22023';
  END IF;

  -- A short, safe reason CODE only. Never a message, a provider payload, or
  -- anything a user typed: this value is copied into a retained event.
  IF p_reason IS NOT NULL AND p_reason !~ '^[a-z][a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = '22023';
  END IF;

  UPDATE generations
     SET status       = 'cancelled',
         completed_at = now(),
         -- One-level path, then merge into whatever orchestration already
         -- holds. Creates the object when it is absent, and preserves every
         -- existing key — including the providerJob record the async path
         -- maintains — when it is not.
         metadata     = jsonb_set(
                          COALESCE(metadata, '{}'::jsonb),
                          '{orchestration}',
                          COALESCE(metadata -> 'orchestration', '{}'::jsonb)
                            || jsonb_build_object(
                                 'stage', 'cancelled',
                                 'updatedAt', to_char(now() AT TIME ZONE 'UTC',
                                                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                               ),
                          true
                        )
   WHERE id = p_generation_id
     AND status IN ('queued', 'processing')
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    SELECT status INTO v_current FROM generations WHERE id = p_generation_id;
    RETURN jsonb_build_object('applied', false, 'status', v_current, 'event_id', NULL);
  END IF;

  v_event_id := emit_outbox_event(
    'generation.cancelled',
    1,
    'generation',
    p_generation_id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'generationId', p_generation_id::text,
      'provider', v_row.provider
    )),
    p_trace_id,
    p_event_id
  );

  RETURN jsonb_build_object('applied', true, 'status', 'cancelled', 'event_id', v_event_id);
END;
$$;

COMMENT ON FUNCTION "public"."cancel_generation_tx"("uuid", "text", "text", "uuid") IS
  'Phase 6R-E/6R-H. Cancels a generation and records generation.cancelled in the outbox within ONE transaction. Returns {applied, status, event_id}. Metadata is merged one level at a time — jsonb_set does not create intermediate objects, which previously dropped the stage marker on generations with empty metadata.';
