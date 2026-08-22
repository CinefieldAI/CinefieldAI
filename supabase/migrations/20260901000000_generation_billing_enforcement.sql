-- Cinefield production security hardening — generation billing enforcement.
--
-- The execution boundary now requires a held credit reservation before a real
-- provider may run. This migration closes the other half of that lifecycle:
-- the hold is settled/refunded from the durable generation state transition,
-- inside the SAME Postgres transaction that makes the generation terminal.
--
-- Why a trigger instead of application callbacks:
--   * every terminal writer already converges on generations.status;
--   * completion/failure/cancellation cannot commit while billing silently
--     fails, and billing cannot commit without the matching state change;
--   * retries remain idempotent because settle_reservation/refund_reservation
--     already no-op on non-held reservations.
--
-- Retryable failures intentionally KEEP the hold. resetForRetry() requeues the
-- same generation and therefore must not reserve/charge a second time. A later
-- non-retryable failure, cancellation, completion, or the existing reservation
-- expiry reaper resolves the hold.

CREATE OR REPLACE FUNCTION "public"."finalize_generation_credit_hold"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_reservation_id uuid;
  v_retryable_text text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('completed', 'failed', 'cancelled') THEN
    RETURN NEW;
  END IF;

  -- Mock/dev generations legitimately have no reservation. Legacy rows that
  -- were already running before this deployment may also have none. In both
  -- cases there is nothing for this trigger to settle; the provider worker
  -- gate prevents any NEW real-provider submission without a hold.
  SELECT id
    INTO v_reservation_id
    FROM credit_reservations
   WHERE generation_id = NEW.id
     AND clerk_user_id = NEW.clerk_user_id
     AND status = 'held'
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'completed' THEN
    PERFORM settle_reservation(v_reservation_id, NULL);
    RETURN NEW;
  END IF;

  IF NEW.status = 'cancelled' THEN
    PERFORM refund_reservation(v_reservation_id, 'generation_cancelled');
    RETURN NEW;
  END IF;

  -- A retryable failure is an intermediate orchestration state even though
  -- generations.status temporarily says "failed". Preserve the SAME hold so
  -- resetForRetry() cannot double-reserve the request. Missing/malformed is
  -- treated as non-retryable (fail closed) rather than assumed retryable.
  v_retryable_text := NEW.metadata #>> '{orchestration,retryable}';
  IF v_retryable_text IS DISTINCT FROM 'true' THEN
    PERFORM refund_reservation(v_reservation_id, 'generation_failed');
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."finalize_generation_credit_hold"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."finalize_generation_credit_hold"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."finalize_generation_credit_hold"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."finalize_generation_credit_hold"() FROM "authenticated";

DROP TRIGGER IF EXISTS "generations_finalize_credit_hold" ON "public"."generations";
CREATE TRIGGER "generations_finalize_credit_hold"
AFTER UPDATE OF "status" ON "public"."generations"
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION "public"."finalize_generation_credit_hold"();

COMMENT ON FUNCTION "public"."finalize_generation_credit_hold"() IS
  'Security hardening: transactionally settles held generation credits on completion, refunds on cancellation/non-retryable failure, and preserves the same hold across retryable failures.';
