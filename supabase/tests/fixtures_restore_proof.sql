-- ===========================================================================
-- Phase 15-C/2 — deterministic restore-significant fixture
-- ===========================================================================
-- Applied to the SOURCE throwaway database only, after every real migration.
-- Seeds one row (or more, via real functions) into every DURABLE_TABLES
-- table that migrations do not already seed themselves — providers, models,
-- model_versions, provider_models, model_pricing and plan_limits already
-- carry real rows from their own migrations, so this file does not touch
-- them.
--
-- Every write goes through a REAL production function
-- (create_generation_tx, reserve_credits, settle_reservation,
-- record_media_ingest, finalize_media_asset, record_media_backup,
-- record_security_event) wherever one exists, so this fixture exercises the
-- same invariants a real request would — not a hand-crafted row that
-- bypasses them.
\set ON_ERROR_STOP on

\set fixture_user 'user_restore_proof_15c2'
-- 64 lowercase hex characters, matching media_assets_checksum_shape exactly
-- (checksum_sha256 ~ '^[0-9a-f]{64}$'). Distinct from the corruption value
-- the negative proof mutates it to (repeat('f', 64)).
\set fixture_checksum '1111111111111111111111111111111111111111111111111111111111111111'

INSERT INTO profiles (clerk_user_id, credits) VALUES (:'fixture_user', 500);
INSERT INTO credit_wallets (clerk_user_id, balance, lifetime_granted) VALUES (:'fixture_user', 500, 500);

INSERT INTO projects (clerk_user_id, title) VALUES (:'fixture_user', 'Restore Proof Project')
  RETURNING id AS project_id \gset

SELECT (create_generation_tx(
  :'fixture_user', :'project_id'::uuid, 'image', 'fal', 'restore-proof-model',
  'a deterministic restore-proof prompt', '{}'::jsonb, NULL, NULL,
  'idem-restore-proof-1', 'restore-proof-hash'
) ->> 'generation_id') AS generation_id \gset

INSERT INTO generation_attempts
  (generation_id, attempt_no, provider, provider_model, provider_job_id, status, submission_evidence, latency_ms)
VALUES
  (:'generation_id'::uuid, 1, 'fal', 'fal-ai/restore-proof', 'job-restore-proof-1', 'succeeded', 'job', 1200)
  RETURNING id AS attempt_id \gset

SELECT (reserve_credits(:'fixture_user', 50, 'idem-restore-proof-reserve-1', :'generation_id'::uuid, '{}'::jsonb)
  ->> 'reservation_id') AS reservation_id \gset
SELECT settle_reservation(:'reservation_id'::uuid, 50);

-- Ingest, finalize, then a real Phase 9-D DR backup RECORD — the DB-side
-- fact only. No S3 call is made or needed: `record_media_backup` is exactly
-- the primitive `backupAsset()` calls after S3 answers, so writing it
-- directly here is using the real function, not simulating one.
INSERT INTO media_assets (clerk_user_id, project_id, generation_id, source, role, media_type, bucket, object_key)
VALUES (:'fixture_user', :'project_id'::uuid, :'generation_id'::uuid, 'provider_output', 'original', 'image',
        'cinefield-media', 'quarantine/output/' || :'fixture_user' || '/restore-proof/original.png')
  RETURNING id AS asset_id \gset

SELECT record_media_ingest(:'asset_id'::uuid, 'verified', 'image/png', :'fixture_checksum');
SELECT finalize_media_asset(:'asset_id'::uuid, 2048, 'image/png');
SELECT record_media_backup(:'asset_id'::uuid, 'backed_up', 's3', 'cinefield-dr-proof',
  'dr/restore-proof/original.png', NULL, 'restore-proof-etag');

SELECT record_security_event(
  'media_release_approved', 'info', 'media_safety', 'restore_proof_fixture', 'dedupe-restore-proof-1',
  60, :'fixture_user', NULL, NULL, 'media_asset', :'asset_id', NULL, 5, NULL, false
);

INSERT INTO media_safety_audit
  (asset_id, actor_clerk_user_id, action, prior_moderation_status, resulting_quarantine_status, reason_code)
VALUES
  (:'asset_id'::uuid, :'fixture_user', 'release_requested', NULL, NULL, 'restore_proof_fixture');

INSERT INTO media_release_approvals (asset_id, approver_clerk_user_id, reason_code)
VALUES (:'asset_id'::uuid, 'admin_restore_proof', 'restore_proof_fixture');

-- Printed so the orchestrating shell script can capture identity without a
-- second query — \gset variables do not survive past this psql invocation.
SELECT
  :'fixture_user'      AS fixture_user,
  :'project_id'         AS project_id,
  :'generation_id'      AS generation_id,
  :'attempt_id'         AS attempt_id,
  :'asset_id'           AS asset_id,
  :'fixture_checksum'   AS fixture_checksum;
