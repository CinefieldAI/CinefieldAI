-- ===========================================================================
-- PHASE 12-C — Security Event Logger + Risk Engine evidence
-- ===========================================================================
-- Roadmap: "Security Event Logger + security.events + Risk Engine
-- warning/challenge/temp block/admin review zincirini kur." (¶1642) and
-- "Postgres Outbox security.events" (¶1670).
--
-- ---------------------------------------------------------------------------
-- THIS IS EVIDENCE, NOT A LOG
-- ---------------------------------------------------------------------------
-- A log is something an operator greps. This is the record a security decision
-- is later justified by, so it is append-only through a trigger that refuses
-- every role including the one that writes it, and it carries no free text.
-- Every column is bounded and every reason is a short code, because an
-- evidence table that can hold arbitrary strings will eventually hold a
-- prompt, a URL with a signature in it, or a provider's error message quoting
-- the user's own input back.
--
-- ---------------------------------------------------------------------------
-- WHY NOT media_safety_audit
-- ---------------------------------------------------------------------------
-- That table is domain evidence for one decision — who released or rejected a
-- quarantined asset, and on what grounds. Widening it into a global security
-- log would put rate-limit noise next to a two-person moderation approval and
-- make both harder to reason about. It stays exactly as 9-E built it; a
-- security event may REFERENCE an asset, and never copies approver identities
-- or reason codes out of it.
--
-- ---------------------------------------------------------------------------
-- STORM CONTROL IS THE SCHEMA, NOT A LATER OPTIMISATION
-- ---------------------------------------------------------------------------
-- An attacker generating ten thousand rejected requests must not turn the
-- security logger into a database amplifier that finishes the job for them.
-- So a signal is written at most once per (subject, kind, reason) per
-- coalescing window: `dedupe_key` plus `window_started_at` carry a unique
-- index, and a repeat inside the window is a no-op insert.
--
-- WHAT THAT TRADES. The exact count WITHIN a window is not stored. That is
-- deliberate and it is the honest cost of a bounded write rate: escalation
-- does not need "4,812 denials in this minute", it needs "this subject tripped
-- the limit in twelve of the last fifteen minutes", which is a row count and
-- is exactly what survives. Magnitude within a window still exists in the rate
-- limiter's own Redis counters for as long as they live.
--
-- It also keeps the table strictly append-only. A mutable `occurrence_count`
-- would have preserved magnitude at the cost of making the evidence
-- rewritable, and evidence that can be rewritten is not evidence.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- security_events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."security_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,

    -- Stable identity for the logical signal. Distinct from `id` so a caller
    -- that retries can supply the same one.
    "event_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,

    -- The normalized taxonomy. Bounded by CHECK rather than by convention:
    -- a typo'd kind must fail loudly at write time, not silently create a
    -- category nobody queries.
    "kind" "text" NOT NULL,
    "severity" "text" NOT NULL,

    -- Which subsystem observed it. Not free text.
    "source" "text" NOT NULL,

    -- Short code, never a message. Same discipline as media_safety_audit.
    "reason_code" "text" NOT NULL,

    -- Trusted server-side identity ONLY. Null when the signal genuinely has
    -- no authenticated subject (an anonymous request); never a browser claim.
    "actor_clerk_user_id" "text",
    "tenant_id" "text",

    -- A hashed bucket, never an address. Present so per-source recurrence is
    -- countable without the table ever holding an IP.
    "subject_hash" "text",

    -- What the signal is about, when that is safe to say. An asset id or a
    -- generation id is an opaque uuid the owner already has; a URL, a key or
    -- a prompt is not, and none may appear here.
    "resource_type" "text",
    "resource_id" "text",

    "trace_id" "text",

    -- The Risk Engine's output, recorded WITH the evidence so a decision can
    -- be explained later from the row that caused it.
    "risk_score" integer,
    "recommended_action" "text",

    -- Storm control. `dedupe_key` is derived server-side from the subject and
    -- the signal; `window_started_at` is the floor of the coalescing window.
    "dedupe_key" "text" NOT NULL,
    "window_started_at" timestamp with time zone NOT NULL,

    -- clock_timestamp(), for the same reason the window floor uses it: inside
    -- a long transaction `now()` would stamp every signal with the moment the
    -- transaction opened rather than the moment the refusal happened.
    "occurred_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id"),

    -- The taxonomy. Extending it is a migration, which is the point: a new
    -- category should be a reviewed decision.
    CONSTRAINT "security_events_kind_check" CHECK ("kind" = ANY (ARRAY[
      'rate_limit_denied'::"text",
      'outbound_fetch_blocked'::"text",
      'realtime_connection_denied'::"text",
      'media_release_approved'::"text",
      'media_rejected'::"text",
      'realtime_event_unroutable'::"text",
      'auth_failure'::"text"
    ])),

    CONSTRAINT "security_events_severity_check" CHECK ("severity" = ANY (ARRAY[
      'info'::"text", 'low'::"text", 'medium'::"text", 'high'::"text"
    ])),

    CONSTRAINT "security_events_source_check" CHECK ("source" = ANY (ARRAY[
      'route_rate_limit'::"text",
      'outbound_fetch_gateway'::"text",
      'realtime_gateway'::"text",
      'media_safety'::"text",
      'realtime_dispatcher'::"text",
      'auth'::"text"
    ])),

    CONSTRAINT "security_events_action_check" CHECK (
      "recommended_action" IS NULL OR "recommended_action" = ANY (ARRAY[
        'none'::"text", 'warning'::"text", 'challenge'::"text",
        'temporary_block'::"text", 'admin_review'::"text"
      ])
    ),

    -- Short codes only. The same pattern 9-E uses, for the same reason.
    CONSTRAINT "security_events_reason_check"
      CHECK ("reason_code" ~ '^[a-z][a-z0-9_]{1,64}$'),

    CONSTRAINT "security_events_risk_score_check"
      CHECK ("risk_score" IS NULL OR ("risk_score" BETWEEN 0 AND 100)),

    -- Bounded identifiers. Nothing here should ever be long, and a length
    -- ceiling is the cheapest way to stop a payload arriving in a text column.
    CONSTRAINT "security_events_bounds_check" CHECK (
      ("actor_clerk_user_id" IS NULL OR "char_length"("actor_clerk_user_id") <= 255)
      AND ("tenant_id" IS NULL OR "char_length"("tenant_id") <= 255)
      AND ("subject_hash" IS NULL OR "char_length"("subject_hash") <= 64)
      AND ("resource_type" IS NULL OR "char_length"("resource_type") <= 64)
      AND ("resource_id" IS NULL OR "char_length"("resource_id") <= 200)
      AND ("trace_id" IS NULL OR "char_length"("trace_id") <= 200)
      AND "char_length"("dedupe_key") <= 300
    )
);

ALTER TABLE "public"."security_events" OWNER TO "postgres";

-- THE STORM CONTROL. One row per signal per window; a repeat is absorbed.
CREATE UNIQUE INDEX IF NOT EXISTS "security_events_dedupe_window_uniq"
  ON "public"."security_events" ("dedupe_key", "window_started_at");

-- Recurrence lookups: "how often has this subject done this recently".
CREATE INDEX IF NOT EXISTS "security_events_subject_recent_idx"
  ON "public"."security_events" ("dedupe_key", "occurred_at" DESC);

CREATE INDEX IF NOT EXISTS "security_events_actor_recent_idx"
  ON "public"."security_events" ("actor_clerk_user_id", "occurred_at" DESC)
  WHERE "actor_clerk_user_id" IS NOT NULL;

-- Phase 23 will need to age this table out by time. Giving it the index now
-- costs nothing and means retention is a policy decision rather than a
-- migration.
CREATE INDEX IF NOT EXISTS "security_events_occurred_idx"
  ON "public"."security_events" ("occurred_at");


-- ---------------------------------------------------------------------------
-- Append-only, enforced
-- ---------------------------------------------------------------------------
-- Refuses every role, including service_role. Phase 23 will need to DELETE
-- for retention and will lift that specific ability deliberately; until then
-- nothing removes evidence, and nothing edits it ever.
CREATE OR REPLACE FUNCTION "public"."security_events_append_only"() RETURNS "trigger"
    LANGUAGE "plpgsql" AS $$
BEGIN
  RAISE EXCEPTION 'security_events_is_append_only' USING ERRCODE = '23514';
END;
$$;

ALTER FUNCTION "public"."security_events_append_only"() OWNER TO "postgres";

DROP TRIGGER IF EXISTS "security_events_append_only_trg" ON "public"."security_events";
CREATE TRIGGER "security_events_append_only_trg"
  BEFORE UPDATE OR DELETE ON "public"."security_events"
  FOR EACH ROW EXECUTE FUNCTION "public"."security_events_append_only"();


-- ---------------------------------------------------------------------------
-- No browser reaches this, in any direction
-- ---------------------------------------------------------------------------
-- Raw security evidence is operator data. A user who needs to know something
-- receives a `security.warning` through the Phase 11 realtime path — a
-- normalized, projected notification — never a row from here. Exposing the
-- raw table would hand an attacker the detection rules along with their own
-- risk score.
ALTER TABLE "public"."security_events" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."security_events" FROM "anon", "authenticated";
GRANT SELECT, INSERT ON TABLE "public"."security_events" TO "service_role";


-- ---------------------------------------------------------------------------
-- record_security_event() — the only writer
-- ---------------------------------------------------------------------------
-- Returns the row's identity and whether it was newly recorded. A coalesced
-- repeat returns `recorded = false`, which is not an error: it means storm
-- control absorbed it, and the caller must not treat that as a failure.
--
-- The warning path emits through the EXISTING outbox in the SAME transaction,
-- so a user-facing warning and the evidence behind it commit together or not
-- at all. It does not publish to Redis: the realtime dispatcher owns that arrow
-- and the Risk Engine must not grow a second one.
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
    "p_emit_warning" boolean DEFAULT false
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

  -- Floor to the window. Two signals in the same window share a boundary and
  -- therefore collide on the unique index.
  --
  -- clock_timestamp(), NOT now(). `now()` is the TRANSACTION's start time, so
  -- every signal raised inside one long transaction would floor to the same
  -- window no matter how much real time had passed — three refusals a second
  -- apart would coalesce into one row, and the recurrence count the Risk
  -- Engine reads would stay at 1 while an attack escalated. The proofs caught
  -- exactly that. A security window has to be measured against the wall
  -- clock, because that is what the attacker is acting against.
  v_window_start := to_timestamp(
    floor(extract(epoch FROM clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO security_events (
    kind, severity, source, reason_code, actor_clerk_user_id, tenant_id,
    subject_hash, resource_type, resource_id, trace_id, risk_score,
    recommended_action, dedupe_key, window_started_at
  ) VALUES (
    p_kind, p_severity, p_source, p_reason_code, p_actor, p_tenant_id,
    p_subject_hash, p_resource_type, p_resource_id, p_trace_id, p_risk_score,
    p_recommended_action, p_dedupe_key, v_window_start
  )
  ON CONFLICT ("dedupe_key", "window_started_at") DO NOTHING
  RETURNING event_id INTO v_event_id;

  IF v_event_id IS NULL THEN
    -- Coalesced. No second row, and no second warning either: a user told
    -- once per window is informed; told per request they are attacked.
    RETURN jsonb_build_object('recorded', false, 'reason', 'coalesced');
  END IF;

  -- A user-facing warning travels the Phase 11 path like every other
  -- notification: outbox first, in this transaction. The event type is
  -- `security.warning` because that is the name Phase 11-B already maps, and
  -- because the envelope contract admits exactly two dotted segments.
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

ALTER FUNCTION "public"."record_security_event"("text","text","text","text","text",integer,"text","text","text","text","text","text",integer,"text",boolean) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."record_security_event"("text","text","text","text","text",integer,"text","text","text","text","text","text",integer,"text",boolean) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."record_security_event"("text","text","text","text","text",integer,"text","text","text","text","text","text",integer,"text",boolean) TO "service_role";


-- ---------------------------------------------------------------------------
-- security_event_recurrence() — the only input the Risk Engine needs from here
-- ---------------------------------------------------------------------------
-- Counts distinct windows in which this subject produced this signal. Windows,
-- not requests: that is what storm control preserves, and it is the shape
-- escalation actually reasons about.
CREATE OR REPLACE FUNCTION "public"."security_event_recurrence"(
    "p_dedupe_key" "text",
    "p_lookback_seconds" integer DEFAULT 900
) RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT count(*)::integer
    FROM security_events
   WHERE dedupe_key = p_dedupe_key
     AND occurred_at >= clock_timestamp() - make_interval(secs => GREATEST(p_lookback_seconds, 1));
$$;

ALTER FUNCTION "public"."security_event_recurrence"("text", integer) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."security_event_recurrence"("text", integer) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."security_event_recurrence"("text", integer) TO "service_role";


-- ---------------------------------------------------------------------------
-- The warning has to be ROUTABLE, or it is not a warning
-- ---------------------------------------------------------------------------
-- `emit_outbox_event` resolves the tenant itself, from the aggregate, inside
-- the caller's transaction — and it knew two aggregate types: `generation` and
-- `media_asset`. Emitting `security.warning` against a third would therefore
-- have written a row with `tenant_id = NULL`, which Phase 11-D refuses to
-- route and 11-A counts as `realtime_event_unroutable`. The warning would have
-- committed, looked correct in the outbox, and reached nobody.
--
-- That is precisely the failure shape this project has now closed three times
-- (D-11-1, D-12-1): a component built, proven, and never actually connected.
-- So the resolver learns the new aggregate rather than the emitter learning a
-- parameter — `emit_outbox_event`'s signature stays byte-identical, and there
-- remains exactly ONE place a tenant can come from, which is the invariant
-- 20260824000000 established after the overload incident.
--
-- The lookup is safe within the transaction: `record_security_event` has
-- already INSERTed the row it is about to reference, so the SELECT below sees
-- it. A security event with no tenant simply resolves to NULL and no warning
-- is emitted at all — the logger only asks for one when a tenant exists.
CREATE OR REPLACE FUNCTION "public"."outbox_tenant_for_aggregate"(
    "p_aggregate_type" "text",
    "p_aggregate_id" "text"
) RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_tenant text;
  v_uuid uuid;
BEGIN
  IF p_aggregate_type IS NULL OR p_aggregate_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Every aggregate id below is a uuid. A non-uuid is not an error worth
  -- raising inside an emit — it simply cannot be resolved, and an
  -- unresolvable tenant is already handled as a refusal.
  BEGIN
    v_uuid := p_aggregate_id::uuid;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;

  IF p_aggregate_type = 'generation' THEN
    SELECT clerk_user_id INTO v_tenant FROM generations WHERE id = v_uuid;
  ELSIF p_aggregate_type = 'media_asset' THEN
    SELECT clerk_user_id INTO v_tenant FROM media_assets WHERE id = v_uuid;
  ELSIF p_aggregate_type = 'security_event' THEN
    -- Phase 12-C. `event_id`, not `id`: the outbox references the signal's
    -- stable logical identity, which is what a retrying caller can reproduce.
    SELECT tenant_id INTO v_tenant FROM security_events WHERE event_id = v_uuid;
  ELSE
    RETURN NULL;
  END IF;

  RETURN v_tenant;
END;
$$;

ALTER FUNCTION "public"."outbox_tenant_for_aggregate"("text", "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."outbox_tenant_for_aggregate"("text", "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."outbox_tenant_for_aggregate"("text", "text") TO "service_role";
