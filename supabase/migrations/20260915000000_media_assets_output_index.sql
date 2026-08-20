-- Phase 9 multi-output asset model (unblocks Phase 27 closure).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- `media_assets_generation_original_uniq` allowed exactly ONE role='original'
-- row per generation. That was deliberate and load-bearing — its own comment
-- says so: "This is the constraint that makes retry converge instead of
-- accumulating: a second attempt to store the same generation's output finds
-- this row rather than creating a rival."
--
-- But a generation can legitimately resolve to SEVERAL outputs. /generate
-- defaults to a batch of 3, /image sends image_count, and six enabled fal
-- image models declare maxOutputCount: 4 — fal's adapter returns one output
-- per image. With a single-original constraint those extra outputs had
-- nowhere to live, and Phase 27 refused the whole generation rather than
-- deliver unmarked media.
--
-- The fix is to widen the identity, NOT to weaken it. Output index becomes
-- part of the key: retry for output i still converges on output i's row,
-- exactly as before, while outputs 0..N-1 coexist. Idempotency is preserved
-- by construction rather than by hoping callers behave.
--
-- ADDITIVE AND BACKFILL-SAFE
-- --------------------------
-- `output_index` defaults to 0, so every existing row keeps its current
-- identity and the widened index is equivalent to the old one for them. No
-- data is rewritten, no row changes meaning, and a deployment that rolls back
-- to the previous code still finds each generation's output 0 where it left
-- it. No RLS change, no grant change, no new table, no new storage authority.

ALTER TABLE "public"."media_assets"
  ADD COLUMN IF NOT EXISTS "output_index" integer NOT NULL DEFAULT 0;

-- Bounded on purpose. The real ceiling is the model's own maxOutputCount
-- (capability-validator.ts stays the owner of that); this is a storage-layer
-- backstop so a bug upstream cannot write an unbounded fan-out.
ALTER TABLE "public"."media_assets"
  DROP CONSTRAINT IF EXISTS "media_assets_output_index_bounded";
ALTER TABLE "public"."media_assets"
  ADD CONSTRAINT "media_assets_output_index_bounded"
  CHECK ("output_index" >= 0 AND "output_index" <= 99);

-- Replace the single-original index with the widened one. Dropped and
-- recreated rather than added alongside: leaving the old one would keep
-- refusing the second output, which is the whole defect.
DROP INDEX IF EXISTS "public"."media_assets_generation_original_uniq";

CREATE UNIQUE INDEX IF NOT EXISTS "media_assets_generation_output_uniq"
  ON "public"."media_assets" ("generation_id", "output_index")
  WHERE (("generation_id" IS NOT NULL) AND ("role" = 'original'::"text"));

-- Ordered reads of one generation's outputs (delivery, admin, verification).
CREATE INDEX IF NOT EXISTS "media_assets_generation_output_idx"
  ON "public"."media_assets" ("generation_id", "output_index")
  WHERE ("generation_id" IS NOT NULL);
