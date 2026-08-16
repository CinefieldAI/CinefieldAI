#!/usr/bin/env bash
#
# Cinefield Phase 15-C/2 — REAL pg_dump -> pg_restore throwaway round trip.
#
# Proves what supabase/tests/run_pg_tests.sh cannot: that a backup, once
# restored, matches the source it was taken from. run_pg_tests.sh rebuilds a
# database FROM MIGRATIONS every time; this script builds one database,
# takes a REAL pg_dump of it, restores that dump into a SEPARATE throwaway
# database, and validates the restored copy through the production
# RestoreEvidenceSource / runRestoreValidation code path — the same engine
# runRestoreVerification calls in production.
#
#   bash supabase/tests/run_pg_restore_proof.sh
#
# Requires Docker. Never touches Supabase, AWS, or any production system.
# Exits non-zero on the first failed proof.

set -euo pipefail

SRC_CONTAINER=cinefield-pg-restore-src
TGT_CONTAINER=cinefield-pg-restore-tgt
IMAGE=postgres:16-alpine
DB=cinefield_restore_proof
PGPASS=throwaway-local-only

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=./lib_pg_migrations.sh
source "$ROOT/supabase/tests/lib_pg_migrations.sh"

WORKDIR="$(mktemp -d)"
DUMP_HOST="$WORKDIR/restore-proof.dump"
EXPECTED_JSON="$WORKDIR/expected.json"
RESTORE_ID="restore-proof-$(date +%s 2>/dev/null || echo static)"
BACKUP_ID="backup-proof"

cleanup() {
  docker rm -f "$SRC_CONTAINER" >/dev/null 2>&1 || true
  docker rm -f "$TGT_CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

wait_ready() {
  local container="$1" db="$2"
  for _ in $(seq 1 60); do
    if docker exec "$container" psql -U postgres -d "$db" -c 'SELECT 1' >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  echo "ERROR: $container never became ready" >&2
  exit 1
}

verify() {
  # $1 = target container, $2 = target db, $3 = expected state, $4 = label
  local container="$1" db="$2" expect="$3" label="$4"
  echo "==> proof: $label (expect $expect)"
  npx tsx "$ROOT/scripts/dr-restore-proof-verify.ts" \
    --target-container="$container" --target-db="$db" \
    --expected="$EXPECTED_JSON" --expect-state="$expect"
}

# ---------------------------------------------------------------------------
# A. SOURCE DATABASE
# ---------------------------------------------------------------------------
echo "==> [A] starting SOURCE throwaway PostgreSQL"
docker rm -f "$SRC_CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$SRC_CONTAINER" \
  -e POSTGRES_PASSWORD="$PGPASS" -e POSTGRES_DB="$DB" \
  "$IMAGE" >/dev/null
wait_ready "$SRC_CONTAINER" "$DB"

echo "==> [A] applying the complete real migration chain"
apply_all_migrations "$SRC_CONTAINER" "$DB" "$ROOT"

echo "==> [A] seeding the deterministic restore-significant fixture"
FIXTURE_ROW=$(docker exec -i "$SRC_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d "$DB" -qtA -F'|' \
  < "$ROOT/supabase/tests/fixtures_restore_proof.sql" | tail -1)
ASSET_ID=$(echo "$FIXTURE_ROW" | cut -d'|' -f5)
echo "    fixture asset id: $ASSET_ID"

echo "==> [A] capturing EXPECTED evidence from the source, before dump"
npx tsx "$ROOT/scripts/dr-restore-proof-capture-expected.ts" \
  --source-container="$SRC_CONTAINER" --source-db="$DB" \
  --restore-id="$RESTORE_ID" --backup-id="$BACKUP_ID" \
  --asset-id="$ASSET_ID" --out="$EXPECTED_JSON"

# ---------------------------------------------------------------------------
# B. BACKUP — a real pg_dump, custom format (the canonical pg_restore input)
# ---------------------------------------------------------------------------
echo "==> [B] running pg_dump (custom format)"
# --no-privileges: the source's GRANT statements target anon/authenticated/
# service_role, which are cluster-wide roles bootstrap_test_schema.sql
# creates as placeholders — a plain `pg_dump` of one database never includes
# role definitions, so a fresh target container has none of them, and a
# restored GRANT to a role that does not exist fails the restore outright.
# Row-count, checksum and referential-integrity evidence do not depend on
# grants; bootstrap_test_schema.sql's own header already states no proof in
# this harness makes a claim about RLS/privilege behaviour, so excluding
# privileges from the dump gives up nothing this batch verifies.
# MSYS_NO_PATHCONV: on Git Bash for Windows, an argument starting with "/"
# passed to a native .exe is auto-rewritten into a Windows path before the
# process ever sees it — correct for a real host path, wrong here, because
# /tmp/restore-proof.dump names a path INSIDE THE LINUX CONTAINER and must
# reach docker.exe, and then pg_dump, completely unchanged.
MSYS_NO_PATHCONV=1 docker exec "$SRC_CONTAINER" pg_dump -U postgres -d "$DB" -Fc --no-privileges --no-owner -f /tmp/restore-proof.dump
docker cp "$SRC_CONTAINER:/tmp/restore-proof.dump" "$DUMP_HOST" >/dev/null
DUMP_BYTES=$(wc -c < "$DUMP_HOST" | tr -d '[:space:]')
echo "    dump captured: $DUMP_BYTES bytes -> $DUMP_HOST (local temp, never committed)"
[ "$DUMP_BYTES" -gt 0 ] || { echo "ERROR: pg_dump produced an empty file" >&2; exit 1; }

# The source has done its job. Removing it now is itself part of the proof
# that the target is validated in ISOLATION from the source, not against a
# still-running copy of it.
docker rm -f "$SRC_CONTAINER" >/dev/null 2>&1 || true
echo "    source database destroyed — nothing after this point can read it"

# ---------------------------------------------------------------------------
# C. RESTORE TARGET — a SEPARATE throwaway instance, real pg_restore
# ---------------------------------------------------------------------------
echo "==> [C] starting TARGET throwaway PostgreSQL"
docker rm -f "$TGT_CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$TGT_CONTAINER" \
  -e POSTGRES_PASSWORD="$PGPASS" -e POSTGRES_DB="$DB" \
  "$IMAGE" >/dev/null
wait_ready "$TGT_CONTAINER" "$DB"

# The dump's CREATE POLICY statements (RLS, e.g. media_assets_select_own)
# name anon/authenticated/service_role. --no-privileges dropped every GRANT,
# but a POLICY's target role is a different pg_dump object class and is not
# covered by that flag — the restore still needs the roles to EXIST, even
# though nothing in this proof exercises RLS behaviour. Same placeholder
# roles bootstrap_test_schema.sql already creates on the source, for the
# same reason, applied here to the target instead.
echo "==> [C] creating placeholder roles the dump's RLS policies reference"
docker exec "$TGT_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d "$DB" -q -c "
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END \$\$;" >/dev/null

echo "==> [C] restoring with pg_restore"
docker cp "$DUMP_HOST" "$TGT_CONTAINER:/tmp/restore-proof.dump" >/dev/null
MSYS_NO_PATHCONV=1 docker exec "$TGT_CONTAINER" pg_restore -U postgres -d "$DB" --no-owner --exit-on-error /tmp/restore-proof.dump
echo "    restore complete"

# ---------------------------------------------------------------------------
# D. VALIDATE — golden path, then three isolated, sequential corruptions
# ---------------------------------------------------------------------------
verify "$TGT_CONTAINER" "$DB" "VALIDATION_PASSED" "golden round trip"

echo "==> [D] corrupting referential integrity on the TARGET only"
docker exec "$TGT_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d "$DB" -c \
  "ALTER TABLE media_assets ADD CONSTRAINT dr_restore_proof_negative_fkey FOREIGN KEY (parent_asset_id) REFERENCES media_assets(id) NOT VALID;" >/dev/null
verify "$TGT_CONTAINER" "$DB" "VALIDATION_FAILED" "referential-integrity corruption"
docker exec "$TGT_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d "$DB" -c \
  "ALTER TABLE media_assets DROP CONSTRAINT dr_restore_proof_negative_fkey;" >/dev/null

echo "==> [D] mutating the restored checksum on the TARGET only"
docker exec "$TGT_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d "$DB" -c \
  "UPDATE media_assets SET checksum_sha256 = repeat('f', 64) WHERE id = '$ASSET_ID'::uuid;" >/dev/null
verify "$TGT_CONTAINER" "$DB" "VALIDATION_FAILED" "checksum corruption (proves actual digest is re-read from the target, not echoed)"

echo "==> [D] deleting one restored row on the TARGET only"
docker exec "$TGT_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d "$DB" -c \
  "DELETE FROM generation_attempts WHERE generation_id = (SELECT generation_id FROM generation_attempts LIMIT 1);" >/dev/null
verify "$TGT_CONTAINER" "$DB" "VALIDATION_FAILED" "row-count corruption"

echo "==> [D] an unreachable restore target reports RESTORE_NOT_READY, not a pass"
verify "$TGT_CONTAINER" "cinefield_nonexistent_db" "RESTORE_NOT_READY" "unreachable target"

echo "==> all real round-trip proofs passed"
