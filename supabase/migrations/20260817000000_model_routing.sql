-- Cinefield Phase 7-A — production model / route data model.
--
-- WHAT ALREADY EXISTED, AND IS NOT DUPLICATED HERE
--   model_pricing        (20260812000000) already holds provider cost metadata
--                        with pricing_version / is_active / effective_from, and
--                        already separates provider_unit_cost from
--                        credit_price_per_unit. That separation IS the
--                        "routing cost metadata vs Phase 10 customer charge"
--                        boundary, so no second pricing table is created.
--   generation_attempts  (20260810120000) already owns attempt identity, the
--                        claim, submission evidence and every concurrency
--                        guarantee proven in 6R-G. It is EXTENDED additively
--                        below, never replaced, and no second attempt system
--                        is introduced.
--   src/lib/orchestration/model-registry.ts already holds the rich capability
--                        type. It stays the capability source of truth; these
--                        tables are the ROUTING source of truth. The seed at
--                        the bottom is derived from that registry, and a test
--                        asserts the two cannot drift.
--
-- WHY ROUTING NEEDS A DATABASE AT ALL
-- A capability ("what can this model do") is a property of the model and
-- belongs in code that ships with the validator. A route ("where should this
-- run") is an OPERATIONAL decision that has to change without a deploy —
-- disabling a provider at 3am is not a pull request. That is the whole reason
-- these two live in different places.
--
-- NOTHING HERE IS BROWSER-WRITABLE. Every table is service-role only; RLS is
-- enabled with no permissive policy, so a browser holding an anon or
-- authenticated key sees nothing and can write nothing. Provider routing is
-- not client authority.

-- ---------------------------------------------------------------------------
-- providers
-- ---------------------------------------------------------------------------
-- Identity and operational state only. NO CREDENTIALS: adapters read their own
-- secrets from server-only environment, and a provider secret in a database
-- row is a secret in every backup, replica and query log.
CREATE TABLE IF NOT EXISTS "public"."providers" (
    "id" "text" NOT NULL PRIMARY KEY,
    "label" "text" NOT NULL,
    -- Operational kill switch. A disabled provider makes every route through
    -- it ineligible without touching the routes themselves.
    "enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "providers_id_check" CHECK (("char_length"("id") >= 1) AND ("char_length"("id") <= 100))
);

-- ---------------------------------------------------------------------------
-- models — Cinefield platform identity
-- ---------------------------------------------------------------------------
-- The id here is the CINEFIELD model id, the one the client sends and the one
-- generations.model already stores. A provider's own model string is never
-- canonical identity: that is what lets one Cinefield model be served by more
-- than one provider.
CREATE TABLE IF NOT EXISTS "public"."models" (
    "id" "text" NOT NULL PRIMARY KEY,
    "label" "text" NOT NULL,
    "generation_type" "text" NOT NULL,
    -- Lifecycle, not a boolean: "preview" and "deprecated" are both usable
    -- states that a simple enabled flag cannot express, and conflating
    -- "deprecated but running" with "disabled" is how a model gets switched
    -- off by accident.
    "lifecycle" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "models_generation_type_check"
      CHECK (("generation_type" = ANY (ARRAY['image'::"text", 'video'::"text", 'audio'::"text"]))),
    CONSTRAINT "models_lifecycle_check"
      CHECK (("lifecycle" = ANY (ARRAY['active'::"text", 'preview'::"text", 'deprecated'::"text", 'disabled'::"text"])))
);

-- ---------------------------------------------------------------------------
-- model_versions
-- ---------------------------------------------------------------------------
-- An attempt records WHICH version it ran, so a capability change is auditable
-- after the fact rather than silently rewriting history. The capability
-- snapshot is stored as jsonb for exactly that reason: it is what the model
-- could do at the time, not what it can do now.
CREATE TABLE IF NOT EXISTS "public"."model_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "model_id" "text" NOT NULL REFERENCES "public"."models"("id") ON DELETE CASCADE,
    "version" integer NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    -- Snapshot of the capability contract as of this version. The LIVE
    -- capability source of truth remains the code registry; this exists for
    -- audit and for reasoning about an attempt that ran months ago.
    "capabilities" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "model_versions_version_check" CHECK (("version" >= 1)),
    CONSTRAINT "model_versions_status_check"
      CHECK (("status" = ANY (ARRAY['active'::"text", 'preview'::"text", 'deprecated'::"text", 'disabled'::"text"])))
);

CREATE UNIQUE INDEX IF NOT EXISTS "model_versions_model_version_uniq"
  ON "public"."model_versions" ("model_id", "version");

-- At most one ACTIVE version per model, so "the current version" is never
-- ambiguous and route resolution cannot pick between two of them.
CREATE UNIQUE INDEX IF NOT EXISTS "model_versions_one_active_uniq"
  ON "public"."model_versions" ("model_id")
  WHERE ("status" = 'active'::"text");

-- ---------------------------------------------------------------------------
-- provider_models — the provider's own endpoint/model identity
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."provider_models" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "provider_id" "text" NOT NULL REFERENCES "public"."providers"("id") ON DELETE CASCADE,
    -- e.g. "fal-ai/flux/schnell", "gemini-3-pro-image". Provider-owned, and
    -- deliberately NOT a Cinefield identity.
    "provider_model_id" "text" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "provider_models_id_check"
      CHECK (("char_length"("provider_model_id") >= 1) AND ("char_length"("provider_model_id") <= 200))
);

CREATE UNIQUE INDEX IF NOT EXISTS "provider_models_identity_uniq"
  ON "public"."provider_models" ("provider_id", "provider_model_id");

-- ---------------------------------------------------------------------------
-- model_routes — the router's source of truth
-- ---------------------------------------------------------------------------
-- One row = "this Cinefield model version MAY run on this provider model, at
-- this priority". Multiple rows per model version is the entire point: it is
-- what makes a second provider possible without a deploy.
CREATE TABLE IF NOT EXISTS "public"."model_routes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "model_id" "text" NOT NULL REFERENCES "public"."models"("id") ON DELETE CASCADE,
    "model_version_id" "uuid" NOT NULL REFERENCES "public"."model_versions"("id") ON DELETE CASCADE,
    "provider_model_id" "uuid" NOT NULL REFERENCES "public"."provider_models"("id") ON DELETE CASCADE,

    "enabled" boolean DEFAULT true NOT NULL,
    -- Higher wins. Static in Phase 7-B: no scoring, no health input, no
    -- randomness. Dynamic weighting is 7-C and deliberately absent.
    "priority" integer DEFAULT 100 NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,

    -- Room for region / tenant / rollout constraints without a migration.
    -- Empty today; the router ignores unknown keys rather than guessing.
    "constraints" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,

    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,

    CONSTRAINT "model_routes_priority_check" CHECK (("priority" >= 0) AND ("priority" <= 10000)),
    CONSTRAINT "model_routes_status_check"
      CHECK (("status" = ANY (ARRAY['active'::"text", 'draft'::"text", 'retired'::"text"])))
);

-- One route per (version, provider model). Two rows for the same pair would
-- make selection order depend on insertion order, which is exactly the
-- non-determinism this phase forbids.
CREATE UNIQUE INDEX IF NOT EXISTS "model_routes_version_provider_uniq"
  ON "public"."model_routes" ("model_version_id", "provider_model_id");

CREATE INDEX IF NOT EXISTS "model_routes_selection_idx"
  ON "public"."model_routes" ("model_id", "priority" DESC)
  WHERE ("enabled" AND "status" = 'active'::"text");

-- ---------------------------------------------------------------------------
-- generation_attempts — ADDITIVE route correlation
-- ---------------------------------------------------------------------------
-- The existing table, its claim, its evidence ladder and every concurrency
-- guarantee are untouched. Two nullable columns are added so an attempt can
-- say which model version and which route produced it. Nullable because every
-- attempt that predates this migration has neither, and ON DELETE SET NULL
-- because retiring a route must never cascade away the record of a provider
-- job that actually ran.
ALTER TABLE "public"."generation_attempts"
  ADD COLUMN IF NOT EXISTS "model_version_id" "uuid"
    REFERENCES "public"."model_versions"("id") ON DELETE SET NULL;

ALTER TABLE "public"."generation_attempts"
  ADD COLUMN IF NOT EXISTS "model_route_id" "uuid"
    REFERENCES "public"."model_routes"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "generation_attempts_route_idx"
  ON "public"."generation_attempts" ("model_route_id")
  WHERE ("model_route_id" IS NOT NULL);

-- ---------------------------------------------------------------------------
-- Access control — server-only, no exceptions
-- ---------------------------------------------------------------------------
-- RLS on with NO permissive policy: anon and authenticated can neither read
-- nor write. Routing is not something a browser may see, let alone influence.
ALTER TABLE "public"."providers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."models" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."model_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."provider_models" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."model_routes" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['providers','models','model_versions','provider_models','model_routes'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.%I TO service_role', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Seed — derived from src/lib/orchestration/model-registry.ts
-- ---------------------------------------------------------------------------
-- One enabled route per registry model, at the same priority. This mirrors
-- today's behaviour exactly: the registry already resolves each model to one
-- provider, so seeding anything else would be inventing a routing decision
-- nobody made. A SECOND route is an operational act, performed through the
-- admin service — which is why that service exists in this phase.
--
-- A test asserts this seed matches the registry entry for entry, so the two
-- sources cannot silently diverge.

INSERT INTO "public"."providers" ("id", "label") VALUES
  ('mock', 'Cinefield Mock'),
  ('fal', 'fal.ai'),
  ('cloudflare-workers-ai', 'Cloudflare Workers AI'),
  ('gemini', 'Google Gemini')
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "public"."models" ("id", "label", "generation_type") VALUES
  ('mock-image',            'Cinefield Mock Image',       'image'),
  ('mock-image-edit',       'Cinefield Mock Image Edit',  'image'),
  ('mock-video',            'Cinefield Mock Video',       'video'),
  ('mock-tts',              'Cinefield Mock TTS',         'audio'),
  ('fal-flux-schnell',      'FLUX Schnell',               'image'),
  ('fal-flux-dev',          'FLUX Dev',                   'image'),
  ('fal-seedream-v4',       'Seedream v4',                'image'),
  ('fal-recraft-v3',        'Recraft v3',                 'image'),
  ('fal-z-image-turbo',     'Z-Image Turbo',              'image'),
  ('fal-nano-banana',       'Nano Banana (fal)',          'image'),
  ('fal-nano-banana-2',     'Nano Banana 2 (fal)',        'image'),
  ('cloudflare-melotts',    'MeloTTS',                    'audio'),
  ('cloudflare-aura-2-en',  'Aura 2 EN',                  'audio'),
  ('nano-banana-pro',       'Nano Banana Pro',            'image'),
  ('nano-banana-2',         'Nano Banana 2',              'image'),
  ('nano-banana-2-lite',    'Nano Banana 2 Lite',         'image')
ON CONFLICT ("id") DO NOTHING;

-- Version 1 for every model.
INSERT INTO "public"."model_versions" ("model_id", "version", "status")
SELECT "id", 1, 'active' FROM "public"."models"
ON CONFLICT ("model_id", "version") DO NOTHING;

INSERT INTO "public"."provider_models" ("provider_id", "provider_model_id") VALUES
  ('mock',                  'mock-image-v1'),
  ('mock',                  'mock-image-edit-v1'),
  ('mock',                  'mock-video-v1'),
  ('mock',                  'mock-tts-v1'),
  ('fal',                   'fal-ai/flux/schnell'),
  ('fal',                   'fal-ai/flux/dev'),
  ('fal',                   'fal-ai/bytedance/seedream/v4/text-to-image'),
  ('fal',                   'fal-ai/recraft/v3/text-to-image'),
  ('fal',                   'fal-ai/z-image/turbo'),
  ('fal',                   'fal-ai/nano-banana'),
  ('fal',                   'fal-ai/nano-banana-2'),
  ('cloudflare-workers-ai', '@cf/myshell-ai/melotts'),
  ('cloudflare-workers-ai', '@cf/deepgram/aura-2-en'),
  ('gemini',                'gemini-3-pro-image'),
  ('gemini',                'gemini-3.1-flash-image'),
  ('gemini',                'gemini-3.1-flash-lite-image')
ON CONFLICT ("provider_id", "provider_model_id") DO NOTHING;

-- The mapping, written as (cinefield model, provider, provider model) triples
-- so it reads as the registry does.
INSERT INTO "public"."model_routes" ("model_id", "model_version_id", "provider_model_id", "priority")
SELECT m."id", mv."id", pm."id", 100
FROM (VALUES
  ('mock-image',           'mock',                  'mock-image-v1'),
  ('mock-image-edit',      'mock',                  'mock-image-edit-v1'),
  ('mock-video',           'mock',                  'mock-video-v1'),
  ('mock-tts',             'mock',                  'mock-tts-v1'),
  ('fal-flux-schnell',     'fal',                   'fal-ai/flux/schnell'),
  ('fal-flux-dev',         'fal',                   'fal-ai/flux/dev'),
  ('fal-seedream-v4',      'fal',                   'fal-ai/bytedance/seedream/v4/text-to-image'),
  ('fal-recraft-v3',       'fal',                   'fal-ai/recraft/v3/text-to-image'),
  ('fal-z-image-turbo',    'fal',                   'fal-ai/z-image/turbo'),
  ('fal-nano-banana',      'fal',                   'fal-ai/nano-banana'),
  ('fal-nano-banana-2',    'fal',                   'fal-ai/nano-banana-2'),
  ('cloudflare-melotts',   'cloudflare-workers-ai', '@cf/myshell-ai/melotts'),
  ('cloudflare-aura-2-en', 'cloudflare-workers-ai', '@cf/deepgram/aura-2-en'),
  ('nano-banana-pro',      'gemini',                'gemini-3-pro-image'),
  ('nano-banana-2',        'gemini',                'gemini-3.1-flash-image'),
  ('nano-banana-2-lite',   'gemini',                'gemini-3.1-flash-lite-image')
) AS seed(model_id, provider_id, provider_model_id)
JOIN "public"."models" m ON m."id" = seed.model_id
JOIN "public"."model_versions" mv ON mv."model_id" = m."id" AND mv."version" = 1
JOIN "public"."provider_models" pm
  ON pm."provider_id" = seed.provider_id AND pm."provider_model_id" = seed.provider_model_id
ON CONFLICT ("model_version_id", "provider_model_id") DO NOTHING;

COMMENT ON TABLE "public"."model_routes" IS
  'Phase 7-A. Router source of truth: which provider model may serve a Cinefield model version, at what static priority. Server-only; RLS enabled with no permissive policy.';
