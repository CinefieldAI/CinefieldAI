-- ===========================================================================
-- cancel_generation_tx() — stop discarding the reason it validates
-- ===========================================================================
-- THE DEFECT
-- The function has taken `p_reason` since 20260813 and validates it strictly
-- (`^[a-z][a-z0-9_]{1,64}$`, deliberately a CODE and never a message). It then
-- throws it away. It appears nowhere in the row it updates, and the
-- generation.cancelled event schema is `additionalProperties: false` with only
-- generationId and provider — so the value cannot travel there either.
--
-- Callers already pass one: status-manager.ts forwards `options.reason` in
-- good faith. Every cancellation in the database therefore looks identical,
-- whether a user pressed stop, a workflow gave up, or an operator retired a
-- stale record administratively.
--
-- WHY IT MATTERS NOW
-- Retiring the 91 historical queued generations means writing 91 terminal
-- states that nobody can later distinguish from user cancellations. An audit
-- trail that cannot answer "who cancelled this and why" is not an audit trail.
--
-- THE FIX
-- One key in the object the function ALREADY builds. No new column, no new
-- status, no event-schema change, no behaviour change for callers that pass
-- nothing — `jsonb_strip_nulls` removes the key when the reason is NULL, so
-- rows cancelled without a reason are byte-identical to before.
--
-- The value is safe to persist precisely because the existing validation is
-- strict: a short lowercase code, never free text, never anything a user
-- typed, never a provider payload.
-- ===========================================================================

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
  -- anything a user typed: this value is copied into a retained event AND now
  -- onto the row itself.
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
                            || jsonb_strip_nulls(jsonb_build_object(
                                 'stage', 'cancelled',
                                 'updatedAt', to_char(now() AT TIME ZONE 'UTC',
                                                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                                 -- THE FIX. Stripped when NULL, so a
                                 -- reasonless cancel is unchanged.
                                 'cancelReason', p_reason
                               )),
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
  'Phase 6R-E/6R-H. Cancels a generation and records generation.cancelled in the outbox within ONE transaction. Returns {applied, status, event_id}. The validated reason CODE is persisted at metadata.orchestration.cancelReason — it was previously validated and then discarded, leaving every cancellation indistinguishable from every other.';
