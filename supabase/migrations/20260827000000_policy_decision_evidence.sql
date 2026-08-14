-- ===========================================================================
-- PHASE 12-E — Policy decision evidence
-- ===========================================================================
-- Roadmap ¶2284: policy decisions on two-person actions are made through
-- OPA/Rego and "decision log'a yazılır" — written to a decision log. ¶1852
-- adds that an AI-initiated action's audit entry carries the policy version.
--
-- ---------------------------------------------------------------------------
-- NO SECOND AUDIT PLATFORM
-- ---------------------------------------------------------------------------
-- The decision log is `security_events`, extended. A separate policy_decisions
-- table would mean two append-only stores, two retention policies, two sets of
-- grants and two places to look during an incident — and the second one would
-- be the one nobody remembers to check. Everything 12-C built applies here
-- unchanged: the append-only trigger, the bounded columns, the reason-code
-- pattern, the storm control, the service_role-only grants.
--
-- ---------------------------------------------------------------------------
-- STRICTLY ADDITIVE
-- ---------------------------------------------------------------------------
-- Two new kinds and one new source WIDEN existing CHECKs; one nullable column
-- is added. No column is dropped, no constraint is narrowed, no row is
-- rewritten, and every value that was legal before this migration is still
-- legal after it.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- policy_version — so a decision can be reproduced later
-- ---------------------------------------------------------------------------
-- Without it a decision log records that something was allowed but not what
-- allowed it, and policy drift becomes silent: a rule changes, old entries
-- still read as if the current policy produced them, and nobody can tell
-- which version was in force. Phase 19 owns full policy lifecycle governance;
-- this is the minimum that makes the log honest in the meantime.
ALTER TABLE "public"."security_events"
  ADD COLUMN IF NOT EXISTS "policy_version" "text";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'security_events_policy_version_check'
  ) THEN
    ALTER TABLE "public"."security_events"
      ADD CONSTRAINT "security_events_policy_version_check"
      CHECK ("policy_version" IS NULL OR "char_length"("policy_version") <= 64);
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- Two new kinds, one new source
-- ---------------------------------------------------------------------------
-- BOTH outcomes are recorded, not only refusals. A log holding only denials
-- cannot answer "who released that asset, under which policy version" — which
-- is the question an incident actually asks. The allow side is the more
-- valuable half of a decision log for exactly the actions this gate covers.
ALTER TABLE "public"."security_events"
  DROP CONSTRAINT IF EXISTS "security_events_kind_check";

ALTER TABLE "public"."security_events"
  ADD CONSTRAINT "security_events_kind_check" CHECK ("kind" = ANY (ARRAY[
    'rate_limit_denied'::"text",
    'outbound_fetch_blocked'::"text",
    'realtime_connection_denied'::"text",
    'media_release_approved'::"text",
    'media_rejected'::"text",
    'realtime_event_unroutable'::"text",
    'auth_failure'::"text",
    -- Phase 12-E.
    'policy_decision_allowed'::"text",
    'policy_decision_denied'::"text"
  ]));

ALTER TABLE "public"."security_events"
  DROP CONSTRAINT IF EXISTS "security_events_source_check";

ALTER TABLE "public"."security_events"
  ADD CONSTRAINT "security_events_source_check" CHECK ("source" = ANY (ARRAY[
    'route_rate_limit'::"text",
    'outbound_fetch_gateway'::"text",
    'realtime_gateway'::"text",
    'media_safety'::"text",
    'realtime_dispatcher'::"text",
    'auth'::"text",
    -- Phase 12-E.
    'policy_gate'::"text"
  ]));


-- ---------------------------------------------------------------------------
-- record_security_event() — one new parameter, and an explicit DROP first
-- ---------------------------------------------------------------------------
-- THE DROP IS NOT DEFENSIVE TIDYING. It is required, and this migration was
-- written twice to learn that.
--
-- The first draft appended `p_policy_version` with a DEFAULT and relied on
-- CREATE OR REPLACE to replace the function in place, on the theory that a
-- defaulted trailing parameter keeps every existing 8- and 15-argument call
-- resolving to one definition. That is wrong: PostgreSQL identifies a function
-- by its FULL argument type list, so the 16-parameter version was created
-- alongside the 15-parameter one and the catalog held two. The integrity check
-- at the end of this file caught it on the first proof run — the identical
-- failure 20260824000000 records for `emit_outbox_event`, which is why that
-- check was written before the migration was ever applied.
--
-- Dropping the old signature explicitly is the fix. It is safe here: nothing
-- but service_role code calls this function, no view or trigger depends on it,
-- and the drop and create are in the same migration transaction, so no window
-- exists in which neither is callable.
--
-- The body is otherwise IDENTICAL to 20260826000000 — same window floor from
-- clock_timestamp(), same ON CONFLICT storm control, same warning emission
-- through the outbox in the same transaction. Every S12C proof re-runs
-- against this definition.
DROP FUNCTION IF EXISTS "public"."record_security_event"(
  "text","text","text","text","text",integer,"text","text","text","text","text","text",integer,"text",boolean
);

CREATE OR REPLACE FUNCTION "public"."record_security_event"(
    "p_kind" "text",
    "p_severity" "text",
    "p_source" "text",
    "p_reason_code" "text",
    "p_dedupe_key" "text",
    "p_window_seconds" integer DEFAULT 60,
    "p_actor" "text" DEFAULT NULL,
    "p_tenant_id" "text" DEFAULT NULL,
    "p_subject_hash" "text" DEFAULT NULL,
    "p_resource_type" "text" DEFAULT NULL,
    "p_resource_id" "text" DEFAULT NULL,
    "p_trace_id" "text" DEFAULT NULL,
    "p_risk_score" integer DEFAULT NULL,
    "p_recommended_action" "text" DEFAULT NULL,
    "p_emit_warning" boolean DEFAULT false,
    "p_policy_version" "text" DEFAULT NULL
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_window_start timestamp with time zone;
  v_event_id uuid;
  v_outbox_id uuid;
BEGIN
  IF p_window_seconds IS NULL OR p_window_seconds < 1 OR p_window_seconds > 86400 THEN
    RAISE EXCEPTION 'invalid_window' USING ERRCODE = '22023';
  END IF;
  IF p_dedupe_key IS NULL OR "char_length"(p_dedupe_key) = 0 THEN
    RAISE EXCEPTION 'invalid_dedupe_key' USING ERRCODE = '22023';
  END IF;

  -- clock_timestamp(), NOT now(): inside a long transaction now() would floor
  -- every signal into the window the transaction opened in.
  v_window_start := to_timestamp(
    floor(extract(epoch FROM clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO security_events (
    kind, severity, source, reason_code, actor_clerk_user_id, tenant_id,
    subject_hash, resource_type, resource_id, trace_id, risk_score,
    recommended_action, dedupe_key, window_started_at, policy_version
  ) VALUES (
    p_kind, p_severity, p_source, p_reason_code, p_actor, p_tenant_id,
    p_subject_hash, p_resource_type, p_resource_id, p_trace_id, p_risk_score,
    p_recommended_action, p_dedupe_key, v_window_start, p_policy_version
  )
  ON CONFLICT ("dedupe_key", "window_started_at") DO NOTHING
  RETURNING event_id INTO v_event_id;

  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'coalesced');
  END IF;

  IF p_emit_warning AND p_tenant_id IS NOT NULL THEN
    v_outbox_id := emit_outbox_event(
      'security.warning', 1, 'security_event', v_event_id::text,
      jsonb_build_object('reasonCode', p_reason_code, 'severity', p_severity),
      p_trace_id, NULL, NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'recorded', true,
    'event_id', v_event_id,
    'outbox_event_id', v_outbox_id
  );
END;
$$;

-- One definition, asserted rather than assumed.
--
-- Two callable definitions would make every existing 8-argument call site
-- ambiguous at runtime — an error that appears in production the first time a
-- security signal is recorded, not at migration time. This check is what
-- turned that into a failed proof run instead.
DO $$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'record_security_event';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'record_security_event must have exactly one definition, found %', v_count;
  END IF;
END $$;

ALTER FUNCTION "public"."record_security_event"("text","text","text","text","text",integer,"text","text","text","text","text","text",integer,"text",boolean,"text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."record_security_event"("text","text","text","text","text",integer,"text","text","text","text","text","text",integer,"text",boolean,"text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."record_security_event"("text","text","text","text","text",integer,"text","text","text","text","text","text",integer,"text",boolean,"text") TO "service_role";
