-- Cinefield Phase 5 final convergence — server-side generation creation with
-- durable idempotency.
--
-- WHAT THIS CLOSES
-- /api/generate previously accepted a generationId for a row the browser had
-- already inserted under RLS. That left the last piece of the production path
-- outside the server boundary: the client chose when a generation came into
-- existence, and two clicks produced two rows before any server code ran.
--
-- The row is now created here, and the idempotency key travels WITH it in the
-- same INSERT. That is the whole point of doing this in SQL rather than in
-- TypeScript: "create the generation" and "record which request created it"
-- must be one atomic act, or a crash between them leaves a generation nothing
-- can deduplicate against. Two PostgREST calls could not give that, and
-- describing them as if they could would be the same fiction the outbox work
-- already refused.
--
-- THE UNIQUE INDEX IS THE RACE WINNER, NOT THE PRE-CHECK
-- The function looks for an existing row first, but that read is an
-- optimisation, not the guard: two concurrent requests can both see nothing.
-- The partial unique index below is what actually decides, and the
-- unique_violation handler turns the loser into a replay instead of an error
-- — the same shape reserve_credits already uses and which the concurrency
-- proofs already exercise.
--
-- REQUEST HASH
-- Stored alongside the key so a client that reuses a key with a DIFFERENT
-- payload can be refused rather than silently handed back a generation it did
-- not ask for. The function reports the stored hash; the caller compares.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
-- Both nullable: every generation that predates this migration has neither,
-- and rows created by internal paths that carry no client key never will.
ALTER TABLE "public"."generations"
  ADD COLUMN IF NOT EXISTS "idempotency_key" "text";

ALTER TABLE "public"."generations"
  ADD COLUMN IF NOT EXISTS "request_hash" "text";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pg_constraint" WHERE "conname" = 'generations_idempotency_key_check'
  ) THEN
    ALTER TABLE "public"."generations"
      ADD CONSTRAINT "generations_idempotency_key_check"
      CHECK (("idempotency_key" IS NULL)
             OR (("char_length"("idempotency_key") >= 8)
                 AND ("char_length"("idempotency_key") <= 200)));
  END IF;
END $$;

-- ONE GENERATION PER (owner, idempotency key). Partial, so the unlimited
-- population of rows without a key is unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS "generations_user_idempotency_uniq"
  ON "public"."generations" ("clerk_user_id", "idempotency_key")
  WHERE ("idempotency_key" IS NOT NULL);

-- ---------------------------------------------------------------------------
-- create_generation_tx()
-- ---------------------------------------------------------------------------
-- Returns {generation_id, created, request_hash, status}.
--   created = true   this call inserted the row
--   created = false  an equivalent request already existed; request_hash is
--                    the STORED one so the caller can detect key reuse with a
--                    different payload
--
-- Ownership is a parameter, not a lookup: the caller derives it from a
-- verified server session. The project is re-checked here anyway, because a
-- generation must never be attached to a project its owner does not hold.
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

  -- The project must exist AND belong to the caller. Checked here as well as
  -- in the service, because a SECURITY DEFINER function bypasses RLS and must
  -- therefore never rely on RLS having checked anything.
  SELECT clerk_user_id INTO v_owner FROM projects WHERE id = p_project_id;
  IF NOT FOUND OR v_owner IS DISTINCT FROM p_clerk_user_id THEN
    RAISE EXCEPTION 'project_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Fast path for an obvious replay. NOT the guard — see the header.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
      FROM generations
     WHERE clerk_user_id = p_clerk_user_id
       AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
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

  RETURN jsonb_build_object(
    'generation_id', v_id,
    'created',       true,
    'request_hash',  p_request_hash,
    'status',        'queued'
  );

EXCEPTION
  WHEN unique_violation THEN
    -- A genuine concurrent duplicate raced past the read above before either
    -- committed. generations_user_idempotency_uniq decided it; this handler
    -- only reports the winner rather than letting a raw constraint error
    -- reach the caller. This invocation's insert is already rolled back.
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
REVOKE ALL ON FUNCTION "public"."create_generation_tx"("text", "uuid", "text", "text", "text", "text", "jsonb", "text", "text", "text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."create_generation_tx"("text", "uuid", "text", "text", "text", "text", "jsonb", "text", "text", "text", "text") FROM "anon";
REVOKE ALL ON FUNCTION "public"."create_generation_tx"("text", "uuid", "text", "text", "text", "text", "jsonb", "text", "text", "text", "text") FROM "authenticated";
GRANT EXECUTE ON FUNCTION "public"."create_generation_tx"("text", "uuid", "text", "text", "text", "text", "jsonb", "text", "text", "text", "text") TO "service_role";

COMMENT ON FUNCTION "public"."create_generation_tx"("text", "uuid", "text", "text", "text", "text", "jsonb", "text", "text", "text", "text") IS
  'Phase 5 convergence. Creates a generation and records its idempotency identity in ONE insert. Returns {generation_id, created, request_hash, status}; created=false for a replay, with the STORED request_hash so a caller can detect key reuse with a different payload.';
