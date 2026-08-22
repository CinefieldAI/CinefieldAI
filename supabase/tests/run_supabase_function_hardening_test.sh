#!/usr/bin/env bash
# Focused Supabase function-permission hardening proof.
# Never touches Supabase. Applies every real migration to a disposable local
# PostgreSQL container, runs the privilege/search_path assertions, then removes
# the container.

set -euo pipefail

CONTAINER=cinefield-pg-function-hardening
IMAGE=postgres:16-alpine
DB=cinefield_function_hardening
PGPASS=throwaway-local-only
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# shellcheck source=./lib_pg_migrations.sh
source "$ROOT/supabase/tests/lib_pg_migrations.sh"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD="$PGPASS" -e POSTGRES_DB="$DB" \
  "$IMAGE" >/dev/null

READY=0
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" psql -U postgres -d "$DB" -c 'SELECT 1' >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 2
done

if [ "$READY" != "1" ]; then
  echo "ERROR: throwaway PostgreSQL did not become ready"
  exit 1
fi

apply_all_migrations "$CONTAINER" "$DB" "$ROOT"

docker exec -i "$CONTAINER" \
  psql -v ON_ERROR_STOP=1 -U postgres -d "$DB" \
  < "$ROOT/supabase/tests/test_supabase_function_hardening.sql" \
  2>&1 | grep -E "NOTICE|ERROR|PASSED"
