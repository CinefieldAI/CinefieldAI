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

for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U postgres -d "$DB" >/dev/null 2>&1; then break; fi
done
docker exec "$CONTAINER" pg_isready -U postgres -d "$DB" >/dev/null

echo "==> applying schema and the REAL migrations"
for f in \
  "$ROOT/supabase/tests/bootstrap_test_schema.sql" \
  "$ROOT/supabase/migrations/20260810120000_generation_attempts.sql" \
  "$ROOT/supabase/migrations/20260812130000_outbox_events.sql" \
  "$ROOT/supabase/migrations/20260813000000_cancellation_outbox.sql"   "$ROOT/supabase/migrations/20260814000000_finalization_outbox.sql"
do
  psql_run -q < "$f" >/dev/null
  echo "    applied $(basename "$f")"
done

echo "==> transaction proofs (cancellation + outbox primitives)"
psql_run < "$ROOT/supabase/tests/test_transactional_outbox.sql" 2>&1 | grep -E "NOTICE|ERROR|PASSED"

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

echo "==> destroying the throwaway container"
