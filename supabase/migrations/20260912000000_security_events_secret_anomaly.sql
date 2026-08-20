-- ===========================================================================
-- PHASE 25-D — Secret access anomaly signal
-- ===========================================================================
-- Roadmap 25-D: "KMS/secret erişimini CloudTrail/alerting ile izle; anormal
-- secret read/KMS decrypt davranışını security.events'e bağla." Two new
-- kinds and one new source WIDEN the existing security_events CHECK
-- constraints — the identical, strictly-additive pattern
-- 20260827000000_policy_decision_evidence.sql already established for
-- Phase 12-E. record_security_event()'s signature is UNCHANGED: it already
-- accepts an arbitrary kind/source text, validated only by the CHECK below,
-- so no function replacement is needed this time.
-- ===========================================================================


ALTER TABLE "public"."security_events"
  DROP CONSTRAINT IF EXISTS "security_events_kind_check";

ALTER TABLE "public"."security_events"
  ADD CONSTRAINT "security_events_kind_check" CHECK ("kind" = ANY (ARRAY[
    'rate_limit_denied'::"text",
    'outbound_fetch_blocked'::"text",
    'realtime_connection_denied'::"text",
    'media_release_approved'::"text",
    'media_rejected'::"text",
    'realtime_event_unroutable'::"text",
    'auth_failure'::"text",
    'policy_decision_allowed'::"text",
    'policy_decision_denied'::"text",
    -- Phase 25-D.
    'secret_access_anomaly'::"text",
    'secret_rotation_completed'::"text"
  ]));

ALTER TABLE "public"."security_events"
  DROP CONSTRAINT IF EXISTS "security_events_source_check";

ALTER TABLE "public"."security_events"
  ADD CONSTRAINT "security_events_source_check" CHECK ("source" = ANY (ARRAY[
    'route_rate_limit'::"text",
    'outbound_fetch_gateway'::"text",
    'realtime_gateway'::"text",
    'media_safety'::"text",
    'realtime_dispatcher'::"text",
    'auth'::"text",
    'policy_gate'::"text",
    -- Phase 25-D. The receiving end of the CloudTrail->security.events
    -- bridge (POST /api/internal/secrets/access-anomaly, mirroring Phase
    -- 18-D's drift-report ingest route) and the rotation execution service
    -- itself, which records its own successful rotations here alongside
    -- the admin_privileged_action_events approval trail.
    'kms_cloudtrail_bridge'::"text",
    'secret_rotation_service'::"text"
  ]));
