-- ===========================================================================
-- PHASE 9-E — the quarantine release lane, and the audit that watches it
-- ===========================================================================
-- 9-B put every asset into quarantine and made `released` unreachable without
-- a passing moderation verdict. Nothing could release one, because nothing
-- could produce that verdict and no release path existed. This migration
-- builds the path — and keeps it just as shut.
--
-- TWO PEOPLE, NOT ONE. The roadmap lists quarantine release among the actions
-- that "tek admin onayıyla çalıştırılamaz": a single administrator may not
-- execute it. So release is a REQUEST that one admin raises and a DIFFERENT
-- admin approves. Implementing a one-click admin release would have been
-- simpler and would have contradicted the roadmap; the approval table below
-- is what makes the rule structural instead of aspirational.
--
-- NO MODERATION OVERRIDE EXISTS, and none is authorised. The roadmap says an
-- object does not reach the production path "validation + moderation
-- tamamlanmadan" — until validation AND moderation are complete. It gives an
-- admin the authority to release a *cleared* asset, never to declare one
-- cleared. Two approvals of an unmoderated asset still cannot release it: the
-- 9-B constraint refuses the row, and the function below refuses it earlier
-- with a reason an operator can read.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- media_safety_audit — durable evidence for every high-risk decision
-- ---------------------------------------------------------------------------
-- Append-only by trigger. A safety decision whose record can be edited is not
-- evidence, and this table exists precisely for the moment somebody asks who
-- released a piece of media and on what basis.
--
-- Phase 16 owns the admin console and the wider audit surface. This is the
-- media-safety slice, shaped so 16 can adopt it rather than replace it.
CREATE TABLE IF NOT EXISTS "public"."media_safety_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_id" "uuid" NOT NULL REFERENCES "public"."media_assets"("id") ON DELETE CASCADE,

    -- The Clerk identity of the human. Never a browser-supplied claim: every
    -- writer of this table is a SECURITY DEFINER function called by the
    -- service role after the server has authenticated the actor.
    "actor_clerk_user_id" "text" NOT NULL,
    "action" "text" NOT NULL,

    -- What changed, so a reader does not have to reconstruct it.
    "prior_quarantine_status" "text",
    "resulting_quarantine_status" "text",
    "prior_moderation_status" "text",

    -- A short CODE. The regex below is what stops a stack trace, a filename or
    -- a signed URL ever landing in an audit row.
    "reason_code" "text",
    "trace_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,

    CONSTRAINT "media_safety_audit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "media_safety_audit_action_check" CHECK (("action" = ANY (ARRAY[
      'release_requested'::"text",
      'release_approved'::"text",
      'release_denied'::"text",
      'rejected'::"text"
    ]))),
    CONSTRAINT "media_safety_audit_reason_check" CHECK (
      ("reason_code" IS NULL) OR ("reason_code" ~ '^[a-z][a-z0-9_]{1,64}$')
    ),
    CONSTRAINT "media_safety_audit_actor_check" CHECK (
      ("char_length"("actor_clerk_user_id") > 0) AND ("char_length"("actor_clerk_user_id") <= 128)
    )
);

ALTER TABLE "public"."media_safety_audit" OWNER TO "postgres";

CREATE INDEX IF NOT EXISTS "media_safety_audit_asset_idx"
  ON "public"."media_safety_audit" ("asset_id", "created_at" DESC);

-- Append-only. Not a convention — a trigger, because the value of an audit
-- log is exactly its inability to be tidied up afterwards.
CREATE OR REPLACE FUNCTION "public"."media_safety_audit_append_only"() RETURNS "trigger"
    LANGUAGE "plpgsql" AS $$
BEGIN
  RAISE EXCEPTION 'media_safety_audit_is_append_only' USING ERRCODE = '23514';
END;
$$;

ALTER FUNCTION "public"."media_safety_audit_append_only"() OWNER TO "postgres";

DROP TRIGGER IF EXISTS "media_safety_audit_append_only_trg" ON "public"."media_safety_audit";
CREATE TRIGGER "media_safety_audit_append_only_trg"
  BEFORE UPDATE OR DELETE ON "public"."media_safety_audit"
  FOR EACH ROW EXECUTE FUNCTION "public"."media_safety_audit_append_only"();


-- ---------------------------------------------------------------------------
-- media_release_approvals — the two-person mechanism
-- ---------------------------------------------------------------------------
-- One row per (asset, approver). The primary key is what makes "two people"
-- real: the same administrator approving twice writes the same row and
-- changes nothing, so a second DISTINCT human is the only way to reach two.
CREATE TABLE IF NOT EXISTS "public"."media_release_approvals" (
    "asset_id" "uuid" NOT NULL REFERENCES "public"."media_assets"("id") ON DELETE CASCADE,
    "approver_clerk_user_id" "text" NOT NULL,
    "reason_code" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,

    CONSTRAINT "media_release_approvals_pkey" PRIMARY KEY ("asset_id", "approver_clerk_user_id"),
    CONSTRAINT "media_release_approvals_reason_check" CHECK (
      ("reason_code" IS NULL) OR ("reason_code" ~ '^[a-z][a-z0-9_]{1,64}$')
    )
);

ALTER TABLE "public"."media_release_approvals" OWNER TO "postgres";

-- Required approvals. Two, from the roadmap's two-person rule. A constant in
-- one place so the rule is auditable rather than scattered.
CREATE OR REPLACE FUNCTION "public"."media_release_required_approvals"() RETURNS integer
    LANGUAGE "sql" IMMUTABLE AS $$ SELECT 2 $$;

ALTER FUNCTION "public"."media_release_required_approvals"() OWNER TO "postgres";


-- ---------------------------------------------------------------------------
-- Access control — server only, and read-only even for the owner
-- ---------------------------------------------------------------------------
-- An owner may see that their asset exists (media_assets already allows that)
-- but not who reviewed it or why: approver identities and reason codes are
-- operational security data, not product surface.
ALTER TABLE "public"."media_safety_audit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."media_release_approvals" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."media_safety_audit" FROM "anon", "authenticated";
REVOKE ALL ON TABLE "public"."media_release_approvals" FROM "anon", "authenticated";
GRANT SELECT, INSERT ON TABLE "public"."media_safety_audit" TO "service_role";
GRANT SELECT, INSERT, DELETE ON TABLE "public"."media_release_approvals" TO "service_role";


-- ---------------------------------------------------------------------------
-- request_media_release() — the first of two hands
-- ---------------------------------------------------------------------------
-- Records one administrator's approval and returns how many the asset now
-- has. It does NOT release: reaching the threshold is checked by
-- approve_media_release, so a caller cannot conflate "I approved" with "it is
-- out".
CREATE OR REPLACE FUNCTION "public"."request_media_release"(
    "p_asset_id" "uuid",
    "p_actor" "text",
    "p_reason_code" "text" DEFAULT NULL
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_row media_assets%ROWTYPE;
  v_count integer;
BEGIN
  IF p_actor IS NULL OR "char_length"(p_actor) = 0 THEN
    RAISE EXCEPTION 'invalid_actor' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM media_assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'not_found');
  END IF;

  -- Rejected is terminal for the normal lane. Collecting approvals on it would
  -- imply a reopen flow, and the roadmap defines none.
  IF v_row.quarantine_status = 'released' THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'already_released');
  END IF;
  IF v_row.ingest_status = 'rejected' THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'asset_rejected');
  END IF;

  INSERT INTO media_release_approvals (asset_id, approver_clerk_user_id, reason_code)
  VALUES (p_asset_id, p_actor, p_reason_code)
  ON CONFLICT ("asset_id", "approver_clerk_user_id") DO NOTHING;

  SELECT count(*) INTO v_count FROM media_release_approvals WHERE asset_id = p_asset_id;

  INSERT INTO media_safety_audit
    (asset_id, actor_clerk_user_id, action, prior_quarantine_status,
     resulting_quarantine_status, prior_moderation_status, reason_code)
  VALUES (p_asset_id, p_actor, 'release_requested', v_row.quarantine_status,
          v_row.quarantine_status, v_row.moderation_status, p_reason_code);

  RETURN jsonb_build_object(
    'recorded', true,
    'approvals', v_count,
    'required', media_release_required_approvals()
  );
END;
$$;

ALTER FUNCTION "public"."request_media_release"("uuid", "text", "text") OWNER TO "postgres";


-- ---------------------------------------------------------------------------
-- approve_media_release() — the transition, with every precondition
-- ---------------------------------------------------------------------------
-- THE only way an asset leaves quarantine. Every refusal returns a reason
-- code rather than a boolean, because "it did not release" is useless to an
-- operator who needs to know which piece of evidence is missing.
--
-- The state change and its outbox event share this transaction. A released
-- asset without its event, or an event without the release, are both states
-- the rest of the system would have to guess about.
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

  -- Replay: already out. Reported as not-released with a reason, and no
  -- second event is emitted.
  IF v_row.quarantine_status = 'released' THEN
    RETURN jsonb_build_object('released', false, 'reason', 'already_released',
                              'quarantine_status', v_row.quarantine_status);
  END IF;

  -- ---- Evidence, in the order an operator would check it -----------------
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

  -- THE ONE THAT CANNOT BE ARGUED WITH. not_evaluated, pending,
  -- manual_review and error are all "moderation has not said yes", and an
  -- administrator's opinion does not substitute for it.
  IF v_row.moderation_status NOT IN ('passed', 'approved') THEN
    RETURN jsonb_build_object('released', false, 'reason', 'moderation_not_passed',
                              'moderation_status', v_row.moderation_status);
  END IF;

  -- ---- Two people --------------------------------------------------------
  -- The approving admin counts, but only once: the primary key on
  -- (asset, approver) means one human cannot reach the threshold alone.
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

  -- Same transaction as the UPDATE. If this raises, the release rolls back
  -- with it — which is the entire point.
  v_event_id := emit_outbox_event(
    'media.asset.released', 1, 'media_asset', p_asset_id::text,
    jsonb_strip_nulls(jsonb_build_object('assetId', p_asset_id::text)),
    p_trace_id, NULL
  );

  RETURN jsonb_build_object('released', true, 'asset_id', p_asset_id, 'event_id', v_event_id);
END;
$$;

ALTER FUNCTION "public"."approve_media_release"("uuid", "text", "text", "text") OWNER TO "postgres";


-- ---------------------------------------------------------------------------
-- reject_media_asset() — the other terminal
-- ---------------------------------------------------------------------------
-- Single-admin, deliberately: the two-person rule exists to make releasing
-- media harder, not to make refusing it harder. Rejection is the safe
-- direction and requiring a second signature would only delay it.
--
-- Terminal for the normal lane. The roadmap defines no appeal or reopen flow,
-- so none is invented here.
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

  -- Replay is inert.
  IF v_row.ingest_status = 'rejected' AND v_row.moderation_status = 'rejected' THEN
    RETURN jsonb_build_object('rejected', false, 'reason', 'already_rejected');
  END IF;

  -- Released media is out in the world; pulling it back is a takedown, which
  -- is a retention/legal operation (Phase 23), not a moderation reject.
  IF v_row.quarantine_status = 'released' THEN
    RETURN jsonb_build_object('rejected', false, 'reason', 'already_released');
  END IF;

  UPDATE media_assets
     SET moderation_status = 'rejected',
         ingest_status = 'rejected',
         ingest_failure_reason = COALESCE(p_reason_code, ingest_failure_reason),
         moderated_at = now()
   WHERE id = p_asset_id;

  -- Approvals collected before the rejection are void: they were opinions
  -- about an asset that is now refused, and leaving them would let a later
  -- reopen inherit consent nobody gave.
  DELETE FROM media_release_approvals WHERE asset_id = p_asset_id;

  INSERT INTO media_safety_audit
    (asset_id, actor_clerk_user_id, action, prior_quarantine_status,
     resulting_quarantine_status, prior_moderation_status, reason_code, trace_id)
  VALUES (p_asset_id, p_actor, 'rejected', v_row.quarantine_status,
          v_row.quarantine_status, v_row.moderation_status, p_reason_code, p_trace_id);

  v_event_id := emit_outbox_event(
    'media.asset.rejected', 1, 'media_asset', p_asset_id::text,
    jsonb_strip_nulls(jsonb_build_object('assetId', p_asset_id::text)),
    p_trace_id, NULL
  );

  RETURN jsonb_build_object('rejected', true, 'asset_id', p_asset_id, 'event_id', v_event_id);
END;
$$;

ALTER FUNCTION "public"."reject_media_asset"("uuid", "text", "text", "text") OWNER TO "postgres";


-- ---------------------------------------------------------------------------
-- Function grants — service_role only
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION "public"."request_media_release"("uuid", "text", "text") FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."approve_media_release"("uuid", "text", "text", "text") FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."reject_media_asset"("uuid", "text", "text", "text") FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."media_release_required_approvals"() FROM PUBLIC, "anon", "authenticated";

GRANT EXECUTE ON FUNCTION "public"."request_media_release"("uuid", "text", "text") TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."approve_media_release"("uuid", "text", "text", "text") TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."reject_media_asset"("uuid", "text", "text", "text") TO "service_role";
GRANT EXECUTE ON FUNCTION "public"."media_release_required_approvals"() TO "service_role";


COMMENT ON TABLE "public"."media_safety_audit" IS
  'Phase 9-E. Append-only evidence for every media safety decision: who, what, from which state, to which state, and a short reason CODE. Never a prompt, a signed URL, a payload or a secret. Shaped for Phase 16 to adopt.';
COMMENT ON TABLE "public"."media_release_approvals" IS
  'Phase 9-E. Two-person approval for quarantine release, which the roadmap lists among the actions that may not run on a single admin''s signature. PRIMARY KEY (asset, approver) is the mechanism: one human approving twice is still one approval.';
