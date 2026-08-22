-- ===========================================================================
-- Supabase internal-function hardening proofs
-- ===========================================================================
-- Proves that internal trigger/event-trigger helpers cannot be called through
-- anon/authenticated RPC privileges, while trusted server execution remains
-- available and mutable search_path warnings are eliminated.
-- ===========================================================================

\set ON_ERROR_STOP on

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.media_assets_duplicate_same_owner()',
    'public.rls_auto_enable()',
    'public.media_safety_audit_append_only()',
    'public.security_events_append_only()',
    'public.media_release_required_approvals()'
  ]
  LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'FUNCTION HARDENING FAILED: anon still has EXECUTE on %', fn;
    END IF;

    IF has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'FUNCTION HARDENING FAILED: authenticated still has EXECUTE on %', fn;
    END IF;

    IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'FUNCTION HARDENING FAILED: service_role lost EXECUTE on %', fn;
    END IF;
  END LOOP;

  RAISE NOTICE 'FUNCTION HARDENING PASS: anon/authenticated RPC execution revoked and service_role preserved';
END $$;

DO $$
DECLARE
  v_config text[];
BEGIN
  SELECT p.proconfig INTO v_config
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'media_assets_duplicate_same_owner';
  IF v_config IS NULL OR NOT (v_config @> ARRAY['search_path=public']::text[]) THEN
    RAISE EXCEPTION 'FUNCTION HARDENING FAILED: media_assets_duplicate_same_owner search_path is not pinned';
  END IF;

  SELECT p.proconfig INTO v_config
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rls_auto_enable';
  IF v_config IS NULL OR NOT (v_config @> ARRAY['search_path=pg_catalog']::text[]) THEN
    RAISE EXCEPTION 'FUNCTION HARDENING FAILED: rls_auto_enable search_path is not pinned to pg_catalog';
  END IF;

  PERFORM 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'media_safety_audit_append_only'
     AND p.proconfig @> ARRAY['search_path=public']::text[];
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FUNCTION HARDENING FAILED: media_safety_audit_append_only search_path is not pinned';
  END IF;

  PERFORM 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'security_events_append_only'
     AND p.proconfig @> ARRAY['search_path=public']::text[];
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FUNCTION HARDENING FAILED: security_events_append_only search_path is not pinned';
  END IF;

  PERFORM 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'media_release_required_approvals'
     AND p.proconfig @> ARRAY['search_path=public']::text[];
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FUNCTION HARDENING FAILED: media_release_required_approvals search_path is not pinned';
  END IF;

  RAISE NOTICE 'FUNCTION HARDENING PASS: privileged/helper function search_path settings are pinned';
END $$;

SELECT 'SUPABASE FUNCTION HARDENING PROOFS PASSED' AS result;
