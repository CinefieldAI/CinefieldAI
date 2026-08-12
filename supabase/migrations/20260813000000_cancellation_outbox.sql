-- Cinefield Phase 6R-E/6R-H — transactional cancellation + domain event.
--
-- WHY THIS MIGRATION EXISTS
-- Phase 6R.9 built the outbox (emit_outbox_event, claim_outbox_events) and
-- said plainly that its transactional guarantee comes from being called
-- INSIDE a caller's transaction — but no production mutation ever called it.
-- Everything in the application layer writes through PostgREST, where an
-- UPDATE and an INSERT are two separate HTTP requests and therefore two
-- separate transactions. Doing that and calling it "transactional" would be
-- a lie; the crash between the two calls is exactly the window the outbox
-- pattern exists to close.
--
-- This function is the first real transactional writer. A PL/pgSQL function
-- body is one implicit transaction, so the generation's cancellation and its
-- domain event commit together or not at all. There is no window in which a
-- generation is cancelled but the fact was never recorded, and none in which
-- an event announces a cancellation that did not happen.
--
-- WHY CANCELLATION FIRST
-- It is the transition with the smallest blast radius (no production caller
-- outside the Temporal cancel path), it already has a registered event
-- schema (cinefield.generation.cancelled, Phase 6R.15), and Phase 6R-H needs
-- exactly this atomicity for its own invariant. completed/failed follow the
-- same pattern and are deliberately NOT converted here — they sit on the hot
-- finalization path and deserve their own reviewed change.
--
-- WHAT THIS FUNCTION DOES NOT DO
-- It does not decide whether cancelling is a good idea, does not talk to a
-- provider, does not touch an attempt row, and does not settle credits. It
-- performs one guarded state transition and records that it happened.
-- Lifecycle coordination stays with Temporal; settlement stays with Phase 10.

-- ---------------------------------------------------------------------------
-- cancel_generation_tx()
-- ---------------------------------------------------------------------------
-- Compare-and-set from queued/processing only, mirroring the predicate the
-- application's markCancelled() has always used: a generation that already
-- completed, failed, or was cancelled must LOSE this race rather than be
-- rewritten. Losing is a normal outcome, not an error — it is reported as
-- applied=false with the status that actually won.
--
-- No event is emitted when the transition does not apply. An outbox row for a
-- cancellation that never happened would be indistinguishable, downstream,
-- from one that did.
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
         metadata     = jsonb_set(
                          COALESCE(metadata, '{}'::jsonb),
                          '{orchestration,stage}',
                          '"cancelled"'::jsonb,
                          true
                        )
   WHERE id = p_generation_id
     AND status IN ('queued', 'processing')
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    -- Either the row does not exist, or it already reached a terminal state.
    -- Both are reported truthfully; neither emits an event.
    SELECT status INTO v_current FROM generations WHERE id = p_generation_id;
    RETURN jsonb_build_object(
      'applied', false,
      'status', v_current,
      'event_id', NULL
    );
  END IF;

  -- Same transaction as the UPDATE above. If this raises, the cancellation
  -- is rolled back with it — which is the entire point of the exercise.
  v_event_id := emit_outbox_event(
    'generation.cancelled',
    1,
    'generation',
    p_generation_id::text,
    -- Matches the registered cinefield.generation.cancelled payload schema.
    -- Identifiers only: no prompt, no output path, no owner identity.
    jsonb_strip_nulls(jsonb_build_object(
      'generationId', p_generation_id::text,
      'provider', v_row.provider
    )),
    p_trace_id,
    p_event_id
  );

  RETURN jsonb_build_object(
    'applied', true,
    'status', 'cancelled',
    'event_id', v_event_id
  );
END;
$$;

ALTER FUNCTION "public"."cancel_generation_tx"("uuid", "text", "text", "uuid") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."cancel_generation_tx"("uuid", "text", "text", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."cancel_generation_tx"("uuid", "text", "text", "uuid") FROM "anon";
REVOKE ALL ON FUNCTION "public"."cancel_generation_tx"("uuid", "text", "text", "uuid") FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."cancel_generation_tx"("uuid", "text", "text", "uuid") TO "service_role";

COMMENT ON FUNCTION "public"."cancel_generation_tx"("uuid", "text", "text", "uuid") IS
  'Phase 6R-E/6R-H. Cancels a generation and records generation.cancelled in the outbox within ONE transaction. Returns {applied, status, event_id}; applied=false when the row already reached a terminal state, in which case no event is emitted.';

-- ---------------------------------------------------------------------------
-- outbox_tx_rollback_probe() — proves the rollback half, on demand
-- ---------------------------------------------------------------------------
-- The commit-together half is observable by calling cancel_generation_tx and
-- looking at both tables. The ROLLBACK half is not: a caller cannot easily
-- make emit_outbox_event fail from outside. This probe makes the failure
-- happen after a successful business UPDATE, inside the same transaction, so
-- a test can prove the UPDATE is undone rather than assuming it.
--
-- It is a TEST AFFORDANCE and is written to be useless as anything else: it
-- always raises, so it can never leave a committed change behind.
CREATE OR REPLACE FUNCTION "public"."outbox_tx_rollback_probe"(
    "p_generation_id" "uuid"
) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE generations
     SET status = 'cancelled', completed_at = now()
   WHERE id = p_generation_id
     AND status IN ('queued', 'processing');

  -- An invalid event type: emit_outbox_event raises, and PostgreSQL unwinds
  -- the UPDATE above along with it.
  PERFORM emit_outbox_event('', 1, 'generation', p_generation_id::text, '{}'::jsonb);

  RAISE EXCEPTION 'outbox_tx_rollback_probe_unreachable' USING ERRCODE = 'P0001';
END;
$$;

ALTER FUNCTION "public"."outbox_tx_rollback_probe"("uuid") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."outbox_tx_rollback_probe"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."outbox_tx_rollback_probe"("uuid") FROM "anon";
REVOKE ALL ON FUNCTION "public"."outbox_tx_rollback_probe"("uuid") FROM "authenticated";

COMMENT ON FUNCTION "public"."outbox_tx_rollback_probe"("uuid") IS
  'Test affordance (Phase 6R-E). Performs a business UPDATE then forces emit_outbox_event to fail inside the same transaction, so the rollback guarantee can be proven rather than assumed. Always raises.';
