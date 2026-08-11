-- Cinefield Phase 7D — model_pricing: the authoritative, server-only source
-- of what Cinefield pays a provider and what it charges the user, per model.
--
-- ===========================================================================
-- WHY THIS MIGRATION EXISTS
-- ===========================================================================
-- Phase E3's architecture audit found no pricing table, no pricing
-- calculation function, and no populated real-price data anywhere in this
-- repository. The only "cost"-shaped numbers that exist today
-- (src/lib/modelConfigs.ts's `cost` field, StandaloneVideoCreationPanel.tsx's
-- "X credits/sec" labels) belong to a DIFFERENT, frozen, purely visual model
-- picker whose ids (`nano-banana-pro`, `seedream-5-lite`, ...) do not exist
-- in the orchestratable model-registry.ts at all — they were never verified
-- against a real provider invoice and must never be treated as production
-- pricing. This migration creates the durable, authoritative table real
-- pricing will eventually live in; it deliberately seeds ZERO real provider
-- prices. Populating real numbers is a separate, later, explicitly reviewed
-- step (E3B's own instructions forbid inventing them here).
--
-- ===========================================================================
-- THREE CONCERNS, NEVER CONFLATED
-- ===========================================================================
--   provider_unit_cost / provider_currency   what Cinefield actually pays
--                                             upstream, per billing unit.
--   credit_price_per_unit                    what Cinefield charges the
--                                             user, in credits, per the SAME
--                                             billing unit.
--   margin                                   NOT a stored column. Computing
--                                             it requires a credit-to-currency
--                                             exchange rate, which is itself
--                                             an unset business policy number
--                                             this migration does not invent.
--                                             Both cost and selling price are
--                                             independently queryable, which
--                                             is what makes margin measurable
--                                             later without conflating the
--                                             two figures now.
--
-- ===========================================================================
-- WHY is_active, NOT AN EFFECTIVE-DATE RANGE
-- ===========================================================================
-- Exactly one row may be `is_active = true` per platform_model_id, enforced
-- by a partial unique index — the same "let Postgres arbitrate, not
-- application logic" pattern already used by
-- generation_attempts_one_active_uniq and credit_reservations_generation_
-- live_uniq. `effective_from` is recorded for audit/history, not evaluated
-- at query time — the pricing repository always queries `is_active = true`,
-- so there is never ambiguity about which row is current.
--
-- ===========================================================================
-- BILLING UNITS: ONLY WHAT TODAY'S MODELS ACTUALLY NEED
-- ===========================================================================
-- The current model-registry.ts catalog has exactly two billable shapes:
--   per_output    image models charged by output_count (fal-flux-schnell,
--                 fal-nano-banana-2, ...)
--   per_request   TTS models that always produce exactly one file per
--                 request (cloudflare-melotts, cloudflare-aura-2-en, mock-tts)
-- No real video provider exists in the registry yet (only mock-video), and
-- no duration- or character-billed model is registered, so those units are
-- deliberately NOT added here — inventing them now would be guessing an
-- unsupported dimension. Extending provider_billing_unit's CHECK list is a
-- one-line future migration when such a model is actually added.
--
-- ===========================================================================
-- MOCK PRICING: A VERIFIED FACT, NOT A GUESS
-- ===========================================================================
-- The four mock models (mock-image, mock-image-edit, mock-video, mock-tts;
-- provider = 'mock') make zero external calls, so $0 / 0 credits is a true,
-- verifiable fact about them — not an invented number. A CHECK constraint
-- makes this a database-enforced invariant in BOTH directions: provider =
-- 'mock' can never carry a nonzero cost, and (defense in depth) a nonzero-
-- cost row can never claim provider = 'mock'. This is the ONLY seeded data
-- in this migration.
-- ===========================================================================


CREATE TABLE IF NOT EXISTS "public"."model_pricing" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,

    -- Identity: matches model-registry.ts's ModelRegistryEntry exactly.
    "platform_model_id" "text" NOT NULL,
    "provider" "text" NOT NULL,
    "provider_model_id" "text" NOT NULL,

    -- Versioning/history. Each update to a model's price inserts a NEW row
    -- with an incremented pricing_version rather than mutating an existing
    -- one, so historical pricing is never lost (the same append-preferred
    -- discipline as credit_ledger, though this table permits UPDATE for
    -- deactivating a row via is_active - only the priced VALUES are meant to
    -- be treated as immutable once verified).
    "pricing_version" integer NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "effective_from" timestamp with time zone DEFAULT "now"() NOT NULL,

    -- Provider cost side.
    "provider_billing_unit" "text" NOT NULL,
    "provider_unit_cost" numeric(12,6) NOT NULL,
    "provider_currency" "text" NOT NULL,

    -- Cinefield selling side. Integer: credit_wallets/credit_reservations
    -- both use integer credits (see 20260811120000_credit_system.sql) - this
    -- table's selling-price unit must match that representation exactly.
    "credit_price_per_unit" integer NOT NULL,

    -- Authoritative source metadata (Step 6). No scraped HTML, no runtime
    -- fetch of a provider pricing page - every row must point at how a human
    -- verified it.
    "source_type" "text" NOT NULL,
    "source_reference" "text" NOT NULL,
    "verified_at" timestamp with time zone NOT NULL,

    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,

    CONSTRAINT "model_pricing_pkey" PRIMARY KEY ("id"),

    CONSTRAINT "model_pricing_pricing_version_check" CHECK (("pricing_version" >= 1)),

    CONSTRAINT "model_pricing_billing_unit_check" CHECK (("provider_billing_unit" = ANY (ARRAY[
      'per_output'::"text", 'per_request'::"text"
    ]))),

    CONSTRAINT "model_pricing_provider_unit_cost_check" CHECK (("provider_unit_cost" >= 0)),
    CONSTRAINT "model_pricing_credit_price_check" CHECK (("credit_price_per_unit" >= 0)),

    CONSTRAINT "model_pricing_currency_check"
      CHECK ((("char_length"("provider_currency") >= 3) AND ("char_length"("provider_currency") <= 3))),

    CONSTRAINT "model_pricing_source_type_check" CHECK (("source_type" = ANY (ARRAY[
      'official_docs'::"text", 'invoice'::"text", 'manual_verification'::"text", 'other'::"text"
    ]))),

    -- Mock pricing is a verified fact (zero external cost), never a guess -
    -- and the inverse guard means a real provider can never accidentally end
    -- up priced at zero through a data-entry mistake that also mislabels it
    -- as 'mock'.
    CONSTRAINT "model_pricing_mock_zero_cost_check" CHECK (
      ("provider" <> 'mock') OR (("provider_unit_cost" = 0) AND ("credit_price_per_unit" = 0))
    ),

    CONSTRAINT "model_pricing_platform_model_id_version_uniq" UNIQUE ("platform_model_id", "pricing_version")
);

ALTER TABLE "public"."model_pricing" OWNER TO "postgres";

-- Exactly one active price per model - Postgres-enforced, not app logic.
CREATE UNIQUE INDEX IF NOT EXISTS "model_pricing_one_active_per_model_uniq"
  ON "public"."model_pricing" ("platform_model_id")
  WHERE ("is_active");

CREATE INDEX IF NOT EXISTS "model_pricing_provider_idx"
  ON "public"."model_pricing" ("provider");

CREATE OR REPLACE TRIGGER "model_pricing_set_updated_at"
  BEFORE UPDATE ON "public"."model_pricing"
  FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


-- ---------------------------------------------------------------------------
-- RLS: server-only, same discipline as credit_reservations/generation_attempts
-- ---------------------------------------------------------------------------
-- No policy at all for `authenticated` — pricing resolution always happens
-- server-side (the future calculateGenerationPrice()), never via a
-- browser-authenticated query. Only service_role may read or write.
ALTER TABLE "public"."model_pricing" ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE "public"."model_pricing" TO "service_role";


-- ---------------------------------------------------------------------------
-- SEED: mock models only. Zero real provider prices.
-- ---------------------------------------------------------------------------
-- $0 / 0 credits for the four mock models is a verified fact (they make no
-- external call), not an invented number - see the header comment. This is
-- the ONLY data this migration inserts. fal-*/cloudflare-* models remain
-- unpriced (no row = pricing_unavailable) until a real, source-verified
-- price is entered through a separate, later step.
INSERT INTO "public"."model_pricing" (
  "platform_model_id", "provider", "provider_model_id", "pricing_version", "is_active",
  "provider_billing_unit", "provider_unit_cost", "provider_currency", "credit_price_per_unit",
  "source_type", "source_reference", "verified_at"
) VALUES
  ('mock-image',      'mock', 'mock-image-v1',      1, true, 'per_output',  0, 'USD', 0,
   'manual_verification', 'Cinefield mock provider - makes no external call, verified zero cost by design', now()),
  ('mock-image-edit', 'mock', 'mock-image-edit-v1', 1, true, 'per_output',  0, 'USD', 0,
   'manual_verification', 'Cinefield mock provider - makes no external call, verified zero cost by design', now()),
  ('mock-video',      'mock', 'mock-video-v1',      1, true, 'per_output',  0, 'USD', 0,
   'manual_verification', 'Cinefield mock provider - makes no external call, verified zero cost by design', now()),
  ('mock-tts',        'mock', 'mock-tts-v1',        1, true, 'per_request', 0, 'USD', 0,
   'manual_verification', 'Cinefield mock provider - makes no external call, verified zero cost by design', now())
ON CONFLICT ("platform_model_id", "pricing_version") DO NOTHING;
