-- ===========================================================================
-- PHASE 11 CLOSURE — dispose of the outbox debt that predates realtime
-- ===========================================================================
-- Before the dispatcher is allowed to run for the first time, the rows already
-- sitting in the outbox have to be dealt with deliberately. Letting a new
-- dispatcher loose on them would be the single most likely way to turn a
-- correct component into a visible incident.
--
-- WHAT IS THERE, MEASURED RATHER THAN ASSUMED (live, before this migration):
--
--   outbox_by_status        pending = 92
--   ever_published          0
--   oldest_pending_age      ~22 hours
--   with_tenant             0        <- every one of them
--   types                   91 x generation.cancelled, 1 x generation.completed
--
-- The 91 cancellations are the Phase 9 stale-generation retirement sweep
-- (20260818010000 / commit 2b27d2c). They describe generations that were
-- retired as abandoned a day ago. The single completion is older still.
--
-- WHY THEY ARE RETIRED RATHER THAN DELIVERED.
--
-- Every one of them predates the tenant capture added in 20260824000000, so
-- `tenant_id` is NULL and the Notification Service would refuse all 92 as
-- `unroutable`. Nothing would be broadcast either way — the fail-closed path
-- already holds. So this is not a safety fix.
--
-- It is an OBSERVABILITY fix, and that is worth doing before the first run
-- rather than after. Left alone, the debt metric would open with 92
-- `unroutable` rows on day one, and the first genuine unroutable event — an
-- emitter that forgot to capture a tenant — would be one line in a hundred
-- that everybody has already learned to ignore. A signal that starts at
-- ninety-two is not a signal.
--
-- WHY THEY ARE NOT DELETED. The rows are the audit trail of what the system
-- did; deleting them destroys evidence to tidy a number. `retired` is a
-- terminal disposition that says, in the row itself, that a human decided
-- this was never to be delivered and why.
--
-- WHY THE PREDICATE IS NARROW. This retires only rows that are BOTH
-- untenanted AND older than this migration. A row created after the realtime
-- lane exists must never be silently retired by a migration — if one is
-- untenanted, that is a defect to see, not to sweep.
-- ===========================================================================

DO $$
DECLARE
  v_retired integer;
  v_remaining integer;
BEGIN
  UPDATE outbox_events
     SET realtime_status = 'done',
         realtime_completed_at = now(),
         realtime_disposition = 'retired',
         realtime_last_error_code = 'pre_realtime_untenanted',
         realtime_claim_token = NULL
   WHERE realtime_status = 'pending'
     AND tenant_id IS NULL
     AND created_at < now();

  GET DIAGNOSTICS v_retired = ROW_COUNT;

  SELECT count(*) INTO v_remaining
    FROM outbox_events
   WHERE realtime_status <> 'done';

  RAISE NOTICE 'retired % pre-realtime untenanted outbox rows; % remain owed to realtime',
    v_retired, v_remaining;

  -- The Kafka lane is deliberately untouched: these rows are still `pending`
  -- for `status`, so if Kafka is ever activated it receives them and decides
  -- for itself. Retiring one sink must not retire another.
  IF EXISTS (
    SELECT 1 FROM outbox_events
     WHERE realtime_disposition = 'retired' AND status <> 'pending'
  ) THEN
    RAISE EXCEPTION 'realtime retirement must not have altered the kafka lane';
  END IF;
END $$;
