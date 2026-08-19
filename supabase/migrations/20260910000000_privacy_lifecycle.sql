-- ===========================================================================
-- PHASE 23 — Privacy, GDPR & Data Lifecycle Architecture
-- ===========================================================================
-- Fills the Phase 23 hooks Phase 9-A left on `media_assets`
-- (`data_class`/`retention_policy`/`legal_hold`/`tombstoned_at` — see that
-- migration's own header: "Politika sahibi Phase 23; uygulama noktası bu
-- Phase'dir") and adds the two new durable tables 23-B/23-C need:
-- `privacy_requests` (a data subject's export/deletion request and its
-- lifecycle) and `deletion_tombstones` (the durable "this account is gone,
-- never reactivate it" record a restore must respect).
--
-- Both new tables follow `admin_privileged_action_events`'s own template
-- (20260829000000_tier0_admin_action_audit.sql) exactly: RLS enabled,
-- service_role-only grants, bounded/regex-checked text columns, no prompt/
-- payload/secret ever stored. `privacy_requests` is a genuinely mutable
-- lifecycle row (a request's status changes as an admin acts on it) rather
-- than an append-only event log — unlike a Tier-0 action's
-- requested/approved/executed history (which the EXISTING
-- admin_privileged_action_events table already owns and this migration
-- reuses unmodified for the dual-control decision itself), a privacy
-- request has exactly one row's worth of state a data subject and an admin
-- both need to read back ("where is my request"), so a second append-only
-- log here would just be a duplicate projection of the same fact.
-- `deletion_tombstones` IS append-only-in-spirit (a tombstone is never
-- un-written), enforced the same way.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 23-A — data_class / retention_policy get real values, not just a column
-- ---------------------------------------------------------------------------
-- The classification VALUES matching the roadmap's own enumeration
-- ("public, internal, personal, sensitive, billing, security/audit") are
-- bounded here so a bad value fails at the schema, not silently accepted as
-- free text. `retention_policy` stays free-ish text (a short policy key, not
-- a duration) because the actual retention MATRIX (purpose/legal basis/
-- owner/retention period per data class) is source-controlled TypeScript
-- (`src/lib/privacy/data-classification.ts`) — the same "golden dataset is
-- code, not a database table" precedent Phase 22 already established for a
-- governance artifact that changes via reviewable PR diff, not a live write.
DO $$
BEGIN
  ALTER TABLE "public"."media_assets" DROP CONSTRAINT IF EXISTS "media_assets_data_class_check";
  ALTER TABLE "public"."media_assets"
    ADD CONSTRAINT "media_assets_data_class_check" CHECK (("data_class" IS NULL OR "data_class" = ANY (ARRAY[
      'public'::"text", 'internal'::"text", 'personal'::"text",
      'sensitive'::"text", 'billing'::"text", 'security_audit'::"text"
    ])));

  ALTER TABLE "public"."media_assets" DROP CONSTRAINT IF EXISTS "media_assets_retention_policy_check";
  ALTER TABLE "public"."media_assets"
    ADD CONSTRAINT "media_assets_retention_policy_check"
      CHECK (("retention_policy" IS NULL OR "retention_policy" ~ '^[a-z][a-z0-9_]{1,64}$'));
END $$;


-- ---------------------------------------------------------------------------
-- privacy_requests — a data subject's export/deletion request, its lifecycle
-- ---------------------------------------------------------------------------
-- A user creates a `pending` row for themselves (self-service — the request
-- itself is not privileged; asking is not the same as it happening). Only an
-- admin, gated by `data.export`/`data.delete` in `policies/data/actions.json`
-- PLUS the Tier-0 dual-control mechanism (both existing, unmodified),
-- transitions it to `processing`/`completed`/`failed`/`rejected` and
-- actually performs the work. `resolved_by` records WHICH admin executed
-- it — never the requester, since `data.export`/`data.delete` require two
-- DISTINCT approvers and the execution audit trail lives in
-- `admin_privileged_action_events` (`target_type = 'privacy_request'`,
-- `target_id = privacy_requests.id`), correlated here by `tier0_request_id`.
CREATE TABLE IF NOT EXISTS "public"."privacy_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "clerk_user_id" "text" NOT NULL,
    "request_type" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,

    -- Correlates to admin_privileged_action_events.request_id once an admin
    -- begins acting on this request — null while still pending.
    "tier0_request_id" "uuid",

    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone,
    "resolved_by" "text",
    "reason_code" "text",

    -- Where an export bundle landed (R2), if this is an export request that
    -- completed. Never the bundle's CONTENT — a pointer only, same
    -- discipline media_assets already uses for its own object_key.
    "export_object_key" "text",
    "export_expires_at" timestamp with time zone,

    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,

    CONSTRAINT "privacy_requests_pkey" PRIMARY KEY ("id"),

    CONSTRAINT "privacy_requests_type_check" CHECK ("request_type" = ANY (ARRAY[
      'export'::"text", 'deletion'::"text"
    ])),
    CONSTRAINT "privacy_requests_status_check" CHECK ("status" = ANY (ARRAY[
      'pending'::"text", 'processing'::"text", 'completed'::"text",
      'failed'::"text", 'rejected'::"text"
    ])),
    CONSTRAINT "privacy_requests_reason_check"
      CHECK ("reason_code" IS NULL OR "reason_code" ~ '^[a-z][a-z0-9_]{1,64}$'),
    CONSTRAINT "privacy_requests_clerk_user_id_check"
      CHECK ("char_length"("clerk_user_id") > 0 AND "char_length"("clerk_user_id") <= 255),
    CONSTRAINT "privacy_requests_resolved_by_check"
      CHECK ("resolved_by" IS NULL OR "char_length"("resolved_by") <= 255),
    -- A resolved row must actually record when/who; an unresolved one must not.
    CONSTRAINT "privacy_requests_resolution_consistency_check" CHECK (
      ("status" = 'pending' AND "resolved_at" IS NULL AND "resolved_by" IS NULL)
      OR ("status" != 'pending' AND "resolved_at" IS NOT NULL AND "resolved_by" IS NOT NULL)
    )
);

ALTER TABLE "public"."privacy_requests" OWNER TO "postgres";

CREATE INDEX IF NOT EXISTS "privacy_requests_clerk_user_idx"
  ON "public"."privacy_requests" ("clerk_user_id", "requested_at" DESC);
CREATE INDEX IF NOT EXISTS "privacy_requests_status_idx"
  ON "public"."privacy_requests" ("status", "requested_at");

ALTER TABLE "public"."privacy_requests" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."privacy_requests" FROM "anon", "authenticated";
GRANT SELECT, INSERT, UPDATE ON TABLE "public"."privacy_requests" TO "service_role";

COMMENT ON TABLE "public"."privacy_requests" IS
  'Phase 23-B. A data subject''s export/deletion request. Created by the user for themselves (self-service, unprivileged); resolved only by an admin through data.export/data.delete (policy-gated + Tier-0 dual-control, both existing/unmodified). No prompt, payload, or export CONTENT stored here — export_object_key is a pointer only.';


-- ---------------------------------------------------------------------------
-- deletion_tombstones — the durable "this account is gone" record
-- ---------------------------------------------------------------------------
-- One row per deleted clerk_user_id, written once by
-- AccountDeletionWorkflow and never updated/deleted afterward (append-only,
-- same mechanism as admin_privileged_action_events). This is 23-C's own
-- "restore re-delete control": any read path that could reactivate a user
-- (a restored backup, a resurrected row) MUST check this table first —
-- `src/lib/privacy/restore-redelete-guard.ts` is that check, reused rather
-- than re-implemented at each call site.
CREATE TABLE IF NOT EXISTS "public"."deletion_tombstones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "clerk_user_id" "text" NOT NULL,
    "tombstoned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reason_code" "text" NOT NULL,
    "requested_by" "text",
    "executed_by" "text" NOT NULL,
    "privacy_request_id" "uuid" REFERENCES "public"."privacy_requests"("id") ON DELETE SET NULL,

    -- True when this account had at least one legal_hold media asset that
    -- was therefore EXCLUDED from the deletion sweep, not erased. Read by
    -- the admin privacy view (23-D) so a hold exception is visible, never
    -- silent.
    "legal_hold_exception" boolean DEFAULT false NOT NULL,

    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,

    CONSTRAINT "deletion_tombstones_pkey" PRIMARY KEY ("id"),
    -- One tombstone per account, ever. A second deletion attempt against an
    -- already-tombstoned user finds this and is a no-op re-confirmation,
    -- never a second row.
    CONSTRAINT "deletion_tombstones_clerk_user_id_key" UNIQUE ("clerk_user_id"),

    CONSTRAINT "deletion_tombstones_reason_check"
      CHECK ("reason_code" ~ '^[a-z][a-z0-9_]{1,64}$'),
    CONSTRAINT "deletion_tombstones_clerk_user_id_check"
      CHECK ("char_length"("clerk_user_id") > 0 AND "char_length"("clerk_user_id") <= 255),
    CONSTRAINT "deletion_tombstones_executed_by_check"
      CHECK ("char_length"("executed_by") > 0 AND "char_length"("executed_by") <= 255),
    CONSTRAINT "deletion_tombstones_requested_by_check"
      CHECK ("requested_by" IS NULL OR "char_length"("requested_by") <= 255)
);

ALTER TABLE "public"."deletion_tombstones" OWNER TO "postgres";

CREATE INDEX IF NOT EXISTS "deletion_tombstones_clerk_user_idx"
  ON "public"."deletion_tombstones" ("clerk_user_id");

CREATE OR REPLACE FUNCTION "public"."deletion_tombstones_append_only"() RETURNS "trigger"
    LANGUAGE "plpgsql" AS $$
BEGIN
  RAISE EXCEPTION 'deletion_tombstones_is_append_only' USING ERRCODE = '23514';
END;
$$;

ALTER FUNCTION "public"."deletion_tombstones_append_only"() OWNER TO "postgres";

DROP TRIGGER IF EXISTS "deletion_tombstones_append_only_trg" ON "public"."deletion_tombstones";
CREATE TRIGGER "deletion_tombstones_append_only_trg"
  BEFORE UPDATE OR DELETE ON "public"."deletion_tombstones"
  FOR EACH ROW EXECUTE FUNCTION "public"."deletion_tombstones_append_only"();

ALTER TABLE "public"."deletion_tombstones" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."deletion_tombstones" FROM "anon", "authenticated";
GRANT SELECT, INSERT ON TABLE "public"."deletion_tombstones" TO "service_role";

COMMENT ON TABLE "public"."deletion_tombstones" IS
  'Phase 23-C. Append-only: one row per deleted account, written once by AccountDeletionWorkflow, never updated. A restore or any resurrection path must check this table before treating a matching clerk_user_id as active — see restore-redelete-guard.ts.';


-- ---------------------------------------------------------------------------
-- create_privacy_request() — the one self-service write a user may make
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so an authenticated caller (RLS would otherwise deny
-- INSERT entirely — see the REVOKE above) can create exactly one row, for
-- exactly their own clerk_user_id, and nothing else. The application layer
-- (`privacy-request-store.ts`) still re-derives clerk_user_id from a
-- verified Clerk session server-side and passes it here — this function
-- trusts its argument, the same contract every other SECURITY DEFINER RPC
-- in this codebase has with its caller.
CREATE OR REPLACE FUNCTION "public"."create_privacy_request"(
    "p_clerk_user_id" "text",
    "p_request_type" "text"
) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_clerk_user_id IS NULL OR "char_length"(p_clerk_user_id) = 0 THEN
    RAISE EXCEPTION 'invalid_clerk_user_id' USING ERRCODE = '22023';
  END IF;
  IF p_request_type NOT IN ('export', 'deletion') THEN
    RAISE EXCEPTION 'invalid_request_type' USING ERRCODE = '22023';
  END IF;

  INSERT INTO privacy_requests (clerk_user_id, request_type)
  VALUES (p_clerk_user_id, p_request_type)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

ALTER FUNCTION "public"."create_privacy_request"("text","text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."create_privacy_request"("text","text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."create_privacy_request"("text","text") TO "service_role";


-- ---------------------------------------------------------------------------
-- resolve_privacy_request() — the one write an admin's execution path makes
-- ---------------------------------------------------------------------------
-- Transitions a `pending` (or `processing`) row to a terminal status.
-- `WHERE status IN ('pending','processing')` makes this idempotent against
-- a retried execution and refuses to silently overwrite an already-terminal
-- request — mirrors complete_model_eval_run()'s own `WHERE status =
-- 'running'` one-way-transition discipline (Phase 22).
CREATE OR REPLACE FUNCTION "public"."resolve_privacy_request"(
    "p_request_id" "uuid",
    "p_status" "text",
    "p_resolved_by" "text",
    "p_tier0_request_id" "uuid" DEFAULT NULL,
    "p_reason_code" "text" DEFAULT NULL,
    "p_export_object_key" "text" DEFAULT NULL,
    "p_export_expires_at" timestamp with time zone DEFAULT NULL
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_status NOT IN ('processing', 'completed', 'failed', 'rejected') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;
  IF p_resolved_by IS NULL OR "char_length"(p_resolved_by) = 0 THEN
    RAISE EXCEPTION 'invalid_resolved_by' USING ERRCODE = '22023';
  END IF;

  UPDATE privacy_requests
     SET status = p_status,
         resolved_at = now(),
         resolved_by = p_resolved_by,
         tier0_request_id = COALESCE(p_tier0_request_id, tier0_request_id),
         reason_code = COALESCE(p_reason_code, reason_code),
         export_object_key = COALESCE(p_export_object_key, export_object_key),
         export_expires_at = COALESCE(p_export_expires_at, export_expires_at),
         updated_at = now()
   WHERE id = p_request_id
     AND status IN ('pending', 'processing');

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

ALTER FUNCTION "public"."resolve_privacy_request"("uuid","text","text","uuid","text","text",timestamp with time zone) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."resolve_privacy_request"("uuid","text","text","uuid","text","text",timestamp with time zone) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."resolve_privacy_request"("uuid","text","text","uuid","text","text",timestamp with time zone) TO "service_role";


-- ---------------------------------------------------------------------------
-- mark_privacy_request_processing() — the transition a lock takes before work starts
-- ---------------------------------------------------------------------------
-- Separate from resolve_privacy_request(): a request enters `processing`
-- the moment an admin's execution attempt begins (so a second, concurrent
-- attempt sees it is already underway), independently of whether that
-- attempt eventually succeeds, fails, or is rejected outright.
CREATE OR REPLACE FUNCTION "public"."mark_privacy_request_processing"(
    "p_request_id" "uuid",
    "p_tier0_request_id" "uuid"
) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE privacy_requests
     SET status = 'processing',
         tier0_request_id = p_tier0_request_id,
         updated_at = now()
   WHERE id = p_request_id
     AND status = 'pending';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

ALTER FUNCTION "public"."mark_privacy_request_processing"("uuid","uuid") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."mark_privacy_request_processing"("uuid","uuid") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."mark_privacy_request_processing"("uuid","uuid") TO "service_role";


-- ---------------------------------------------------------------------------
-- record_deletion_tombstone() — the one, one-time write AccountDeletionWorkflow makes
-- ---------------------------------------------------------------------------
-- ON CONFLICT DO NOTHING against the UNIQUE(clerk_user_id) constraint: a
-- retried or re-triggered deletion for an already-tombstoned account is a
-- safe no-op, never a second tombstone or an error the workflow has to
-- special-case.
CREATE OR REPLACE FUNCTION "public"."record_deletion_tombstone"(
    "p_clerk_user_id" "text",
    "p_reason_code" "text",
    "p_executed_by" "text",
    "p_requested_by" "text" DEFAULT NULL,
    "p_privacy_request_id" "uuid" DEFAULT NULL,
    "p_legal_hold_exception" boolean DEFAULT false
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_clerk_user_id IS NULL OR "char_length"(p_clerk_user_id) = 0 THEN
    RAISE EXCEPTION 'invalid_clerk_user_id' USING ERRCODE = '22023';
  END IF;
  IF p_executed_by IS NULL OR "char_length"(p_executed_by) = 0 THEN
    RAISE EXCEPTION 'invalid_executed_by' USING ERRCODE = '22023';
  END IF;

  INSERT INTO deletion_tombstones
    (clerk_user_id, reason_code, executed_by, requested_by, privacy_request_id, legal_hold_exception)
  VALUES
    (p_clerk_user_id, p_reason_code, p_executed_by, p_requested_by, p_privacy_request_id, p_legal_hold_exception)
  ON CONFLICT (clerk_user_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM deletion_tombstones WHERE clerk_user_id = p_clerk_user_id;
    RETURN jsonb_build_object('created', false, 'tombstone_id', v_id);
  END IF;

  RETURN jsonb_build_object('created', true, 'tombstone_id', v_id);
END;
$$;

ALTER FUNCTION "public"."record_deletion_tombstone"("text","text","text","text","uuid",boolean) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."record_deletion_tombstone"("text","text","text","text","uuid",boolean) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."record_deletion_tombstone"("text","text","text","text","uuid",boolean) TO "service_role";
