-- ===========================================================================
-- PHASE 25-C — Secret rotation lifecycle
-- ===========================================================================
-- Roadmap 25-C done-criterion: "Rotation kesintisiz test ediliyor" —
-- rotation is tested without interruption. `secret_rotations` is the
-- durable, VALUE-FREE current-state row per (secret_name, environment) —
-- never the secret itself. Mirrors `privacy_requests`'s own template
-- (20260910000000_privacy_lifecycle.sql): a genuinely mutable lifecycle row
-- a state machine transitions, not an append-only event log. The event
-- trail for WHO approved/executed a rotation already exists
-- (admin_privileged_action_events, correlated here by tier0_request_id) —
-- this table answers "what is secret X's rotation state right now", which
-- an event log alone cannot answer without replaying every event.
--
-- NO VALUE COLUMN EXISTS OR EVER WILL. `current_version_ref`/
-- `previous_version_ref` are opaque provider-assigned version ids (AWS
-- Secrets Manager version UUIDs) — never a secret value, matching
-- secret-registry.ts's own "NAMES ONLY" discipline.
-- ===========================================================================


CREATE TABLE IF NOT EXISTS "public"."secret_rotations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "secret_name" "text" NOT NULL,
    "environment" "text" NOT NULL,
    "owner" "text" NOT NULL,
    "rotation_class" "text" NOT NULL,
    "state" "text" DEFAULT 'NOT_CONFIGURED'::"text" NOT NULL,

    -- Opaque provider version identifiers. Never a value — see header.
    "current_version_ref" "text",
    "previous_version_ref" "text",

    "rotated_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "verified_at" timestamp with time zone,
    "reason_code" "text" NOT NULL,

    -- Correlates to admin_privileged_action_events.request_id — the WHO/
    -- approval trail lives there, unmodified, same pattern privacy_requests
    -- already established.
    "tier0_request_id" "uuid",

    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,

    CONSTRAINT "secret_rotations_pkey" PRIMARY KEY ("id"),
    -- One current-state row per secret per environment, ever.
    CONSTRAINT "secret_rotations_secret_env_key" UNIQUE ("secret_name", "environment"),

    CONSTRAINT "secret_rotations_environment_check" CHECK ("environment" = ANY (ARRAY[
      'development'::"text", 'staging'::"text", 'production'::"text"
    ])),
    CONSTRAINT "secret_rotations_rotation_class_check" CHECK ("rotation_class" = ANY (ARRAY[
      'DUAL_KEY_OVERLAP'::"text", 'CUT_OVER'::"text", 'MANAGED_ROTATION'::"text", 'NOT_A_SECRET'::"text"
    ])),
    CONSTRAINT "secret_rotations_state_check" CHECK ("state" = ANY (ARRAY[
      'NOT_CONFIGURED'::"text", 'ROTATION_REQUIRED'::"text", 'ROTATING'::"text",
      'VERIFYING'::"text", 'ACTIVE'::"text", 'ROLLBACK_AVAILABLE'::"text",
      'FAILED'::"text", 'EXPIRED'::"text"
    ])),
    CONSTRAINT "secret_rotations_secret_name_check"
      CHECK ("char_length"("secret_name") > 0 AND "char_length"("secret_name") <= 128),
    CONSTRAINT "secret_rotations_owner_check"
      CHECK ("char_length"("owner") > 0 AND "char_length"("owner") <= 128),
    CONSTRAINT "secret_rotations_reason_check"
      CHECK ("reason_code" ~ '^[a-z][a-z0-9_]{1,64}$'),
    CONSTRAINT "secret_rotations_version_ref_check"
      CHECK (("current_version_ref" IS NULL OR "char_length"("current_version_ref") <= 128)
         AND ("previous_version_ref" IS NULL OR "char_length"("previous_version_ref") <= 128))
);

ALTER TABLE "public"."secret_rotations" OWNER TO "postgres";

CREATE INDEX IF NOT EXISTS "secret_rotations_state_idx"
  ON "public"."secret_rotations" ("state", "environment");

ALTER TABLE "public"."secret_rotations" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."secret_rotations" FROM "anon", "authenticated";
GRANT SELECT, INSERT, UPDATE ON TABLE "public"."secret_rotations" TO "service_role";

COMMENT ON TABLE "public"."secret_rotations" IS
  'Phase 25-C. Current rotation-lifecycle state, one row per (secret_name, environment). No secret value ever stored — current_version_ref/previous_version_ref are opaque provider version ids only. Written exclusively through upsert_secret_rotation_state(), gated at the application layer by secret.rotate (policy + Tier-0 dual control).';


-- ---------------------------------------------------------------------------
-- upsert_secret_rotation_state() — the one write the rotation execution
-- service makes, per state transition
-- ---------------------------------------------------------------------------
-- `p_expected_state` is optimistic concurrency: the caller (which already
-- validated the transition is legal via rotation-contract.ts's
-- `canTransition()`) supplies the state it read, and the UPDATE only
-- applies if the row is STILL in that state — the same compare-and-set
-- discipline `resolve_privacy_request()`'s `WHERE status IN (...)` and
-- Phase 22's `complete_model_eval_run()`'s `WHERE status = 'running'`
-- already use. A NULL `p_expected_state` means "create the row if it does
-- not exist yet" (the NOT_CONFIGURED -> ROTATION_REQUIRED first step).
CREATE OR REPLACE FUNCTION "public"."upsert_secret_rotation_state"(
    "p_secret_name" "text",
    "p_environment" "text",
    "p_owner" "text",
    "p_rotation_class" "text",
    "p_new_state" "text",
    "p_reason_code" "text",
    "p_expected_state" "text" DEFAULT NULL,
    "p_tier0_request_id" "uuid" DEFAULT NULL,
    "p_current_version_ref" "text" DEFAULT NULL,
    "p_previous_version_ref" "text" DEFAULT NULL,
    "p_rotated_at" timestamp with time zone DEFAULT NULL,
    "p_expires_at" timestamp with time zone DEFAULT NULL,
    "p_verified_at" timestamp with time zone DEFAULT NULL
) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_id uuid;
  v_updated integer;
BEGIN
  IF p_secret_name IS NULL OR "char_length"(p_secret_name) = 0 THEN
    RAISE EXCEPTION 'invalid_secret_name' USING ERRCODE = '22023';
  END IF;
  IF p_environment NOT IN ('development', 'staging', 'production') THEN
    RAISE EXCEPTION 'invalid_environment' USING ERRCODE = '22023';
  END IF;
  IF p_new_state NOT IN (
    'NOT_CONFIGURED', 'ROTATION_REQUIRED', 'ROTATING', 'VERIFYING',
    'ACTIVE', 'ROLLBACK_AVAILABLE', 'FAILED', 'EXPIRED'
  ) THEN
    RAISE EXCEPTION 'invalid_state' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_id FROM secret_rotations
   WHERE secret_name = p_secret_name AND environment = p_environment;

  IF v_id IS NULL THEN
    -- First row for this (secret, environment). Only a fresh
    -- NOT_CONFIGURED -> ROTATION_REQUIRED transition may create one.
    IF p_expected_state IS NOT NULL THEN
      RETURN jsonb_build_object('applied', false, 'reason', 'no_existing_row');
    END IF;
    INSERT INTO secret_rotations (
      secret_name, environment, owner, rotation_class, state, reason_code,
      tier0_request_id, current_version_ref, previous_version_ref,
      rotated_at, expires_at, verified_at
    ) VALUES (
      p_secret_name, p_environment, p_owner, p_rotation_class, p_new_state, p_reason_code,
      p_tier0_request_id, p_current_version_ref, p_previous_version_ref,
      p_rotated_at, p_expires_at, p_verified_at
    )
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('applied', true, 'rotation_id', v_id, 'created', true);
  END IF;

  UPDATE secret_rotations
     SET state = p_new_state,
         reason_code = p_reason_code,
         owner = p_owner,
         rotation_class = p_rotation_class,
         tier0_request_id = COALESCE(p_tier0_request_id, tier0_request_id),
         current_version_ref = COALESCE(p_current_version_ref, current_version_ref),
         previous_version_ref = COALESCE(p_previous_version_ref, previous_version_ref),
         rotated_at = COALESCE(p_rotated_at, rotated_at),
         expires_at = COALESCE(p_expires_at, expires_at),
         verified_at = COALESCE(p_verified_at, verified_at),
         updated_at = now()
   WHERE id = v_id
     AND (p_expected_state IS NULL OR state = p_expected_state);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'state_mismatch', 'rotation_id', v_id);
  END IF;

  RETURN jsonb_build_object('applied', true, 'rotation_id', v_id, 'created', false);
END;
$$;

ALTER FUNCTION "public"."upsert_secret_rotation_state"(
  "text","text","text","text","text","text","text","uuid","text","text",
  timestamp with time zone, timestamp with time zone, timestamp with time zone
) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."upsert_secret_rotation_state"(
  "text","text","text","text","text","text","text","uuid","text","text",
  timestamp with time zone, timestamp with time zone, timestamp with time zone
) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."upsert_secret_rotation_state"(
  "text","text","text","text","text","text","text","uuid","text","text",
  timestamp with time zone, timestamp with time zone, timestamp with time zone
) TO "service_role";
