-- Minimal bootstrap for an ISOLATED, THROWAWAY PostgreSQL used by the
-- Phase 6R-E transaction proofs. Never applied to Supabase.
--
-- WHY NOT REPLAY THE FULL remote_schema.sql
-- That dump carries Supabase-specific dependencies (the `auth` schema, RLS
-- policies bound to auth.jwt(), storage schemas) that a plain postgres:16
-- image does not have, and installing shims for them would mean the proofs
-- ran against a hand-built approximation of the platform. What the proofs
-- actually need is the tables the functions under test touch. Those are
-- reproduced here EXACTLY as the real dump declares them, minus the
-- auth.jwt() column default, which is a Supabase convenience and not part of
-- any behaviour being proven.
--
-- The migrations that follow this file (generation_attempts, outbox_events,
-- cancellation_outbox) are applied VERBATIM from supabase/migrations/, so the
-- functions being proven are the real production ones, not copies.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Minimal `auth.jwt()` shim. The credit migration's RLS policies reference it,
-- and a plain postgres image has no Supabase auth schema.
--
-- SCOPE: this exists so the migration APPLIES. It is never exercised — every
-- proof connects as the table owner, for whom RLS is not enforced, and the
-- functions under test are SECURITY DEFINER. No proof in this harness makes
-- any claim about RLS behaviour; RLS is verified against Supabase itself.
CREATE SCHEMA IF NOT EXISTS "auth";
CREATE OR REPLACE FUNCTION "auth"."jwt"() RETURNS "jsonb"
  LANGUAGE "sql" STABLE AS $$ SELECT '{}'::jsonb $$;

-- Roles the real migrations GRANT to. Created as NOLOGIN placeholders so the
-- grants apply unchanged; nothing ever connects as them.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE "anon" NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE "authenticated" NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE "service_role" NOLOGIN;
  END IF;
END $$;

-- Copied verbatim from remote_schema.sql: the generation_attempts migration
-- attaches an updated_at trigger to it, and the crash-window/staleness logic
-- depends on updated_at actually moving.
CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Copied from the real remote schema because the production hardening migration
-- intentionally revokes direct client EXECUTE on this existing event-trigger
-- helper. The throwaway harness does not install the event trigger itself; it
-- only needs the exact pg_proc object so the real migration and ACL proof can
-- execute unchanged.
CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
    IF cmd.schema_name IS NOT NULL
       AND cmd.schema_name IN ('public')
       AND cmd.schema_name NOT IN ('pg_catalog','information_schema')
       AND cmd.schema_name NOT LIKE 'pg_toast%'
       AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
  END LOOP;
END;
$$;

-- The credit migration takes FKs to profiles and mirrors a balance onto it,
-- so it must exist before that migration runs. Copied from remote_schema.sql
-- minus the auth.jwt() default.
CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "clerk_user_id" "text" NOT NULL PRIMARY KEY,
    "username" "text",
    "email" "text",
    "display_name" "text",
    "avatar_url" "text",
    "credits" integer DEFAULT 0 NOT NULL,
    "plan" "text" DEFAULT 'free'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profiles_credits_check" CHECK (("credits" >= 0)),
    CONSTRAINT "profiles_plan_check" CHECK (("plan" = ANY (ARRAY['free'::"text", 'starter'::"text", 'pro'::"text", 'business'::"text", 'enterprise'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "clerk_user_id" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

-- Column-for-column and constraint-for-constraint as declared in
-- supabase/migrations/20260805132704_remote_schema.sql.
CREATE TABLE IF NOT EXISTS "public"."generations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "project_id" "uuid" NOT NULL REFERENCES "public"."projects"("id") ON DELETE CASCADE,
    "clerk_user_id" "text" NOT NULL,
    "generation_type" "text" NOT NULL,
    "provider" "text" NOT NULL,
    "model" "text" NOT NULL,
    "prompt" "text" NOT NULL,
    "negative_prompt" "text",
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "input_url" "text",
    "output_url" "text",
    "thumbnail_url" "text",
    "error_message" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "generations_completed_at_check" CHECK ((("completed_at" IS NULL) OR ("status" = ANY (ARRAY['completed'::"text", 'failed'::"text", 'cancelled'::"text"])))),
    CONSTRAINT "generations_error_message_check" CHECK ((("error_message" IS NULL) OR ("char_length"("error_message") <= 5000))),
    CONSTRAINT "generations_generation_type_check" CHECK (("generation_type" = ANY (ARRAY['image'::"text", 'video'::"text", 'audio'::"text"]))),
    CONSTRAINT "generations_model_check" CHECK ((("char_length"("model") >= 1) AND ("char_length"("model") <= 150))),
    CONSTRAINT "generations_negative_prompt_check" CHECK ((("negative_prompt" IS NULL) OR ("char_length"("negative_prompt") <= 10000))),
    CONSTRAINT "generations_prompt_check" CHECK ((("char_length"("prompt") >= 1) AND ("char_length"("prompt") <= 10000))),
    CONSTRAINT "generations_provider_check" CHECK ((("char_length"("provider") >= 1) AND ("char_length"("provider") <= 100))),
    CONSTRAINT "generations_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'processing'::"text", 'completed'::"text", 'failed'::"text", 'cancelled'::"text"])))
);
