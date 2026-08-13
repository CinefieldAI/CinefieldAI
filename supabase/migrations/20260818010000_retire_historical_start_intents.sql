-- ===========================================================================
-- Retire the start intents the M6 backfill should never have left pending
-- ===========================================================================
-- WHAT WENT WRONG
-- 20260818000000 backfilled an intent for every existing generation, marking
-- terminal ones delivered and everything else pending. On the live database
-- "everything else" was 91 rows still sitting in `queued` from early-August
-- test sessions — models like `cinema-3.5` and `test-model` that were never
-- orchestratable, abandoned when the legacy execute route was retired.
--
-- WHY THAT IS DANGEROUS RATHER THAN UNTIDY
-- Those are pending obligations. The relay's whole contract is to make sure
-- an owed workflow eventually starts, so on its first pass it would have
-- started 91 workflows for work nobody asked for — resurrecting months-old
-- abandoned rows, and for any that still resolved to a live model, spending
-- real provider money to do it.
--
-- THE CORRECTION
-- The reliability mechanism exists to protect generations created FROM NOW
-- ON: the ones whose intent is written inside create_generation_tx() in the
-- same transaction. A generation that predates the mechanism was never
-- covered by it, and inventing an obligation retroactively is not recovery —
-- it is replay. Historical intents are therefore retired, marked delivered,
-- and left alone.
--
-- Deciding what to do with the 91 stranded `queued` rows themselves is an
-- operational cleanup with a human in the loop. It is deliberately NOT done
-- here: this migration changes no generation's state.
--
-- Idempotent and safe to run on a fresh database, where it matches nothing.
-- ===========================================================================

UPDATE "public"."workflow_start_outbox" w
SET "status" = 'delivered',
    "delivered_at" = "now"(),
    "claim_token" = NULL,
    "claimed_at" = NULL,
    "last_error_code" = 'retired_predates_reliability_mechanism'
FROM "public"."generations" g
WHERE g."id" = w."generation_id"
  AND w."status" <> 'delivered'
  -- Strictly before this migration. A generation created after it has its
  -- intent from create_generation_tx() and is genuinely owed a workflow.
  AND g."created_at" < TIMESTAMPTZ '2026-08-18 01:00:00+00';


COMMENT ON COLUMN "public"."workflow_start_outbox"."last_error_code" IS
  'Sanitized failure class from the last delivery attempt, or the literal retired_predates_reliability_mechanism for intents backfilled over generations that predate M6 and are therefore not owed a workflow.';
