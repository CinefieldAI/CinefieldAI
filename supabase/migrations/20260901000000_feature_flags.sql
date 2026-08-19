-- Cinefield Phase 21 — Runtime Feature Flags, Kill Switches & Safe Rollout.
--
-- ===========================================================================
-- WHAT THIS OWNS, AND WHAT IT DELIBERATELY DOES NOT
-- ===========================================================================
-- This is the durable state for GENERIC, Phase-21-owned flags only:
-- `maintenance_mode`, `feature.video.enabled`, `uploads.enabled`, and
-- `release_stage`. It is NOT a second provider/model/route kill switch —
-- Phase 7-A/7-B/7-E already own that (`model_providers.enabled`,
-- `model_routes.enabled`, `routing_control` in Redis A) and this migration
-- does not touch any of those tables. Phase 21's job, per the roadmap's own
-- framing, is to GENERALIZE the flag concept those phases pioneered, not to
-- re-implement their narrower one.
--
-- ===========================================================================
-- TWO TABLES, TWO DIFFERENT JOBS
-- ===========================================================================
-- `feature_flags`      the CURRENT value of every flag — one row per flag
--                       key, overwritten on every change. What a reader asks
--                       "what is this flag right now?" against.
-- `feature_flag_audit` an APPEND-ONLY history of every change — previous
--                       value, new value, actor, reason, ticket and expiry,
--                       so an emergency change is both traceable and
--                       reversible (roadmap 21-C's own done-criterion).
--
-- This is deliberately NOT the same table as
-- `admin_privileged_action_events` (20260829000000). That table already
-- records, for free, that a Tier-0-gated `flag.set.tier0` /
-- `release_stage.activate_public` action was requested/authorized/executed
-- by whom — but it has no `value`/`rollback_value` columns and is not meant
-- to: it is an AUTHORIZATION audit, not a business-value history. The two
-- tables are complementary, the same relationship `model_routes.enabled`
-- (the real state) already has with that same authorization table for
-- `route.disable`.
--
-- ===========================================================================
-- WHY A GENERIC `jsonb` VALUE COLUMN, NOT ONE COLUMN PER FLAG
-- ===========================================================================
-- A boolean kill switch, a three-value release stage, and (later) a
-- percentage-rollout descriptor do not share a SQL type. Rather than a wide
-- table with one nullable column per flag shape (which grows by migration
-- every time a new flag is added — exactly the friction Phase 21 exists to
-- remove), the value is stored as `jsonb` and its SHAPE is validated in
-- TypeScript, once, against each flag's own `FlagDefinition`
-- (`src/lib/feature-flags/flag-registry.ts`) before this table is ever
-- written. The SQL layer only enforces the structural minimum: a value must
-- exist, and `value_type` must name one of the shapes the application knows
-- how to validate.
--
-- ===========================================================================
-- EXPIRY IS LAZY, NOT A SCHEDULED REVERT
-- ===========================================================================
-- `expires_at` is read, not enforced by a cron. `src/lib/feature-flags/
-- flag-store.ts`'s read path treats a flag whose `expires_at` has passed as
-- equal to its own `rollback_value` — the same "computed lazily from
-- elapsed time, never a background writer" discipline
-- `src/lib/routing/circuit-breaker.ts`'s OPEN-to-HALF_OPEN transition
-- already uses in this codebase. No `schedules.task()` exists anywhere in
-- this repository (see `src/trigger/operational/operational-tasks.ts`'s own
-- header) to drive a real scheduled revert, and this migration does not
-- invent one.

CREATE TABLE IF NOT EXISTS "public"."feature_flags" (
    "flag_key" "text" NOT NULL,

    -- What kind of value this flag holds — validated against the real
    -- `FlagDefinition` in TypeScript before every write; this CHECK is only
    -- the structural floor.
    "value_type" "text" NOT NULL,
    "value" "jsonb" NOT NULL,

    -- What to revert to. Nullable only for a flag's very first write, before
    -- any prior value exists to roll back to.
    "rollback_value" "jsonb",

    "reason_code" "text",
    "ticket_ref" "text",

    -- Emergency changes may self-expire; a deliberate, permanent change
    -- leaves this null.
    "expires_at" timestamp with time zone,

    "updated_by" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("flag_key"),
    CONSTRAINT "feature_flags_flag_key_check" CHECK (("flag_key" ~ '^[a-z][a-z0-9_.]{1,80}$'::"text")),
    CONSTRAINT "feature_flags_value_type_check" CHECK (("value_type" = ANY (ARRAY[
      'boolean'::"text", 'string'::"text", 'enum'::"text"
    ]))),
    CONSTRAINT "feature_flags_updated_by_check" CHECK (("char_length"("updated_by") > 0))
);

COMMENT ON TABLE "public"."feature_flags" IS
  'Phase 21. Current value of every Phase-21-owned generic runtime flag. Never provider/model/route kill switches — those stay owned by Phase 7.';

CREATE TABLE IF NOT EXISTS "public"."feature_flag_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "flag_key" "text" NOT NULL,
    "previous_value" "jsonb",
    "new_value" "jsonb" NOT NULL,
    "actor_clerk_user_id" "text" NOT NULL,
    "reason_code" "text",
    "ticket_ref" "text",
    "expires_at" timestamp with time zone,
    "changed_at" timestamp with time zone DEFAULT "now"() NOT NULL,

    CONSTRAINT "feature_flag_audit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "feature_flag_audit_flag_key_check" CHECK (("flag_key" ~ '^[a-z][a-z0-9_.]{1,80}$'::"text")),
    CONSTRAINT "feature_flag_audit_actor_check" CHECK (("char_length"("actor_clerk_user_id") > 0))
);

COMMENT ON TABLE "public"."feature_flag_audit" IS
  'Phase 21. Append-only history of every feature_flags change — never updated or deleted, so an emergency change stays traceable and reversible.';

CREATE INDEX IF NOT EXISTS "feature_flag_audit_flag_key_idx" ON "public"."feature_flag_audit" ("flag_key", "changed_at" DESC);

-- Belt-and-suspenders against an accidental UPDATE/DELETE reaching an
-- append-only table — the same pattern
-- `admin_privileged_action_events_append_only()` (20260829000000) already
-- established for exactly this reason.
CREATE OR REPLACE FUNCTION "public"."feature_flag_audit_append_only"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RAISE EXCEPTION 'feature_flag_audit is append-only' USING ERRCODE = '0A000';
END;
$$;

DROP TRIGGER IF EXISTS "feature_flag_audit_no_update" ON "public"."feature_flag_audit";
CREATE TRIGGER "feature_flag_audit_no_update"
    BEFORE UPDATE OR DELETE ON "public"."feature_flag_audit"
    FOR EACH ROW EXECUTE FUNCTION "public"."feature_flag_audit_append_only"();

-- ---------------------------------------------------------------------------
-- set_feature_flag() — atomic current-value write + audit row, one transaction
-- ---------------------------------------------------------------------------
-- Mirrors `emit_outbox_event()`'s own reasoning: PostgREST cannot span one
-- transaction across two HTTP requests, so the UPSERT into `feature_flags`
-- and the INSERT into `feature_flag_audit` are both statements inside ONE
-- PL/pgSQL function body, sharing its single implicit transaction. Returns
-- the previous value so the caller can build a bounded domain event
-- (`audit.flag_changed`) without a second read.
CREATE OR REPLACE FUNCTION "public"."set_feature_flag"(
    "p_flag_key" "text",
    "p_value_type" "text",
    "p_new_value" "jsonb",
    "p_actor_clerk_user_id" "text",
    "p_rollback_value" "jsonb" DEFAULT NULL,
    "p_reason_code" "text" DEFAULT NULL,
    "p_ticket_ref" "text" DEFAULT NULL,
    "p_expires_at" timestamp with time zone DEFAULT NULL
) RETURNS TABLE (
    "previous_value" "jsonb",
    "new_value" "jsonb"
)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_previous jsonb;
BEGIN
  IF p_flag_key IS NULL OR p_flag_key !~ '^[a-z][a-z0-9_.]{1,80}$' THEN
    RAISE EXCEPTION 'invalid_flag_key' USING ERRCODE = '22023';
  END IF;
  IF p_actor_clerk_user_id IS NULL OR char_length(p_actor_clerk_user_id) = 0 THEN
    RAISE EXCEPTION 'invalid_actor' USING ERRCODE = '22023';
  END IF;

  SELECT f.value INTO v_previous FROM feature_flags f WHERE f.flag_key = p_flag_key;

  INSERT INTO feature_flags AS f (
    flag_key, value_type, value, rollback_value, reason_code, ticket_ref,
    expires_at, updated_by, updated_at
  )
  VALUES (
    p_flag_key, p_value_type, p_new_value,
    COALESCE(p_rollback_value, v_previous),
    p_reason_code, p_ticket_ref, p_expires_at, p_actor_clerk_user_id, now()
  )
  ON CONFLICT (flag_key) DO UPDATE SET
    value_type = EXCLUDED.value_type,
    value = EXCLUDED.value,
    rollback_value = COALESCE(EXCLUDED.rollback_value, f.value),
    reason_code = EXCLUDED.reason_code,
    ticket_ref = EXCLUDED.ticket_ref,
    expires_at = EXCLUDED.expires_at,
    updated_by = EXCLUDED.updated_by,
    updated_at = now();

  INSERT INTO feature_flag_audit (
    flag_key, previous_value, new_value, actor_clerk_user_id, reason_code,
    ticket_ref, expires_at
  )
  VALUES (
    p_flag_key, v_previous, p_new_value, p_actor_clerk_user_id, p_reason_code,
    p_ticket_ref, p_expires_at
  );

  RETURN QUERY SELECT v_previous, p_new_value;
END;
$$;

ALTER FUNCTION "public"."set_feature_flag"("text", "text", "jsonb", "text", "jsonb", "text", "text", timestamp with time zone) OWNER TO "postgres";
COMMENT ON FUNCTION "public"."set_feature_flag"("text", "text", "jsonb", "text", "jsonb", "text", "text", timestamp with time zone) IS
  'Phase 21. Atomic current-value write + append-only audit row for one feature flag change. Caller (feature-flag-admin-service.ts) has already passed requirePolicy() and authorizeTier0Action() before this runs.';

ALTER TABLE "public"."feature_flags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."feature_flag_audit" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."feature_flags" TO "service_role";
GRANT ALL ON TABLE "public"."feature_flag_audit" TO "service_role";

REVOKE ALL ON FUNCTION "public"."set_feature_flag"("text", "text", "jsonb", "text", "jsonb", "text", "text", timestamp with time zone) FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."set_feature_flag"("text", "text", "jsonb", "text", "jsonb", "text", "text", timestamp with time zone) TO "service_role";
