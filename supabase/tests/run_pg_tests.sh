#!/usr/bin/env bash
#
# Cinefield Phase 6R-E — run the SQL proofs against a THROWAWAY PostgreSQL.
#
# Never touches Supabase. Starts a disposable container, applies the real
# migrations verbatim, runs the proofs, and destroys the container.
#
#   bash supabase/tests/run_pg_tests.sh
#
# Requires Docker. Exits non-zero on the first failed proof.

set -euo pipefail

CONTAINER=cinefield-pgtest
IMAGE=postgres:16-alpine
DB=cinefield_test
# Throwaway, local-only, never reachable from outside this machine. This is
# not a secret and is not reused anywhere.
PGPASS=throwaway-local-only

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

psql_run() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d "$DB" "$@"; }

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -f /tmp/cinefield-pg-a.fifo
}
trap cleanup EXIT

echo "==> starting throwaway PostgreSQL"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD="$PGPASS" -e POSTGRES_DB="$DB" \
  "$IMAGE" >/dev/null

# Readiness is probed with a REAL QUERY against the target database, not with
# pg_isready. pg_isready only asks whether the SERVER is accepting connections,
# and postgres starts accepting them before initdb has finished creating
# POSTGRES_DB — so it reports ready and the very next psql dies with
# 'database "cinefield_test" does not exist'. Selecting 1 from the actual
# database is the only probe that means what this loop needs it to mean.
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" psql -U postgres -d "$DB" -c 'SELECT 1' >/dev/null 2>&1; then break; fi
  sleep 2
done
docker exec "$CONTAINER" pg_isready -U postgres -d "$DB" >/dev/null

echo "==> applying schema and the REAL migrations"
for f in \
  "$ROOT/supabase/tests/bootstrap_test_schema.sql" \
  "$ROOT/supabase/migrations/20260810120000_generation_attempts.sql" \
  "$ROOT/supabase/migrations/20260812130000_outbox_events.sql" \
  "$ROOT/supabase/migrations/20260811120000_credit_system.sql"   "$ROOT/supabase/migrations/20260813000000_cancellation_outbox.sql"   "$ROOT/supabase/migrations/20260814000000_finalization_outbox.sql" \
  "$ROOT/supabase/migrations/20260815000000_fix_cancel_metadata_nesting.sql" \
  "$ROOT/supabase/migrations/20260816000000_server_side_generation_create.sql"   "$ROOT/supabase/migrations/20260817000000_model_routing.sql" \
  "$ROOT/supabase/migrations/20260818000000_workflow_start_outbox.sql" \
  "$ROOT/supabase/migrations/20260818010000_retire_historical_start_intents.sql" \
  "$ROOT/supabase/migrations/20260819000000_persist_cancel_reason.sql" \
  "$ROOT/supabase/migrations/20260820000000_media_assets.sql" \
  "$ROOT/supabase/migrations/20260821000000_media_ingest_gate.sql" \
  "$ROOT/supabase/migrations/20260822000000_dr_backup_metadata.sql"   "$ROOT/supabase/migrations/20260823000000_quarantine_release_lane.sql"   "$ROOT/supabase/migrations/20260824000000_event_contract_and_tenant_routing.sql"   "$ROOT/supabase/migrations/20260825000000_outbox_realtime_delivery_lane.sql"   "$ROOT/supabase/migrations/20260825000100_retire_pre_realtime_outbox_debt.sql"
do
  psql_run -q < "$f" >/dev/null
  echo "    applied $(basename "$f")"
done

echo "==> transaction proofs (cancellation + outbox primitives)"
psql_run < "$ROOT/supabase/tests/test_transactional_outbox.sql" 2>&1 | grep -E "NOTICE|ERROR|PASSED"

echo "==> workflow-start reliability proofs (M6)"
psql_run < "$ROOT/supabase/tests/test_workflow_start_outbox.sql" 2>&1 | grep -E "NOTICE|ERROR|PASSED"

echo "==> media asset proofs (Phase 9-A)"
psql_run < "$ROOT/supabase/tests/test_media_assets.sql" 2>&1 | grep -E "NOTICE|ERROR|PASSED"

echo "==> media ingest gate proofs (Phase 9-B)"
psql_run < "$ROOT/supabase/tests/test_media_ingest_gate.sql" 2>&1 | grep -E "NOTICE|ERROR|PASSED"

echo "==> realtime dispatch lane proofs (Phase 11 closure)"
psql_run < "$ROOT/supabase/tests/test_realtime_dispatch_lane.sql" 2>&1 | grep -E "NOTICE|ERROR|PASSED"

echo "==> notification routing proofs (Phase 11-A)"
psql_run < "$ROOT/supabase/tests/test_notification_routing.sql" 2>&1 | grep -E "NOTICE|ERROR|PASSED"

echo "==> quarantine release proofs (Phase 9-E)"
psql_run < "$ROOT/supabase/tests/test_quarantine_release.sql" 2>&1 | grep -E "NOTICE|ERROR|PASSED"

echo "==> DR backup proofs (Phase 9-D)"
psql_run < "$ROOT/supabase/tests/test_dr_backup.sql" 2>&1 | grep -E "NOTICE|ERROR|PASSED"

echo "==> finalization proofs (completed + failed)"
psql_run < "$ROOT/supabase/tests/test_finalization_outbox.sql" 2>&1 | grep -E "NOTICE|ERROR|PASSED"

# ---------------------------------------------------------------------------
# Claim concurrency — two genuinely separate connections.
#
# The handshake is observable rather than timed. Session A, in one open
# transaction, claims the rows and THEN takes an advisory lock. An advisory
# lock is visible to other connections immediately without committing, so the
# moment the host can see it, A provably holds the row locks too. Only then
# does session B run.
#
# A's trailing pg_sleep is just a generous ceiling on how long B may take; the
# correctness of the test does not depend on its duration, only the liveness
# of the handshake does.
# ---------------------------------------------------------------------------
echo "==> claim concurrency (two connections)"
psql_run -q -c "TRUNCATE outbox_events CASCADE;" >/dev/null
psql_run -q -c "SELECT emit_outbox_event('generation.cancelled',1,'generation',gen_random_uuid()::text,'{\"generationId\":\"x\"}'::jsonb) FROM generate_series(1,3);" >/dev/null
psql_run -q -c "CREATE TABLE IF NOT EXISTS b_result(claimed integer);" >/dev/null
psql_run -q -c "TRUNCATE b_result;" >/dev/null

docker exec -i "$CONTAINER" psql -qtA -U postgres -d "$DB" > /tmp/cinefield-pg-a.out 2>&1 <<'SQL' &
BEGIN;
SELECT count(*) FROM claim_outbox_events(10, 300);
SELECT pg_advisory_xact_lock(776699);
SELECT pg_sleep(30);
COMMIT;
SQL
A_PID=$!

# Wait for the advisory lock: its presence proves A has already claimed and
# its transaction is still open.
A_READY=0
for _ in $(seq 1 300); do
  n=$(docker exec "$CONTAINER" psql -qtA -U postgres -d "$DB" \
        -c "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND granted;" 2>/dev/null | tr -d '[:space:]')
  if [ "$n" = "1" ]; then A_READY=1; break; fi
done
[ "$A_READY" = "1" ] || { echo "ERROR: session A never took its advisory lock"; cat /tmp/cinefield-pg-a.out; exit 1; }

# Session B, while A still holds every row.
psql_run -q -c "INSERT INTO b_result SELECT count(*) FROM claim_outbox_events(10, 300);" >/dev/null

# Release A by ending its backend; the transaction rolls back, which is fine —
# what mattered was what B saw while the locks were held. The rows' claimed
# state is re-established below before the lease assertion.
docker exec "$CONTAINER" psql -qtA -U postgres -d "$DB" \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DB' AND pid <> pg_backend_pid() AND state <> 'idle';" >/dev/null 2>&1 || true
wait "$A_PID" 2>/dev/null || true

# A's transaction rolled back, so re-establish a committed claim for the
# lease assertion that follows.
psql_run -q -c "SELECT count(*) FROM claim_outbox_events(10, 300);" >/dev/null

psql_run <<'SQL' 2>&1 | grep -E "NOTICE|ERROR|PASSED"
\set ON_ERROR_STOP on
DO $$
DECLARE v_b integer; v_publishing integer;
BEGIN
  SELECT claimed INTO v_b FROM b_result LIMIT 1;
  ASSERT v_b = 0,
    'CONCURRENCY: session B must skip every row session A holds, but it claimed ' || v_b;

  SELECT count(*) INTO v_publishing FROM outbox_events WHERE status = 'publishing';
  ASSERT v_publishing = 3,
    'CONCURRENCY: all three rows should be held by A, got ' || v_publishing;

  RAISE NOTICE 'PROOF H PASS: no outbox row is ever claimed by two publishers';
END $$;

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM claim_outbox_events(10, 300);
  ASSERT n = 0,
    'CONCURRENCY: rows inside an active lease must not be re-claimed, got ' || n;
  RAISE NOTICE 'PROOF I PASS: an active publish lease is respected';
END $$;
SELECT 'CONCURRENCY PROOFS PASSED' AS result;
SQL


# ---------------------------------------------------------------------------
# Phase 6R-G — REAL PARALLEL RACES
#
# Each racer is its own psql PROCESS on its own connection, launched with &
# and joined with wait. That is genuine simultaneity: the outcomes are decided
# by PostgreSQL's row locks and unique indexes, not by JavaScript await
# ordering. Nothing here asserts an ORDER — only the invariants, because
# ordering under contention is not deterministic and a test that depended on
# it would be flaky rather than informative.
# ---------------------------------------------------------------------------
echo "==> Phase 7-A routing schema proofs"
psql_run < "$ROOT/supabase/tests/test_model_routing.sql" 2>&1 | grep -E "NOTICE|ERROR|PASSED"

echo "==> concurrency race fixtures"
psql_run -q < "$ROOT/supabase/tests/test_concurrency_races.sql" >/dev/null
echo "    fixtures ready"

# Launches N parallel connections, each running the same SQL with its worker
# index substituted for %d.
race() {
  local n="$1"; shift
  local sql_template="$1"
  local pids=()
  for i in $(seq 1 "$n"); do
    local sql="${sql_template//__W__/$i}"
    docker exec -i "$CONTAINER" psql -qtA -U postgres -d "$DB" -c "$sql" >/dev/null 2>&1 &
    pids+=($!)
  done
  for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || true; done
}

echo "==> race: provider attempt claim (6 connections)"
race 6 "SELECT claim_attempt_race('55555555-5555-4555-8555-555555555555', __W__);"

echo "==> race: duplicate credit reserve, same idempotency key (6 connections)"
race 6 "SELECT reserve_race(__W__, 'idem-race-key', 100, '44444444-4444-4444-8444-444444444444');"

echo "==> race: duplicate settle of one reservation (6 connections)"
RESERVATION=$(psql_run -qtA -c "SELECT id FROM credit_reservations WHERE clerk_user_id='user_race' LIMIT 1;" | tr -d '[:space:]')
race 6 "SELECT settle_race(__W__, '${RESERVATION}'::uuid);"

echo "==> race: settle vs refund of one reservation (2 connections, opposite intents)"
psql_run -q -c "INSERT INTO profiles (clerk_user_id, plan, credits) VALUES ('user_race2','pro',1000) ON CONFLICT DO NOTHING;" >/dev/null
psql_run -q -c "INSERT INTO credit_wallets (clerk_user_id, balance, reserved) VALUES ('user_race2',1000,0) ON CONFLICT DO NOTHING;" >/dev/null
psql_run -q -c "SELECT reserve_credits('user_race2', 100, 'idem-settle-refund-race', NULL, '{}'::jsonb);" >/dev/null
RES2=$(psql_run -qtA -c "SELECT id FROM credit_reservations WHERE clerk_user_id='user_race2' LIMIT 1;" | tr -d '[:space:]')
docker exec -i "$CONTAINER" psql -qtA -U postgres -d "$DB"   -c "SELECT settle_or_refund_race(1, '${RES2}'::uuid, 'settle');" >/dev/null 2>&1 &
P1=$!
docker exec -i "$CONTAINER" psql -qtA -U postgres -d "$DB"   -c "SELECT settle_or_refund_race(2, '${RES2}'::uuid, 'refund');" >/dev/null 2>&1 &
P2=$!
wait "$P1" 2>/dev/null || true; wait "$P2" 2>/dev/null || true

echo "==> race: insufficient funds / TOCTOU overdraw (6 connections)"
psql_run -q -c "INSERT INTO profiles (clerk_user_id, plan, credits) VALUES ('user_overdraw','pro',100) ON CONFLICT DO NOTHING;" >/dev/null
psql_run -q -c "INSERT INTO credit_wallets (clerk_user_id, balance, reserved) VALUES ('user_overdraw',100,0) ON CONFLICT DO NOTHING;" >/dev/null
psql_run -q -c "CREATE OR REPLACE FUNCTION public.overdraw_race(p_worker integer) RETURNS void LANGUAGE plpgsql AS \$fn\$ DECLARE v jsonb; BEGIN v := reserve_credits('user_overdraw', 80, 'idem-over-' || p_worker, NULL, '{}'::jsonb); INSERT INTO race_results (race, worker, outcome, detail) VALUES ('overdraw', p_worker, CASE WHEN (v->>'replayed')::boolean THEN 'replayed' ELSE 'created' END, v->>'reservation_id'); EXCEPTION WHEN others THEN INSERT INTO race_results (race, worker, outcome, detail) VALUES ('overdraw', p_worker, 'rejected', SQLERRM); END; \$fn\$;" >/dev/null
race 6 "SELECT overdraw_race(__W__);"

echo "==> race: terminal transition complete vs fail vs cancel (3 connections)"
psql_run -q -c "INSERT INTO generations (id, project_id, clerk_user_id, generation_type, provider, model, prompt, status) VALUES ('66666666-6666-4666-8666-666666666666','33333333-3333-4333-8333-333333333333','user_race','image','mock','mock-image','terminal race','processing');" >/dev/null
docker exec -i "$CONTAINER" psql -qtA -U postgres -d "$DB" -c "SELECT terminal_race(1,'66666666-6666-4666-8666-666666666666','complete');" >/dev/null 2>&1 &
T1=$!
docker exec -i "$CONTAINER" psql -qtA -U postgres -d "$DB" -c "SELECT terminal_race(2,'66666666-6666-4666-8666-666666666666','fail');" >/dev/null 2>&1 &
T2=$!
docker exec -i "$CONTAINER" psql -qtA -U postgres -d "$DB" -c "SELECT terminal_race(3,'66666666-6666-4666-8666-666666666666','cancel');" >/dev/null 2>&1 &
T3=$!
wait "$T1" 2>/dev/null || true; wait "$T2" 2>/dev/null || true; wait "$T3" 2>/dev/null || true

echo "==> race: duplicate endpoint request, same generation (6 connections)"
race 6 "SELECT ensure_attempt_race(__W__, '77777777-7777-4777-8777-777777777777');"

echo "==> race: duplicate cancel intent (6 connections)"
race 6 "SELECT cancel_intent_race(__W__, '88888888-8888-4888-8888-888888888888');"

echo "==> race: server-side generation creation, same idempotency key (6 connections)"
race 6 "SELECT create_generation_race(__W__, 'idem-create-race-key');"

# ---------------------------------------------------------------------------
# Phase 9-E — quarantine release races.
#
# Each fixture is seeded with ONE approval already banked, so every racer's
# own approval reaches the two-person threshold. Without the row lock in
# approve_media_release they would all release; with it, exactly one does.
# ---------------------------------------------------------------------------
psql_run -q -c "CREATE TABLE IF NOT EXISTS release_race_assets (tag text PRIMARY KEY, asset_id uuid);" >/dev/null

seed_release_fixture() {
  local tag="$1" seed_approval="$2" id
  id=$(psql_run -qtA -c "SELECT mk_evidenced_asset('${tag}');" | tr -d '[:space:]')
  psql_run -q -c "UPDATE media_assets SET moderation_status='passed', moderated_at=now() WHERE id='${id}';" >/dev/null
  if [ "$seed_approval" = "yes" ]; then
    psql_run -q -c "SELECT approve_media_release('${id}'::uuid, 'admin_seed', 'ops_review');" >/dev/null
  fi
  psql_run -q -c "INSERT INTO release_race_assets (tag, asset_id) VALUES ('${tag}', '${id}') ON CONFLICT (tag) DO UPDATE SET asset_id = EXCLUDED.asset_id;" >/dev/null
  echo "$id"
}

echo "==> race: concurrent quarantine release, one approval already banked (6 connections)"
RC1=$(seed_release_fixture rc1 yes)
race 6 "SELECT release_race(__W__, '${RC1}'::uuid, 'admin_race_' || __W__);"

echo "==> race: duplicate reject of one asset (6 connections)"
RC2=$(seed_release_fixture rc2 no)
race 6 "SELECT reject_race(__W__, '${RC2}'::uuid);"

echo "==> race: release vs reject of one asset (2 connections, opposite intents)"
RC3=$(seed_release_fixture rc3 yes)
docker exec -i "$CONTAINER" psql -qtA -U postgres -d "$DB" -c "SELECT release_vs_reject_race(1, '${RC3}'::uuid, 'admin_rel', 'release');" >/dev/null 2>&1 &
V1=$!
docker exec -i "$CONTAINER" psql -qtA -U postgres -d "$DB" -c "SELECT release_vs_reject_race(2, '${RC3}'::uuid, 'admin_rej', 'reject');" >/dev/null 2>&1 &
V2=$!
wait "$V1" 2>/dev/null || true; wait "$V2" 2>/dev/null || true

echo "==> race: concurrent claim of one queued generation (6 connections)"
psql_run -q -c "CREATE TABLE IF NOT EXISTS notification_race_fixtures (tag text PRIMARY KEY, generation_id uuid, clerk_user_id text);" >/dev/null
NR1_USER=$(psql_run -qtA -c "SELECT o_user FROM mk_tenant_project('nr1');" | tr -d '[:space:]')
NR1_PROJ=$(psql_run -qtA -c "SELECT id FROM projects WHERE clerk_user_id='${NR1_USER}' LIMIT 1;" | tr -d '[:space:]')
NR1_GEN=$(psql_run -qtA -c "SELECT create_generation_tx('${NR1_USER}','${NR1_PROJ}'::uuid,'image','mock','mock-image','p','{}'::jsonb,NULL,NULL,'idem-nr1-key','h')->>'generation_id';" | tr -d '[:space:]')
psql_run -q -c "INSERT INTO notification_race_fixtures VALUES ('nr1','${NR1_GEN}'::uuid,'${NR1_USER}') ON CONFLICT (tag) DO UPDATE SET generation_id=EXCLUDED.generation_id, clerk_user_id=EXCLUDED.clerk_user_id;" >/dev/null
race 6 "SELECT claim_race(__W__, '${NR1_GEN}'::uuid);"

echo "==> race: concurrent creation under one idempotency key (6 connections)"
NR2_USER=$(psql_run -qtA -c "SELECT o_user FROM mk_tenant_project('nr2');" | tr -d '[:space:]')
NR2_PROJ=$(psql_run -qtA -c "SELECT id FROM projects WHERE clerk_user_id='${NR2_USER}' LIMIT 1;" | tr -d '[:space:]')
psql_run -q -c "INSERT INTO notification_race_fixtures VALUES ('nr2',NULL,'${NR2_USER}') ON CONFLICT (tag) DO UPDATE SET clerk_user_id=EXCLUDED.clerk_user_id;" >/dev/null
race 6 "SELECT create_event_race(__W__, '${NR2_USER}', '${NR2_PROJ}'::uuid, 'idem-nr2-shared');"

echo "==> race: concurrent realtime dispatchers (6 connections)"
# Seed several owed events, then let six dispatchers claim at once.
for i in 1 2 3 4 5 6 7 8; do
  psql_run -q -c "SELECT mk_realtime_event('drace' || $i);" >/dev/null
done
race 6 "SELECT dispatch_claim_race(__W__);"

echo "==> dispatcher race invariants"
psql_run < "$ROOT/supabase/tests/assert_dispatch_races.sql" 2>&1 | grep -E "NOTICE|ERROR|PASSED"

echo "==> Phase 11-A race invariants"
psql_run < "$ROOT/supabase/tests/assert_notification_races.sql" 2>&1 | grep -E "NOTICE|ERROR|PASSED"

echo "==> Phase 9-E race invariants"
psql_run < "$ROOT/supabase/tests/assert_quarantine_release_races.sql" 2>&1 | grep -E "NOTICE|ERROR|PASSED"

echo "==> race invariants"
psql_run < "$ROOT/supabase/tests/assert_concurrency_races.sql" 2>&1 | grep -E "NOTICE|ERROR|PASSED"

echo "==> destroying the throwaway container"
