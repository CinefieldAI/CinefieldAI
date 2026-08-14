-- ===========================================================================
-- PRE-11 + PHASE 11-A — event contract repair and tenant-routed outbox
-- ===========================================================================
-- Two problems, one migration, because they are the same problem seen twice:
-- the outbox knows what happened but not enough about it to be consumed.
--
-- (1) D-1 — SQL emitted `media.asset.released` / `media.asset.rejected`.
--     `emit_outbox_event` checks only that the type is non-empty; every real
--     rule lives in TypeScript, where the envelope pattern admits exactly two
--     dotted segments and the family set has no `media`. Those two events
--     were therefore unroutable: `familyOf()` -> null, so a producer must
--     refuse to publish them. They are renamed to the canonical `asset.*`
--     family rather than widening the contract, because `asset` already
--     exists as a first-class family and a pattern that refuses to guess is
--     worth more than one that accommodates a mistake.
--
-- (2) D-2 — `outbox_events` carried no tenant. Phase 11-A must route each
--     event to a user channel, and nothing in the row said whose it was.
--
-- ---------------------------------------------------------------------------
-- WHY THE TENANT IS CAPTURED HERE AND NOT RESOLVED LATER
-- ---------------------------------------------------------------------------
-- The alternative was to look the owner up at consume time by joining the
-- aggregate back to its table. That was rejected:
--
--   * Routing would depend on MUTABLE STATE. The channel an event belongs to
--     would be whatever the aggregate says at delivery time, not what was
--     true when the fact occurred. Every other durable decision in this
--     system is fixed at the moment it is made; a notification target should
--     not be the exception.
--   * `generations.clerk_user_id` cascades from `profiles`. Delete the
--     profile and the aggregate is gone, so a consume-time join makes every
--     historical event permanently unresolvable — including for replay and
--     audit, which are exactly the readers that outlive a row.
--   * The Notification Service resolves a tenant for EVERY event it will ever
--     handle. A per-event join puts a second table on the hottest path in
--     the phase.
--
-- So the tenant is written INSIDE the emitting transaction, alongside the
-- fact, from the row the caller has just written or locked. It is captured,
-- not looked up: the resolution happens once, at the only moment the answer
-- is unambiguous.
--
-- Doing it inside `emit_outbox_event` rather than at six call sites is
-- deliberate. Rewriting six proven function bodies to thread one argument
-- through is a transcription risk with no benefit; one resolver, with an
-- explicit aggregate-type map, is reviewable in a single place and cannot be
-- forgotten by a future emitter.
--
-- ---------------------------------------------------------------------------
-- FAIL CLOSED, AND WHY THE COLUMN IS NULLABLE
-- ---------------------------------------------------------------------------
-- `tenant_id` is NULLABLE and NULL means "not captured" — never "everyone".
-- The Notification Service REFUSES to route a NULL-tenant event; it does not
-- fall back to a global channel, and no browser input can supply one.
--
-- NOT NULL was rejected because it would have forced a backfill of the 92
-- historical rows with a guessed owner. A guessed tenant that routes is worse
-- than an honest NULL that refuses.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- outbox_events.tenant_id — the captured owner
-- ---------------------------------------------------------------------------
ALTER TABLE "public"."outbox_events"
  ADD COLUMN IF NOT EXISTS "tenant_id" "text";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "pg_constraint" WHERE "conname" = 'outbox_events_tenant_id_check') THEN
    ALTER TABLE "public"."outbox_events"
      ADD CONSTRAINT "outbox_events_tenant_id_check"
      CHECK ("tenant_id" IS NULL OR ("char_length"("tenant_id") BETWEEN 1 AND 255));
  END IF;
END $$;

-- Consumers read forward through pending events for one tenant.
CREATE INDEX IF NOT EXISTS "outbox_events_tenant_pending_idx"
  ON "public"."outbox_events" ("tenant_id", "created_at")
  WHERE "status" = 'pending' AND "tenant_id" IS NOT NULL;

COMMENT ON COLUMN "public"."outbox_events"."tenant_id" IS
  'Owner captured inside the emitting transaction. NULL means not captured, which the Notification Service treats as unroutable. Never a fallback channel.';


-- ---------------------------------------------------------------------------
-- outbox_tenant_for_aggregate() — the explicit map
-- ---------------------------------------------------------------------------
-- One place that knows which table owns which aggregate type. An unknown
-- aggregate type returns NULL rather than guessing, and NULL refuses to route
-- downstream, so a new aggregate that forgets to register here fails visibly
-- instead of delivering to the wrong person.
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
  ELSE
    RETURN NULL;
  END IF;

  RETURN v_tenant;
END;
$$;

ALTER FUNCTION "public"."outbox_tenant_for_aggregate"("text", "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."outbox_tenant_for_aggregate"("text", "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."outbox_tenant_for_aggregate"("text", "text") TO "service_role";


-- ---------------------------------------------------------------------------
-- emit_outbox_event() — unchanged contract, plus tenant capture
-- ---------------------------------------------------------------------------
-- THE SIGNATURE IS UNCHANGED, DOWN TO THE PARAMETER LIST.
--
-- An earlier draft appended `p_tenant_id` so a caller holding the owner could
-- pass it directly. That was wrong twice over. PostgreSQL treats a different
-- arity as an OVERLOAD rather than a replacement, so the old eight-parameter
-- function survived alongside it and every existing seven-argument call became
-- ambiguous — the proof suite caught it on the first statement. And even had
-- it resolved, two ways to supply a tenant means two ways to supply the WRONG
-- one. There is now exactly one: resolved here, from the aggregate, inside the
-- caller's transaction. No call site can pass a tenant, so no call site can
-- pass a mistaken one.
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
  v_tenant text;
BEGIN
  IF p_event_type IS NULL OR "char_length"(p_event_type) = 0 THEN
    RAISE EXCEPTION 'invalid_event_type' USING ERRCODE = '22023';
  END IF;
  IF p_aggregate_id IS NULL OR "char_length"(p_aggregate_id) = 0 THEN
    RAISE EXCEPTION 'invalid_aggregate_id' USING ERRCODE = '22023';
  END IF;

  v_event_id := COALESCE(p_event_id, gen_random_uuid());

  -- Captured now, in this transaction, from the row the caller has just
  -- written or locked. Not a lookup deferred to delivery time: the answer is
  -- read at the only moment it is unambiguous, and stored with the fact.
  v_tenant := outbox_tenant_for_aggregate(p_aggregate_type, p_aggregate_id);

  INSERT INTO outbox_events
    (event_id, event_type, event_version, aggregate_type, aggregate_id,
     trace_id, payload, occurred_at, tenant_id)
  VALUES
    (v_event_id, p_event_type, p_event_version, p_aggregate_type, p_aggregate_id,
     p_trace_id, COALESCE(p_payload, '{}'::jsonb), COALESCE(p_occurred_at, now()),
     v_tenant);

  RETURN v_event_id;
END;
$$;

ALTER FUNCTION "public"."emit_outbox_event"("text", integer, "text", "text", "jsonb", "text", "uuid", timestamp with time zone) OWNER TO "postgres";


-- ===========================================================================
-- D-1 REPAIR — media.asset.* becomes asset.*
-- ===========================================================================
-- Both function bodies are otherwise IDENTICAL to 20260823000000. Only the
-- event type string changes. Every quarantine invariant proven there — the
-- row lock, the ordered evidence checks, the two-person threshold, the
-- moderation gate that no administrator can argue with, the append-only
-- audit, the inert replay — is reproduced unchanged, and the Phase 9-E proofs
-- are re-run against these definitions.
--
-- NO HISTORICAL ROWS EXIST. The live outbox was inspected before this
-- migration was written: it holds 91 `generation.cancelled` and 1
-- `generation.completed`, all pending, and ZERO `media.asset.*`. There is
-- therefore nothing to translate and nothing that could double-deliver. Had
-- rows existed, renaming in place would have been wrong — a published row
-- carries an identity a consumer may already have deduplicated against.
-- ===========================================================================

CREATE OR REPLACE FUNCTION "public"."approve_media_release"(
    "p_asset_id" "uuid",
    "p_actor" "text",
    "p_reason_code" "text" DEFAULT NULL,
    "p_trace_id" "text" DEFAULT NULL
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_row media_assets%ROWTYPE;
  v_approvals integer;
  v_event_id uuid;
BEGIN
  IF p_actor IS NULL OR "char_length"(p_actor) = 0 THEN
    RAISE EXCEPTION 'invalid_actor' USING ERRCODE = '22023';
  END IF;
  IF p_reason_code IS NOT NULL AND p_reason_code !~ '^[a-z][a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'invalid_reason_code' USING ERRCODE = '22023';
  END IF;

  -- The row lock is what serialises a release against a concurrent release or
  -- reject. Two callers cannot both read `quarantined` and both proceed.
  SELECT * INTO v_row FROM media_assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('released', false, 'reason', 'not_found');
  END IF;

  IF v_row.quarantine_status = 'released' THEN
    RETURN jsonb_build_object('released', false, 'reason', 'already_released',
                              'quarantine_status', v_row.quarantine_status);
  END IF;

  IF v_row.ingest_status = 'rejected' THEN
    RETURN jsonb_build_object('released', false, 'reason', 'asset_rejected');
  END IF;
  IF v_row.ingest_status <> 'verified' THEN
    RETURN jsonb_build_object('released', false, 'reason', 'ingest_not_verified');
  END IF;
  IF v_row.status <> 'finalized' THEN
    RETURN jsonb_build_object('released', false, 'reason', 'asset_not_finalized');
  END IF;
  IF v_row.verified_mime IS NULL THEN
    RETURN jsonb_build_object('released', false, 'reason', 'missing_verified_mime');
  END IF;
  IF v_row.checksum_sha256 IS NULL THEN
    RETURN jsonb_build_object('released', false, 'reason', 'missing_checksum');
  END IF;
  IF v_row.tombstoned_at IS NOT NULL THEN
    RETURN jsonb_build_object('released', false, 'reason', 'asset_tombstoned');
  END IF;

  -- THE ONE THAT CANNOT BE ARGUED WITH.
  IF v_row.moderation_status NOT IN ('passed', 'approved') THEN
    RETURN jsonb_build_object('released', false, 'reason', 'moderation_not_passed',
                              'moderation_status', v_row.moderation_status);
  END IF;

  INSERT INTO media_release_approvals (asset_id, approver_clerk_user_id, reason_code)
  VALUES (p_asset_id, p_actor, p_reason_code)
  ON CONFLICT ("asset_id", "approver_clerk_user_id") DO NOTHING;

  SELECT count(*) INTO v_approvals FROM media_release_approvals WHERE asset_id = p_asset_id;

  IF v_approvals < media_release_required_approvals() THEN
    INSERT INTO media_safety_audit
      (asset_id, actor_clerk_user_id, action, prior_quarantine_status,
       resulting_quarantine_status, prior_moderation_status, reason_code, trace_id)
    VALUES (p_asset_id, p_actor, 'release_requested', v_row.quarantine_status,
            v_row.quarantine_status, v_row.moderation_status, p_reason_code, p_trace_id);

    RETURN jsonb_build_object('released', false, 'reason', 'awaiting_second_approval',
                              'approvals', v_approvals,
                              'required', media_release_required_approvals());
  END IF;

  UPDATE media_assets SET quarantine_status = 'released' WHERE id = p_asset_id;

  INSERT INTO media_safety_audit
    (asset_id, actor_clerk_user_id, action, prior_quarantine_status,
     resulting_quarantine_status, prior_moderation_status, reason_code, trace_id)
  VALUES (p_asset_id, p_actor, 'release_approved', v_row.quarantine_status,
          'released', v_row.moderation_status, p_reason_code, p_trace_id);

  -- CANONICAL FAMILY (was media.asset.released). The tenant is captured by
  -- emit_outbox_event from the asset row this transaction already holds.
  v_event_id := emit_outbox_event(
    'asset.released', 1, 'media_asset', p_asset_id::text,
    jsonb_strip_nulls(jsonb_build_object('assetId', p_asset_id::text)),
    p_trace_id
  );

  RETURN jsonb_build_object('released', true, 'asset_id', p_asset_id, 'event_id', v_event_id);
END;
$$;

ALTER FUNCTION "public"."approve_media_release"("uuid", "text", "text", "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reject_media_asset"(
    "p_asset_id" "uuid",
    "p_actor" "text",
    "p_reason_code" "text" DEFAULT NULL,
    "p_trace_id" "text" DEFAULT NULL
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_row media_assets%ROWTYPE;
  v_event_id uuid;
BEGIN
  IF p_actor IS NULL OR "char_length"(p_actor) = 0 THEN
    RAISE EXCEPTION 'invalid_actor' USING ERRCODE = '22023';
  END IF;
  IF p_reason_code IS NOT NULL AND p_reason_code !~ '^[a-z][a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'invalid_reason_code' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM media_assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('rejected', false, 'reason', 'not_found');
  END IF;

  IF v_row.ingest_status = 'rejected' AND v_row.moderation_status = 'rejected' THEN
    RETURN jsonb_build_object('rejected', false, 'reason', 'already_rejected');
  END IF;

  IF v_row.quarantine_status = 'released' THEN
    RETURN jsonb_build_object('rejected', false, 'reason', 'already_released');
  END IF;

  UPDATE media_assets
     SET moderation_status = 'rejected',
         ingest_status = 'rejected',
         ingest_failure_reason = COALESCE(p_reason_code, ingest_failure_reason),
         moderated_at = now()
   WHERE id = p_asset_id;

  DELETE FROM media_release_approvals WHERE asset_id = p_asset_id;

  INSERT INTO media_safety_audit
    (asset_id, actor_clerk_user_id, action, prior_quarantine_status,
     resulting_quarantine_status, prior_moderation_status, reason_code, trace_id)
  VALUES (p_asset_id, p_actor, 'rejected', v_row.quarantine_status,
          v_row.quarantine_status, v_row.moderation_status, p_reason_code, p_trace_id);

  -- CANONICAL FAMILY (was media.asset.rejected).
  v_event_id := emit_outbox_event(
    'asset.rejected', 1, 'media_asset', p_asset_id::text,
    jsonb_strip_nulls(jsonb_build_object('assetId', p_asset_id::text)),
    p_trace_id
  );

  RETURN jsonb_build_object('rejected', true, 'asset_id', p_asset_id, 'event_id', v_event_id);
END;
$$;

ALTER FUNCTION "public"."reject_media_asset"("uuid", "text", "text", "text") OWNER TO "postgres";


-- ===========================================================================
-- PHASE 11-A — the two missing lifecycle producers
-- ===========================================================================
-- 11-B must map six browser states. `completed` and `failed` already had
-- producers; `queued` and `processing` did not. Both are added at the exact
-- transaction that makes the transition durable, and nowhere else:
--
--   queued      create_generation_tx, the insert that creates the row
--   processing  claim_generation_tx, the compare-and-set that claims it
--
-- Neither is emitted by a browser, by a provider callback, or by Temporal
-- "because it observed something". Lifecycle ownership does not move.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- create_generation_tx() — now emits generation.created
-- ---------------------------------------------------------------------------
-- Identical to 20260816000000 except for the emit. THE EMIT IS INSIDE THE
-- created=true BRANCH ONLY: a replay returns the existing row and must not
-- produce a second queued event for one logical request. Both replay paths —
-- the fast read and the unique_violation handler — return without emitting.
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
      -- Replay. No event: the queued fact already happened once.
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

  -- ---- M6, CARRIED FORWARD UNCHANGED -------------------------------------
  -- 20260818000000 added this to the same transaction so that "committed" and
  -- "someone is obliged to start this" became one fact. It is reproduced here
  -- because THIS definition supersedes that one, and a CREATE OR REPLACE that
  -- silently drops a predecessor's work is how a dual-write gap comes back.
  -- The workflow id mirrors generationWorkflowId() in
  -- src/lib/temporal/workflow-ids.ts; the relay re-derives it and refuses a
  -- row whose stored id disagrees.
  INSERT INTO workflow_start_outbox (generation_id, workflow_id, clerk_user_id)
  VALUES (v_id, 'gen:' || v_id::text, p_clerk_user_id);

  -- Same transaction as the insert. Matches cinefield.generation.created:
  -- identifiers only, no prompt, no metadata, no input url.
  PERFORM emit_outbox_event(
    'generation.created', 1, 'generation', v_id::text,
    jsonb_build_object(
      'generationId', v_id::text,
      'generationType', p_generation_type,
      'provider', p_provider,
      'model', p_model
    )
  );

  RETURN jsonb_build_object(
    'generation_id', v_id,
    'created',       true,
    'request_hash',  p_request_hash,
    'status',        'queued'
  );

EXCEPTION
  WHEN unique_violation THEN
    -- A concurrent duplicate won. This invocation's insert AND its emit are
    -- both rolled back, which is exactly why the emit belongs in here.
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


-- ---------------------------------------------------------------------------
-- claim_generation_tx() — the queued -> processing transition, transactional
-- ---------------------------------------------------------------------------
-- This transition previously lived in TypeScript as a Supabase compare-and-set
-- (`status-manager.ts` claimGeneration). Emitting from there would have been a
-- dual write: claim commits, process dies, no event — or worse, an event for a
-- claim that lost. Moving the CAS into SQL makes the state change and its
-- event one transaction, matching every other lifecycle producer.
--
-- The predicate is the guard. `AND status = 'queued'` means exactly one
-- concurrent caller can win, so exactly one processing event can exist.
CREATE OR REPLACE FUNCTION "public"."claim_generation_tx"(
    "p_generation_id" "uuid",
    "p_stage" "text" DEFAULT NULL,
    "p_trace_id" "text" DEFAULT NULL
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_row generations%ROWTYPE;
  v_event_id uuid;
BEGIN
  UPDATE generations
     SET status = 'processing',
         metadata = CASE
           WHEN p_stage IS NULL THEN metadata
           ELSE jsonb_set(
                  COALESCE(metadata, '{}'::jsonb),
                  '{orchestration}',
                  COALESCE(metadata -> 'orchestration', '{}'::jsonb)
                    || jsonb_build_object('stage', p_stage),
                  true
                )
         END
   WHERE id = p_generation_id
     AND status = 'queued'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    -- Already claimed, already terminal, or gone. Report the state rather
    -- than raising: a loser in a claim race is a normal outcome.
    SELECT * INTO v_row FROM generations WHERE id = p_generation_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('claimed', false, 'reason', 'not_found');
    END IF;
    RETURN jsonb_build_object('claimed', false, 'reason', 'not_queued',
                              'status', v_row.status);
  END IF;

  v_event_id := emit_outbox_event(
    'generation.processing', 1, 'generation', p_generation_id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'generationId', p_generation_id::text,
      'provider', v_row.provider
    )),
    p_trace_id
  );

  RETURN jsonb_build_object('claimed', true, 'status', 'processing', 'event_id', v_event_id);
END;
$$;

ALTER FUNCTION "public"."claim_generation_tx"("uuid", "text", "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."claim_generation_tx"("uuid", "text", "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."claim_generation_tx"("uuid", "text", "text") TO "service_role";

COMMENT ON FUNCTION "public"."claim_generation_tx"("uuid", "text", "text") IS
  'Phase 11-A. Compare-and-set queued->processing with its generation.processing event in one transaction. Exactly one concurrent caller can win, so exactly one event can exist.';
