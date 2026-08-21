-- Cinefield production security hardening — Supabase function execution boundaries.
--
-- Security Advisor identified public/authenticated EXECUTE privileges on
-- internal trigger/event-trigger functions and mutable search_path settings on
-- several helper functions. These functions are not application RPC endpoints.
-- Keep their trigger/function behavior intact while removing direct client RPC
-- execution and pinning object resolution to an explicit schema.

-- Internal trigger function: preserve trigger execution, remove REST/RPC reachability.
REVOKE ALL ON FUNCTION public.media_assets_duplicate_same_owner() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.media_assets_duplicate_same_owner() FROM anon;
REVOKE ALL ON FUNCTION public.media_assets_duplicate_same_owner() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.media_assets_duplicate_same_owner() TO service_role;

-- Internal DDL event-trigger function: clients must never invoke it directly.
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM anon;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO service_role;

-- Append-only trigger helpers do not require client EXECUTE privileges.
REVOKE ALL ON FUNCTION public.media_safety_audit_append_only() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.media_safety_audit_append_only() FROM anon;
REVOKE ALL ON FUNCTION public.media_safety_audit_append_only() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.media_safety_audit_append_only() TO service_role;

REVOKE ALL ON FUNCTION public.security_events_append_only() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.security_events_append_only() FROM anon;
REVOKE ALL ON FUNCTION public.security_events_append_only() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.security_events_append_only() TO service_role;

-- Server-only constant helper. Keep service-role/server execution but remove
-- public/authenticated RPC surface.
REVOKE ALL ON FUNCTION public.media_release_required_approvals() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.media_release_required_approvals() FROM anon;
REVOKE ALL ON FUNCTION public.media_release_required_approvals() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.media_release_required_approvals() TO service_role;

-- Pin name resolution for functions previously reported with mutable search_path.
-- ALTER FUNCTION changes only function configuration; it preserves the function
-- body, trigger binding, volatility and security mode.
ALTER FUNCTION public.media_safety_audit_append_only()
  SET search_path TO 'public';

ALTER FUNCTION public.security_events_append_only()
  SET search_path TO 'public';

ALTER FUNCTION public.media_release_required_approvals()
  SET search_path TO 'public';

COMMENT ON FUNCTION public.media_assets_duplicate_same_owner() IS
  'Internal tenant-integrity trigger. Direct anon/authenticated RPC execution is revoked.';

COMMENT ON FUNCTION public.rls_auto_enable() IS
  'Internal RLS DDL event-trigger function. Direct anon/authenticated RPC execution is revoked.';
