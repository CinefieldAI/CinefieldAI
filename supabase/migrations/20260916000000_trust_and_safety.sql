-- ===========================================================================
-- PHASE 28 — Trust & Safety / content moderation hardening
-- ===========================================================================
-- Phase 9-B built the ingest gate and left `moderation_status` at
-- `not_evaluated` because no engine existed. Phase 9-E built the quarantine
-- lane and the two-person release. Both were honest about what they could not
-- do, and the consequence was that NOTHING could ever become deliverable:
-- `media_assets_release_requires_checks` demands `passed`, and no code path
-- could produce it.
--
-- This migration adds the two things that were missing, and nothing else:
--
--   1. media_safety_decisions — durable, bounded evidence for every safety
--      decision, at the PROMPT stage (where no asset exists yet) and at the
--      OUTPUT stage (per media asset, per output index).
--
--   2. release_media_after_moderation() — the automated release for an asset a
--      classifier actually cleared. This is the normal lifecycle, not an
--      override: it can reach `released` ONLY from `moderation_status =
--      'passed'`, and it cannot touch anything a human would have to decide.
--
-- WHAT THIS MIGRATION DOES NOT DO
-- -------------------------------
-- It creates no second moderation system, no second incident store, no second
-- delivery authority and no second provenance table. `media_safety_audit`
-- remains the quarantine-transition trail, `security_events` remains the
-- incident evidence owner, `media_provenance` remains Phase 27's.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- media_safety_decisions — what was decided, by whom, on what basis
-- ---------------------------------------------------------------------------
-- WHY A NEW TABLE RATHER THAN COLUMNS ON media_assets
-- A prompt-stage decision has NO asset: gate B runs before the generation row
-- exists, let alone an asset. And an asset can be decided about more than once
-- (a classifier, then a provider signal, then a human on appeal), so a single
-- column per asset would overwrite the history that 28-D's appeal flow exists
-- to read. This is an append-only decision LOG, which is what the roadmap
-- means by "appeal ve kararlar audit'leniyor".
--
-- WHY clerk_user_id IS HERE, WHEN media_provenance DELIBERATELY OMITTED IT
-- Phase 27 could omit it because every provenance row joins to an asset that
-- carries the owner. A prompt-stage decision has no such row to join through,
-- and 28-C's repeat-offender requirement is a question ABOUT A USER that must
-- survive the deletion of the generations it came from. Recorded here, in the
-- Phase 23 classification matrix, as security_audit / legal_obligation /
-- retain_immutable — the same posture as credit_ledger and deletion_tombstones.
CREATE TABLE IF NOT EXISTS "public"."media_safety_decisions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,

    -- The subject of the decision. Never a browser claim: every writer is a
    -- SECURITY DEFINER function called by the service role after the server
    -- has authenticated the actor.
    "clerk_user_id" "text" NOT NULL,

    -- SET NULL, not CASCADE, and deliberately. A safety decision — especially
    -- a zero-tolerance one — must outlive the generation and the asset it was
    -- about. CASCADE would let deleting the evidence delete the finding.
    "generation_id" "uuid" REFERENCES "public"."generations"("id") ON DELETE SET NULL,
    "media_asset_id" "uuid" REFERENCES "public"."media_assets"("id") ON DELETE SET NULL,

    -- Which output of a multi-output generation. NULL at the prompt stage,
    -- where there is no output yet. Phase 27/9 widened asset identity to
    -- (generation_id, output_index); safety decisions address the same
    -- identity so a per-output decision is representable rather than inferred.
    "output_index" integer,

    "decision_stage" "text" NOT NULL,
    "verdict" "text" NOT NULL,

    -- Bounded vocabulary, enforced by containment rather than by convention.
    "risk_categories" "text"[] DEFAULT '{}'::"text"[] NOT NULL,

    -- A short CODE. This regex is what stops a matched term, a filename, a
    -- stack trace or a fragment of the prompt from ever landing in a row.
    "reason_code" "text" NOT NULL,

    "policy_version" "text" NOT NULL,
    "classifier_version" "text",

    -- ---- THE PROVIDER'S OPINION, KEPT SEPARATE FROM CINEFIELD'S -----------
    -- REFERANS M.1 calls provider moderation "Kapı A" and says plainly not to
    -- trust it. Folding it into `verdict` would destroy the only evidence that
    -- can later answer "did the vendor drift?" — so it lives in its own
    -- columns and is never the basis of a delivery decision on its own.
    "provider_signal_source" "text" DEFAULT 'none'::"text" NOT NULL,
    "provider_signal_flagged" boolean,
    "provider_signal_reason" "text",

    -- What the known-hash lane concluded. `not_configured` is a first-class
    -- value precisely because it must never be readable as "no match".
    "hash_check_outcome" "text" DEFAULT 'not_configured'::"text" NOT NULL,

    -- Whether a mandatory report is owed, and whether one was actually filed.
    -- `submitted` is reachable only through a real reporting provider.
    "mandatory_report_state" "text" DEFAULT 'not_required'::"text" NOT NULL,

    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,

    CONSTRAINT "media_safety_decisions_pkey" PRIMARY KEY ("id"),

    CONSTRAINT "media_safety_decisions_stage_check" CHECK (("decision_stage" = ANY (ARRAY[
      'prompt'::"text",
      'reference_input'::"text",
      'output'::"text"
    ]))),

    -- Exactly the TypeScript `SafetyVerdict` union. One vocabulary, never two.
    CONSTRAINT "media_safety_decisions_verdict_check" CHECK (("verdict" = ANY (ARRAY[
      'ALLOW'::"text",
      'BLOCK'::"text",
      'REVIEW_REQUIRED'::"text",
      'NOT_CONFIGURED'::"text",
      'UNAVAILABLE'::"text",
      'MALFORMED_RESULT'::"text"
    ]))),

    -- Containment: every element must be a known category. An unrecognised
    -- one is refused at the storage layer rather than stored and puzzled over.
    CONSTRAINT "media_safety_decisions_categories_check" CHECK (
      "risk_categories" <@ ARRAY[
        'csam'::"text",
        'ncii'::"text",
        'real_person'::"text",
        'deepfake'::"text",
        'sexual_content'::"text",
        'illegal_content'::"text",
        'violence'::"text",
        'self_harm'::"text",
        'unclassified'::"text"
      ]
    ),

    CONSTRAINT "media_safety_decisions_reason_check" CHECK (
      "reason_code" ~ '^[a-z][a-z0-9_]{1,64}$'
    ),

    CONSTRAINT "media_safety_decisions_provider_source_check" CHECK (("provider_signal_source" = ANY (ARRAY[
      'cinefield_classifier'::"text",
      'provider_native'::"text",
      'hash_match_provider'::"text",
      'human_review'::"text",
      'none'::"text"
    ]))),

    CONSTRAINT "media_safety_decisions_provider_reason_check" CHECK (
      ("provider_signal_reason" IS NULL) OR ("provider_signal_reason" ~ '^[a-z][a-z0-9_]{1,64}$')
    ),

    CONSTRAINT "media_safety_decisions_hash_outcome_check" CHECK (("hash_check_outcome" = ANY (ARRAY[
      'positive_match'::"text",
      'no_match'::"text",
      'not_configured'::"text",
      'provider_unavailable'::"text",
      'malformed_result'::"text"
    ]))),

    CONSTRAINT "media_safety_decisions_report_state_check" CHECK (("mandatory_report_state" = ANY (ARRAY[
      'not_required'::"text",
      'reporting_not_configured'::"text",
      'report_required'::"text",
      'report_submitted'::"text",
      'report_failed'::"text"
    ]))),

    -- Same bound as media_assets.output_index. A storage-layer backstop, not a
    -- policy: capability-validator.ts still owns the real ceiling.
    CONSTRAINT "media_safety_decisions_output_index_check" CHECK (
      ("output_index" IS NULL) OR (("output_index" >= 0) AND ("output_index" <= 99))
    ),

    -- An output-stage decision is ABOUT an asset. Without this a row could
    -- claim to have evaluated an output while naming none.
    CONSTRAINT "media_safety_decisions_output_needs_asset" CHECK (
      ("decision_stage" <> 'output'::"text") OR ("media_asset_id" IS NOT NULL)
    ),

    CONSTRAINT "media_safety_decisions_actor_check" CHECK (
      ("char_length"("clerk_user_id") > 0) AND ("char_length"("clerk_user_id") <= 128)
    ),

    CONSTRAINT "media_safety_decisions_classifier_version_check" CHECK (
      ("classifier_version" IS NULL) OR ("char_length"("classifier_version") <= 64)
    )
);

ALTER TABLE "public"."media_safety_decisions" OWNER TO "postgres";

-- Repeat-offender counting (28-C): "this user, blocked, since when".
CREATE INDEX IF NOT EXISTS "media_safety_decisions_offender_idx"
  ON "public"."media_safety_decisions" ("clerk_user_id", "created_at" DESC)
  WHERE ("verdict" = 'BLOCK'::"text");

-- The admin review queue (28-D): everything awaiting a human, newest first.
CREATE INDEX IF NOT EXISTS "media_safety_decisions_review_queue_idx"
  ON "public"."media_safety_decisions" ("created_at" DESC)
  WHERE ("verdict" = 'REVIEW_REQUIRED'::"text");

-- One asset's decision history, for the review item and the appeal.
CREATE INDEX IF NOT EXISTS "media_safety_decisions_asset_idx"
  ON "public"."media_safety_decisions" ("media_asset_id", "created_at" DESC)
  WHERE ("media_asset_id" IS NOT NULL);

-- Append-only. A trigger, not a convention — the same reasoning
-- media_safety_audit already states: the value of a decision log is exactly
-- its inability to be tidied up afterwards.
CREATE OR REPLACE FUNCTION "public"."media_safety_decisions_append_only"() RETURNS "trigger"
    LANGUAGE "plpgsql" AS $$
BEGIN
  RAISE EXCEPTION 'media_safety_decisions_is_append_only' USING ERRCODE = '23514';
END;
$$;

ALTER FUNCTION "public"."media_safety_decisions_append_only"() OWNER TO "postgres";

DROP TRIGGER IF EXISTS "media_safety_decisions_append_only_trg" ON "public"."media_safety_decisions";
CREATE TRIGGER "media_safety_decisions_append_only_trg"
  BEFORE UPDATE OR DELETE ON "public"."media_safety_decisions"
  FOR EACH ROW EXECUTE FUNCTION "public"."media_safety_decisions_append_only"();


-- ---------------------------------------------------------------------------
-- Access control — server only, including for the subject
-- ---------------------------------------------------------------------------
-- A user may not read the decisions made about them. Reason codes and
-- categories describe how the classifier reasons, and REFERANS M.1 is explicit
-- that a refusal must not teach the bypass: "Reddederken NASIL atlatılacağını
-- anlatma ... Aksi halde filtreni kendi ellerinle öğretmiş olursun."
ALTER TABLE "public"."media_safety_decisions" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."media_safety_decisions" FROM "anon", "authenticated";
GRANT SELECT, INSERT ON TABLE "public"."media_safety_decisions" TO "service_role";


-- ---------------------------------------------------------------------------
-- record_safety_decision() — the ONLY way a decision enters the database
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."record_safety_decision"(
    "p_clerk_user_id" "text",
    "p_decision_stage" "text",
    "p_verdict" "text",
    "p_reason_code" "text",
    "p_policy_version" "text",
    "p_generation_id" "uuid" DEFAULT NULL,
    "p_media_asset_id" "uuid" DEFAULT NULL,
    "p_output_index" integer DEFAULT NULL,
    "p_risk_categories" "text"[] DEFAULT '{}'::"text"[],
    "p_classifier_version" "text" DEFAULT NULL,
    "p_provider_signal_source" "text" DEFAULT 'none',
    "p_provider_signal_flagged" boolean DEFAULT NULL,
    "p_provider_signal_reason" "text" DEFAULT NULL,
    "p_hash_check_outcome" "text" DEFAULT 'not_configured',
    "p_mandatory_report_state" "text" DEFAULT 'not_required'
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO media_safety_decisions (
    clerk_user_id, generation_id, media_asset_id, output_index,
    decision_stage, verdict, risk_categories, reason_code,
    policy_version, classifier_version,
    provider_signal_source, provider_signal_flagged, provider_signal_reason,
    hash_check_outcome, mandatory_report_state
  ) VALUES (
    p_clerk_user_id, p_generation_id, p_media_asset_id, p_output_index,
    p_decision_stage, p_verdict, COALESCE(p_risk_categories, '{}'::text[]), p_reason_code,
    p_policy_version, p_classifier_version,
    COALESCE(p_provider_signal_source, 'none'), p_provider_signal_flagged, p_provider_signal_reason,
    COALESCE(p_hash_check_outcome, 'not_configured'), COALESCE(p_mandatory_report_state, 'not_required')
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('recorded', true, 'decision_id', v_id);
END;
$$;

ALTER FUNCTION "public"."record_safety_decision"("text", "text", "text", "text", "text", "uuid", "uuid", integer, "text"[], "text", "text", boolean, "text", "text", "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."record_safety_decision"("text", "text", "text", "text", "text", "uuid", "uuid", integer, "text"[], "text", "text", boolean, "text", "text", "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."record_safety_decision"("text", "text", "text", "text", "text", "uuid", "uuid", integer, "text"[], "text", "text", boolean, "text", "text", "text") TO "service_role";


-- ---------------------------------------------------------------------------
-- The audit trail gains the automated and appeal transitions
-- ---------------------------------------------------------------------------
-- `media_safety_audit` stays the ONE trail for quarantine-state changes. The
-- new actions are named apart from the human ones on purpose: an automated
-- release must never be indistinguishable from `release_approved`, which
-- carries the weight of two named administrators.
ALTER TABLE "public"."media_safety_audit" DROP CONSTRAINT IF EXISTS "media_safety_audit_action_check";
ALTER TABLE "public"."media_safety_audit"
  ADD CONSTRAINT "media_safety_audit_action_check" CHECK (("action" = ANY (ARRAY[
    'release_requested'::"text",
    'release_approved'::"text",
    'release_denied'::"text",
    'rejected'::"text",
    -- Phase 28. Automated, from a classifier verdict of `passed` only.
    'auto_released'::"text",
    -- Phase 28. The owner asked for a human to look. Releases nothing.
    'appeal_requested'::"text",
    'appeal_reviewed'::"text"
  ])));


-- ---------------------------------------------------------------------------
-- release_media_after_moderation() — the NORMAL lifecycle, not an override
-- ---------------------------------------------------------------------------
-- WHY THIS IS NOT A WEAKENING OF PHASE 9-E
-- Phase 9-E's two-person rule exists so that a HUMAN cannot single-handedly
-- release media, and its own header says exactly what it is guarding: "An
-- admin has authority to release a CLEARED asset, never to declare one
-- cleared." This function releases only assets a classifier has ALREADY
-- cleared. It declares nothing.
--
-- Three properties make that structural rather than aspirational:
--
--   `passed` ONLY. Not `approved` — that value belongs to the human lane, and
--   consuming it here would let an automated path finish a job two
--   administrators started.
--
--   No actor parameter. There is no argument through which a human identity
--   could be supplied, so this can never be used to launder an admin decision.
--
--   Every other release precondition from approve_media_release is repeated
--   verbatim. This is a narrower gate than the human one, never a wider one.
CREATE OR REPLACE FUNCTION "public"."release_media_after_moderation"(
    "p_asset_id" "uuid",
    "p_trace_id" "text" DEFAULT NULL
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_row media_assets%ROWTYPE;
  v_event_id uuid;
BEGIN
  SELECT * INTO v_row FROM media_assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('released', false, 'reason', 'not_found');
  END IF;

  IF v_row.quarantine_status = 'released' THEN
    RETURN jsonb_build_object('released', false, 'reason', 'already_released');
  END IF;
  IF v_row.quarantine_status = 'rejected' THEN
    RETURN jsonb_build_object('released', false, 'reason', 'asset_rejected');
  END IF;
  IF v_row.tombstoned_at IS NOT NULL THEN
    RETURN jsonb_build_object('released', false, 'reason', 'asset_tombstoned');
  END IF;

  -- THE ONE THAT CANNOT BE ARGUED WITH, and it is stricter here than in the
  -- human lane: `approved` is excluded.
  IF v_row.moderation_status <> 'passed' THEN
    RETURN jsonb_build_object('released', false, 'reason', 'moderation_not_passed',
                              'moderation_status', v_row.moderation_status);
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

  UPDATE media_assets SET quarantine_status = 'released' WHERE id = p_asset_id;

  -- A reserved, non-Clerk actor. It is deliberately shaped so it can never
  -- collide with a real Clerk user id, and so a reader of the trail can tell
  -- an automated release from a human one at a glance.
  INSERT INTO media_safety_audit
    (asset_id, actor_clerk_user_id, action, prior_quarantine_status,
     resulting_quarantine_status, prior_moderation_status, reason_code, trace_id)
  VALUES (p_asset_id, 'system:phase28_moderation', 'auto_released', v_row.quarantine_status,
          'released', v_row.moderation_status, 'automated_moderation_pass', p_trace_id);

  -- Same transaction as the UPDATE, exactly as approve_media_release does. If
  -- this raises, the release rolls back with it.
  --
  -- CANONICAL FAMILY. `media.asset.released` was retired by Phase 11-A's event
  -- contract (20260824000000) in favour of `asset.released`, and the
  -- three-segment form no longer resolves through the TypeScript contract at
  -- all. The automated lane emits the SAME event as the human lane, so a
  -- consumer cannot tell — and does not need to tell — which released it; the
  -- audit trail is where that distinction lives.
  v_event_id := emit_outbox_event(
    'asset.released', 1, 'media_asset', p_asset_id::text,
    jsonb_strip_nulls(jsonb_build_object('assetId', p_asset_id::text)),
    p_trace_id
  );

  RETURN jsonb_build_object('released', true, 'asset_id', p_asset_id, 'event_id', v_event_id);
END;
$$;

ALTER FUNCTION "public"."release_media_after_moderation"("uuid", "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."release_media_after_moderation"("uuid", "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."release_media_after_moderation"("uuid", "text") TO "service_role";


-- ---------------------------------------------------------------------------
-- request_media_appeal() — 28-D, and it releases NOTHING
-- ---------------------------------------------------------------------------
-- The roadmap asks for "İnsan incelemeli appeal akışı" — a human-reviewed
-- appeal — and Phase 9-E recorded honestly that it had none: "the roadmap
-- defines no appeal or reopen flow, so none exists here."
--
-- This is the smallest correct one. An appeal is a REQUEST for a human to
-- look, recorded in the same append-only trail as every other decision about
-- the asset. It changes no quarantine state, sets no moderation status, and
-- has no path to `released`: the only way out remains the two-person human
-- lane, which is exactly what "appeal must not automatically release content"
-- requires.
CREATE OR REPLACE FUNCTION "public"."request_media_appeal"(
    "p_asset_id" "uuid",
    "p_owner_clerk_user_id" "text",
    "p_reason_code" "text" DEFAULT NULL
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_row media_assets%ROWTYPE;
  v_existing integer;
BEGIN
  IF p_owner_clerk_user_id IS NULL OR char_length(p_owner_clerk_user_id) = 0
     OR char_length(p_owner_clerk_user_id) > 128 THEN
    RAISE EXCEPTION 'invalid_actor' USING ERRCODE = '22023';
  END IF;
  IF p_reason_code IS NOT NULL AND p_reason_code !~ '^[a-z][a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'invalid_reason_code' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM media_assets WHERE id = p_asset_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'not_found');
  END IF;

  -- Ownership is checked HERE, against the durable row, rather than trusted
  -- from the caller — the same rule the asset-url route follows. A non-owner
  -- gets `not_found`: whether an asset id exists is itself information.
  IF v_row.clerk_user_id IS DISTINCT FROM p_owner_clerk_user_id THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'not_found');
  END IF;

  -- Nothing to appeal. Released media is already deliverable, and offering an
  -- appeal for it would create a queue item no reviewer can act on.
  IF v_row.quarantine_status = 'released' THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'already_released');
  END IF;

  -- One open appeal at a time. Without this a user could fill the review queue
  -- with identical rows for one asset, which is a denial of service against
  -- the humans the queue exists to route work to.
  SELECT count(*) INTO v_existing
    FROM media_safety_audit
   WHERE asset_id = p_asset_id
     AND action = 'appeal_requested'
     AND created_at > (
       SELECT COALESCE(max(created_at), '-infinity'::timestamptz)
         FROM media_safety_audit
        WHERE asset_id = p_asset_id AND action = 'appeal_reviewed'
     );

  IF v_existing > 0 THEN
    RETURN jsonb_build_object('recorded', false, 'reason', 'appeal_already_open');
  END IF;

  INSERT INTO media_safety_audit
    (asset_id, actor_clerk_user_id, action, prior_quarantine_status,
     resulting_quarantine_status, prior_moderation_status, reason_code, trace_id)
  VALUES (p_asset_id, p_owner_clerk_user_id, 'appeal_requested', v_row.quarantine_status,
          v_row.quarantine_status, v_row.moderation_status,
          COALESCE(p_reason_code, 'owner_disputes_decision'), NULL);

  RETURN jsonb_build_object('recorded', true, 'asset_id', p_asset_id);
END;
$$;

ALTER FUNCTION "public"."request_media_appeal"("uuid", "text", "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."request_media_appeal"("uuid", "text", "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."request_media_appeal"("uuid", "text", "text") TO "service_role";


COMMENT ON TABLE "public"."media_safety_decisions" IS
  'Phase 28. Append-only Trust & Safety decision log: prompt-stage and per-output decisions, with Cinefield''s verdict and the provider''s native signal in SEPARATE columns so provider drift stays answerable. Never a prompt, media bytes, provider payload, signed URL, object key or secret.';
COMMENT ON FUNCTION "public"."release_media_after_moderation"("uuid", "text") IS
  'Phase 28. Automated quarantine release for an asset a classifier already cleared (moderation_status = passed ONLY, never approved). Takes no actor: it cannot be used to launder a human decision, and Phase 9-E''s two-person lane remains the only way to release anything a classifier did not clear.';
COMMENT ON FUNCTION "public"."request_media_appeal"("uuid", "text", "text") IS
  'Phase 28-D. Records an owner''s request for human review. Changes no quarantine or moderation state and has no path to released — the two-person human lane remains the only way out.';
