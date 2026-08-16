#!/usr/bin/env bash
#
# Cinefield Phase 15-C/2 — shared migration-apply logic for throwaway
# PostgreSQL harnesses.
#
# Sourced by both run_pg_tests.sh and run_pg_restore_proof.sh so there is
# exactly ONE place that decides which migrations a throwaway database gets.
#
# ---------------------------------------------------------------------------
# WHY THIS FILE EXISTS
# ---------------------------------------------------------------------------
# run_pg_tests.sh used to hard-code the migration list as a literal file
# path per line. When 20260828000000_rls_grant_hardening.sql was added, it
# was never appended to that list — the harness silently fell one migration
# behind the real schema, and nothing caught it until a later audit compared
# the list against the directory by hand.
#
# A second hand-maintained list would just be a second copy of the same bug
# waiting to happen. The fix is to have exactly ONE migration-apply routine,
# used by every throwaway-Postgres script this repository has, that reads
# `supabase/migrations/` directly rather than naming files. Drift becomes
# structurally impossible: a new migration is picked up the moment the file
# exists, with no list to remember to update.
#
# bash's default glob expansion of `*.sql` sorts lexicographically, and the
# `YYYYMMDDHHMMSS_name.sql` naming convention makes lexicographic order
# exactly chronological order — so no explicit `sort` is required, but one is
# applied anyway to make the ordering guarantee explicit rather than
# incidental to the current locale's glob behaviour.

# The ONE deliberate exclusion. bootstrap_test_schema.sql's own header
# explains why: this dump carries Supabase-specific dependencies (the `auth`
# schema, RLS policies bound to `auth.jwt()`, the `extensions` schema) that a
# plain postgres:16 image does not have, and bootstrap_test_schema.sql is the
# hand-written substitute for exactly those tables. Every OTHER migration is
# discovered dynamically below — this is the only filename this file may ever
# name, and it names it because there is a real, documented, permanent reason
# to skip it, not because updating a list was forgotten.
BASE_SCHEMA_MIGRATION="20260805132704_remote_schema.sql"

apply_all_migrations() {
  local container="$1" db="$2" root="$3"

  docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$db" -q \
    < "$root/supabase/tests/bootstrap_test_schema.sql" >/dev/null
  echo "    applied bootstrap_test_schema.sql"

  # NUL-delimited, not `for f in $(find ...)`: this repository's own path
  # contains a space ("Wep sitem"), and unquoted command substitution word-
  # splits on it — the exact bug this rewrite exists to eliminate would have
  # been reintroduced by a naive glob-to-list conversion.
  local f base
  while IFS= read -r -d '' f; do
    base="$(basename "$f")"
    [ "$base" = "$BASE_SCHEMA_MIGRATION" ] && continue
    docker exec -i "$container" psql -v ON_ERROR_STOP=1 -U postgres -d "$db" -q < "$f" >/dev/null
    echo "    applied $base"
  done < <(find "$root/supabase/migrations" -maxdepth 1 -name '*.sql' -print0 | sort -z)
}
