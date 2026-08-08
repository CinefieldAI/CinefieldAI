


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






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
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."generations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "clerk_user_id" "text" DEFAULT ("auth"."jwt"() ->> 'sub'::"text") NOT NULL,
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


ALTER TABLE "public"."generations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "clerk_user_id" "text" DEFAULT ("auth"."jwt"() ->> 'sub'::"text") NOT NULL,
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


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "clerk_user_id" "text" DEFAULT ("auth"."jwt"() ->> 'sub'::"text") NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "thumbnail_url" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "projects_description_check" CHECK ((("description" IS NULL) OR ("char_length"("description") <= 2000))),
    CONSTRAINT "projects_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'processing'::"text", 'completed'::"text", 'failed'::"text", 'archived'::"text"]))),
    CONSTRAINT "projects_title_check" CHECK ((("char_length"("title") >= 1) AND ("char_length"("title") <= 150)))
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


ALTER TABLE ONLY "public"."generations"
    ADD CONSTRAINT "generations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("clerk_user_id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



CREATE INDEX "generations_clerk_user_id_idx" ON "public"."generations" USING "btree" ("clerk_user_id");



CREATE INDEX "generations_owner_created_at_idx" ON "public"."generations" USING "btree" ("clerk_user_id", "created_at" DESC);



CREATE INDEX "generations_owner_status_idx" ON "public"."generations" USING "btree" ("clerk_user_id", "status");



CREATE INDEX "generations_project_created_at_idx" ON "public"."generations" USING "btree" ("project_id", "created_at" DESC);



CREATE INDEX "generations_project_id_idx" ON "public"."generations" USING "btree" ("project_id");



CREATE INDEX "generations_status_created_at_idx" ON "public"."generations" USING "btree" ("status", "created_at");



CREATE UNIQUE INDEX "profiles_email_unique_idx" ON "public"."profiles" USING "btree" ("lower"("email")) WHERE ("email" IS NOT NULL);



CREATE INDEX "projects_clerk_user_id_idx" ON "public"."projects" USING "btree" ("clerk_user_id");



CREATE INDEX "projects_owner_created_at_idx" ON "public"."projects" USING "btree" ("clerk_user_id", "created_at" DESC);



CREATE INDEX "projects_owner_status_idx" ON "public"."projects" USING "btree" ("clerk_user_id", "status");



CREATE OR REPLACE TRIGGER "generations_set_updated_at" BEFORE UPDATE ON "public"."generations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "profiles_set_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "projects_set_updated_at" BEFORE UPDATE ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."generations"
    ADD CONSTRAINT "generations_clerk_user_id_fkey" FOREIGN KEY ("clerk_user_id") REFERENCES "public"."profiles"("clerk_user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."generations"
    ADD CONSTRAINT "generations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_clerk_user_id_fkey" FOREIGN KEY ("clerk_user_id") REFERENCES "public"."profiles"("clerk_user_id") ON DELETE CASCADE;



ALTER TABLE "public"."generations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "generations_insert_own" ON "public"."generations" FOR INSERT TO "authenticated" WITH CHECK ((("clerk_user_id" = ( SELECT ("auth"."jwt"() ->> 'sub'::"text"))) AND (EXISTS ( SELECT 1
   FROM "public"."projects"
  WHERE (("projects"."id" = "generations"."project_id") AND ("projects"."clerk_user_id" = ( SELECT ("auth"."jwt"() ->> 'sub'::"text"))))))));



CREATE POLICY "generations_select_own" ON "public"."generations" FOR SELECT TO "authenticated" USING (("clerk_user_id" = ( SELECT ("auth"."jwt"() ->> 'sub'::"text"))));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_insert_own" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK (("clerk_user_id" = ( SELECT ("auth"."jwt"() ->> 'sub'::"text"))));



CREATE POLICY "profiles_select_own" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("clerk_user_id" = ( SELECT ("auth"."jwt"() ->> 'sub'::"text"))));



CREATE POLICY "profiles_update_own" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("clerk_user_id" = ( SELECT ("auth"."jwt"() ->> 'sub'::"text")))) WITH CHECK (("clerk_user_id" = ( SELECT ("auth"."jwt"() ->> 'sub'::"text"))));



ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "projects_delete_own" ON "public"."projects" FOR DELETE TO "authenticated" USING (("clerk_user_id" = ( SELECT ("auth"."jwt"() ->> 'sub'::"text"))));



CREATE POLICY "projects_insert_own" ON "public"."projects" FOR INSERT TO "authenticated" WITH CHECK (("clerk_user_id" = ( SELECT ("auth"."jwt"() ->> 'sub'::"text"))));



CREATE POLICY "projects_select_own" ON "public"."projects" FOR SELECT TO "authenticated" USING (("clerk_user_id" = ( SELECT ("auth"."jwt"() ->> 'sub'::"text"))));



CREATE POLICY "projects_update_own" ON "public"."projects" FOR UPDATE TO "authenticated" USING (("clerk_user_id" = ( SELECT ("auth"."jwt"() ->> 'sub'::"text")))) WITH CHECK (("clerk_user_id" = ( SELECT ("auth"."jwt"() ->> 'sub'::"text"))));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";





































































































































































GRANT ALL ON TABLE "public"."generations" TO "service_role";
GRANT SELECT ON TABLE "public"."generations" TO "authenticated";



GRANT INSERT("project_id") ON TABLE "public"."generations" TO "authenticated";



GRANT INSERT("generation_type") ON TABLE "public"."generations" TO "authenticated";



GRANT INSERT("provider") ON TABLE "public"."generations" TO "authenticated";



GRANT INSERT("model") ON TABLE "public"."generations" TO "authenticated";



GRANT INSERT("prompt") ON TABLE "public"."generations" TO "authenticated";



GRANT INSERT("negative_prompt") ON TABLE "public"."generations" TO "authenticated";



GRANT INSERT("input_url") ON TABLE "public"."generations" TO "authenticated";



GRANT INSERT("metadata") ON TABLE "public"."generations" TO "authenticated";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."profiles" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."projects" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "service_role";



































