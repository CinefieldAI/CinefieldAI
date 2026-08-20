/**
 * In-memory Supabase double for the zero-cost E2E harness (Phase 6R.12).
 *
 * This is a TRANSPORT/STORAGE double, not a logic double. It implements
 * enough of the PostgREST query-builder surface and the Storage surface for
 * Cinefield's REAL orchestration code to run unmodified against it. It
 * deliberately contains no Cinefield business logic: every state-machine
 * decision — the attempt CAS predicates, the finalization lease, the
 * evidence rules — is evaluated by production code, and this file merely
 * applies the resulting filtered UPDATE the way Postgres would.
 *
 * WHY A DOUBLE RATHER THAN A REAL POSTGRES
 * A real local Postgres would prove the SQL constraints too, which is
 * strictly better. It is not used here because the orchestration core also
 * writes to Supabase Storage, which has no local equivalent — so a
 * "real DB" run would still need a storage double, while adding a large
 * container/migration harness whose own failure modes are not Cinefield's.
 * The tradeoff is stated plainly in the phase report rather than glossed:
 * DB-level UNIQUE/CHECK constraints are NOT exercised by this harness.
 * What IS exercised is every conditional-update predicate the application
 * relies on, because those live in TypeScript and run for real here.
 *
 * Filter semantics implemented: eq, neq, in, is(null), not(is null), or()
 * for the two JSON-path lease predicates the finalization code uses,
 * limit, single/maybeSingle, and select-after-update returning the updated
 * row only when the predicate matched — which is precisely how the
 * production code detects a lost compare-and-set.
 */

import { randomUUID } from "node:crypto";

type Row = Record<string, unknown>;

/**
 * Columns that exist in the real schema but are absent from a typical INSERT.
 *
 * Postgres materializes those as NULL; a naive JS object leaves them
 * `undefined`, and the difference is NOT cosmetic. Production's duplicate
 * guard in worker/provider-command-handler.ts reads
 * `attempt.provider_job_id !== null` — against `undefined` that is true, so a
 * brand-new attempt looked like one that already carried provider evidence
 * and every submission was refused as a duplicate. Modelling the NULLs is
 * what lets the real guard behave the way it does against Postgres.
 *
 * Taken from supabase/migrations/20260810120000_generation_attempts.sql. Only
 * the nullable columns need listing — NOT NULL columns with defaults are
 * always supplied by the code under test.
 */
const NULLABLE_COLUMNS: Record<string, readonly string[]> = {
  generation_attempts: [
    "provider_job_id",
    "submission_error_code",
    "workflow_id",
    "workflow_run_id",
    "cost_amount",
    "cost_currency",
    "latency_ms",
    "error_code",
    "started_at",
    "submitted_at",
    "completed_at",
  ],
  generations: [
    "input_url",
    "output_url",
    "thumbnail_url",
    "error_message",
    "negative_prompt",
    "completed_at",
    "temporal_workflow_id",
  ],
  // Phase 9-A. The verification columns matter here for the same reason the
  // attempt NULLs did: code reads them to decide whether anything has been
  // verified, and `undefined` is not `null`.
  media_assets: [
    "ingest_failure_reason",
    "duplicate_of_asset_id",
    "moderation_engine",
    "moderated_at",
    "ingested_at",
    "project_id",
    "generation_id",
    "generation_attempt_id",
    "parent_asset_id",
    "variant",
    "declared_content_type",
    "byte_size",
    "original_filename",
    "verified_mime",
    "checksum_sha256",
    "data_class",
    "retention_policy",
    "tombstoned_at",
    "stored_at",
    "finalized_at",
  ],
};

/** Column defaults the real schema applies when an INSERT omits them. */
const COLUMN_DEFAULTS: Record<string, Row> = {
  generation_attempts: { status: "pending", submission_evidence: "none" },
  // Mirrors 20260820000000_media_assets.sql. The verification defaults are the
  // point: nothing may start life looking approved.
  media_assets: {
    role: "original",
    ingest_status: "pending",
    storage_backend: "r2",
    status: "pending",
    moderation_status: "not_evaluated",
    quarantine_status: "quarantined",
    backup_status: "not_backed_up",
    legal_hold: false,
  },
};

export interface FakeSupabaseState {
  generations: Row[];
  generation_attempts: Row[];
  [table: string]: Row[];
}

/** Reads a nested value for a PostgREST JSON path like `metadata->orchestration->>finalizeClaimedAt`. */
function readJsonPath(row: Row, path: string): unknown {
  const segments = path.split(/->>?/).map((s) => s.trim().replace(/^"|"$/g, ""));
  let current: unknown = row;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function readField(row: Row, column: string): unknown {
  return column.includes("->") ? readJsonPath(row, column) : row[column];
}

interface Filter {
  kind: "eq" | "neq" | "in" | "isNull" | "notNull" | "or";
  column: string;
  value?: unknown;
  values?: unknown[];
  orClauses?: string[];
}

export class FakeSupabaseClient {
  state: FakeSupabaseState;
  /** Every storage upload the run performed — asserted on, never written to disk. */
  storageUploads: { bucket: string; path: string; bytes: number }[] = [];
  storageSignedUrls: string[] = [];

  constructor(initial: Partial<FakeSupabaseState> = {}) {
    this.state = {
      generations: [],
      generation_attempts: [],
      media_assets: [],
      ...initial,
    } as FakeSupabaseState;
  }

  from(table: string) {
    if (!this.state[table]) this.state[table] = [];
    return new FakeQueryBuilder(this.state[table], table, this.state);
  }

  /** Minimal Supabase Storage double — records intent, never touches a real bucket. */
  storage = {
    from: (bucket: string) => ({
      upload: async (path: string, body: ArrayBuffer | Uint8Array | Blob) => {
        const bytes =
          body instanceof Uint8Array
            ? body.byteLength
            : body instanceof ArrayBuffer
              ? body.byteLength
              : 0;
        this.storageUploads.push({ bucket, path, bytes });
        return { data: { path }, error: null };
      },
      createSignedUrl: async (path: string, _expiresIn: number) => {
        const url = `https://fake-storage.invalid/${bucket}/${path}`;
        this.storageSignedUrls.push(url);
        return { data: { signedUrl: url }, error: null };
      },
      remove: async (_paths: string[]) => ({ data: null, error: null }),
    }),
  };

  /**
   * Emulates the PL/pgSQL functions the application calls as RPCs.
   *
   * SCOPE, STATED PLAINLY: this is a stand-in so the orchestration chain can
   * run offline. It does NOT prove the transactional guarantee — a JS
   * function cannot. That guarantee is proven against real PostgreSQL in
   * supabase/tests/test_transactional_outbox.sql, which runs the actual
   * migration in a throwaway container. What this emulation must get right
   * is the CONTRACT the callers depend on: the same compare-and-set
   * predicate, the same return shape, and no event on a refused transition.
   */
  async rpc(fn: string, args?: Record<string, unknown>) {
    if (fn === "cancel_generation_tx") {
      return { data: this.cancelGenerationTx(args ?? {}), error: null };
    }
    if (fn === "complete_generation_tx") {
      return { data: this.completeGenerationTx(args ?? {}), error: null };
    }
    if (fn === "fail_generation_tx") {
      return { data: this.failGenerationTx(args ?? {}), error: null };
    }
    if (fn === "create_generation_tx") {
      return this.createGenerationTx(args ?? {});
    }
    if (fn === "claim_generation_tx") {
      return { data: this.claimGenerationTx(args ?? {}), error: null };
    }
    if (fn === "finalize_media_asset") {
      return { data: this.finalizeMediaAsset(args ?? {}), error: null };
    }
    if (fn === "record_media_ingest") {
      return { data: this.recordMediaIngest(args ?? {}), error: null };
    }
    if (fn === "record_admin_privileged_action_approval") {
      return { data: this.recordAdminPrivilegedActionApproval(args ?? {}), error: null };
    }
    if (fn === "set_feature_flag") {
      return { data: this.setFeatureFlag(args ?? {}), error: null };
    }
    if (fn === "start_model_eval_run") {
      return { data: this.startModelEvalRun(args ?? {}), error: null };
    }
    if (fn === "complete_model_eval_run") {
      return { data: this.completeModelEvalRun(args ?? {}), error: null };
    }
    if (fn === "create_privacy_request") {
      return { data: this.createPrivacyRequest(args ?? {}), error: null };
    }
    if (fn === "mark_privacy_request_processing") {
      return { data: this.markPrivacyRequestProcessing(args ?? {}), error: null };
    }
    if (fn === "resolve_privacy_request") {
      return { data: this.resolvePrivacyRequest(args ?? {}), error: null };
    }
    if (fn === "record_deletion_tombstone") {
      return { data: this.recordDeletionTombstone(args ?? {}), error: null };
    }
    if (fn === "upsert_secret_rotation_state") {
      return { data: this.upsertSecretRotationState(args ?? {}), error: null };
    }
    return { data: null, error: null };
  }

  /** Mirrors upsert_secret_rotation_state() (Phase 25, 20260911000000_secret_rotation_lifecycle.sql). */
  private upsertSecretRotationState(args: Record<string, unknown>): Record<string, unknown> {
    if (!this.state.secret_rotations) this.state.secret_rotations = [];
    const rows = this.state.secret_rotations as Row[];
    const secretName = args.p_secret_name as string;
    const environment = args.p_environment as string;
    const expectedState = (args.p_expected_state as string | null) ?? null;

    const existing = rows.find((r) => r.secret_name === secretName && r.environment === environment);

    if (!existing) {
      if (expectedState !== null) return { applied: false, reason: "no_existing_row" };
      const row: Row = {
        id: randomUUID(),
        secret_name: secretName,
        environment,
        owner: args.p_owner,
        rotation_class: args.p_rotation_class,
        state: args.p_new_state,
        reason_code: args.p_reason_code,
        tier0_request_id: args.p_tier0_request_id ?? null,
        current_version_ref: args.p_current_version_ref ?? null,
        previous_version_ref: args.p_previous_version_ref ?? null,
        rotated_at: args.p_rotated_at ?? null,
        expires_at: args.p_expires_at ?? null,
        verified_at: args.p_verified_at ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      rows.push(row);
      return { applied: true, rotation_id: row.id, created: true };
    }

    if (expectedState !== null && existing.state !== expectedState) {
      return { applied: false, reason: "state_mismatch", rotation_id: existing.id };
    }

    existing.state = args.p_new_state;
    existing.reason_code = args.p_reason_code;
    existing.owner = args.p_owner;
    existing.rotation_class = args.p_rotation_class;
    if (args.p_tier0_request_id !== undefined && args.p_tier0_request_id !== null) existing.tier0_request_id = args.p_tier0_request_id;
    if (args.p_current_version_ref !== undefined && args.p_current_version_ref !== null) existing.current_version_ref = args.p_current_version_ref;
    if (args.p_previous_version_ref !== undefined && args.p_previous_version_ref !== null) existing.previous_version_ref = args.p_previous_version_ref;
    if (args.p_rotated_at !== undefined && args.p_rotated_at !== null) existing.rotated_at = args.p_rotated_at;
    if (args.p_expires_at !== undefined && args.p_expires_at !== null) existing.expires_at = args.p_expires_at;
    if (args.p_verified_at !== undefined && args.p_verified_at !== null) existing.verified_at = args.p_verified_at;
    existing.updated_at = new Date().toISOString();

    return { applied: true, rotation_id: existing.id, created: false };
  }

  /** Mirrors create_privacy_request() (Phase 23, 20260910000000_privacy_lifecycle.sql). */
  private createPrivacyRequest(args: Record<string, unknown>): string {
    const id = randomUUID();
    const rows = (this.state.privacy_requests ?? []) as Row[];
    this.state.privacy_requests = rows;
    rows.push({
      id,
      clerk_user_id: args.p_clerk_user_id,
      request_type: args.p_request_type,
      status: "pending",
      tier0_request_id: null,
      requested_at: new Date().toISOString(),
      resolved_at: null,
      resolved_by: null,
      reason_code: null,
      export_object_key: null,
      export_expires_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return id;
  }

  /** Mirrors mark_privacy_request_processing(): only a still-'pending' row transitions. */
  private markPrivacyRequestProcessing(args: Record<string, unknown>): boolean {
    const rows = (this.state.privacy_requests ?? []) as Row[];
    const row = rows.find((r) => r.id === args.p_request_id && r.status === "pending");
    if (!row) return false;
    row.status = "processing";
    row.tier0_request_id = args.p_tier0_request_id;
    row.updated_at = new Date().toISOString();
    return true;
  }

  /** Mirrors resolve_privacy_request(): only a 'pending'/'processing' row transitions. */
  private resolvePrivacyRequest(args: Record<string, unknown>): boolean {
    const rows = (this.state.privacy_requests ?? []) as Row[];
    const row = rows.find(
      (r) => r.id === args.p_request_id && (r.status === "pending" || r.status === "processing")
    );
    if (!row) return false;
    row.status = args.p_status;
    row.resolved_at = new Date().toISOString();
    row.resolved_by = args.p_resolved_by;
    if (args.p_tier0_request_id !== undefined && args.p_tier0_request_id !== null) row.tier0_request_id = args.p_tier0_request_id;
    if (args.p_reason_code !== undefined && args.p_reason_code !== null) row.reason_code = args.p_reason_code;
    if (args.p_export_object_key !== undefined && args.p_export_object_key !== null) row.export_object_key = args.p_export_object_key;
    if (args.p_export_expires_at !== undefined && args.p_export_expires_at !== null) row.export_expires_at = args.p_export_expires_at;
    row.updated_at = new Date().toISOString();
    return true;
  }

  /** Mirrors record_deletion_tombstone(): ON CONFLICT(clerk_user_id) DO NOTHING semantics. */
  private recordDeletionTombstone(args: Record<string, unknown>): { created: boolean; tombstone_id: string } {
    const rows = (this.state.deletion_tombstones ?? []) as Row[];
    this.state.deletion_tombstones = rows;
    const existing = rows.find((r) => r.clerk_user_id === args.p_clerk_user_id);
    if (existing) {
      return { created: false, tombstone_id: String(existing.id) };
    }
    const id = randomUUID();
    rows.push({
      id,
      clerk_user_id: args.p_clerk_user_id,
      tombstoned_at: new Date().toISOString(),
      reason_code: args.p_reason_code,
      requested_by: args.p_requested_by ?? null,
      executed_by: args.p_executed_by,
      privacy_request_id: args.p_privacy_request_id ?? null,
      legal_hold_exception: args.p_legal_hold_exception ?? false,
      created_at: new Date().toISOString(),
    });
    return { created: true, tombstone_id: id };
  }

  /** Mirrors start_model_eval_run() (Phase 22, 20260908000000_model_eval.sql). */
  private startModelEvalRun(args: Record<string, unknown>): string {
    const id = randomUUID();
    const runs = (this.state.model_eval_runs ?? []) as Row[];
    this.state.model_eval_runs = runs;
    runs.push({
      id,
      model_version_id: args.p_model_version_id,
      provider_id: args.p_provider_id,
      provider_model_id: args.p_provider_model_id,
      eval_set_key: args.p_eval_set_key,
      evaluator: args.p_evaluator,
      evaluator_version: args.p_evaluator_version,
      status: "running",
      started_at: new Date().toISOString(),
      completed_at: null,
      metadata: args.p_metadata ?? {},
      created_at: new Date().toISOString(),
    });
    return id;
  }

  /** Mirrors complete_model_eval_run(): only a still-'running' row transitions — same predicate the real RPC uses. */
  private completeModelEvalRun(args: Record<string, unknown>): boolean {
    const runs = (this.state.model_eval_runs ?? []) as Row[];
    const run = runs.find((r) => r.id === args.p_run_id && r.status === "running");
    if (!run) return false;
    run.status = args.p_status;
    run.completed_at = new Date().toISOString();
    return true;
  }

  /**
   * Mirrors set_feature_flag() (Phase 21, 20260901000000_feature_flags.sql):
   * reads the current value, upserts `feature_flags`, and appends one
   * `feature_flag_audit` row — in that order, the same order the real
   * PL/pgSQL function's single transaction performs it in. Returns
   * `[{ previous_value, new_value }]`, matching the real function's
   * `RETURNS TABLE` shape (`admin.rpc()` callers read `data[0]` or `data`
   * depending on the PostgREST client version — `writeFlag()` handles both).
   */
  private setFeatureFlag(args: Record<string, unknown>) {
    const flagKey = args.p_flag_key as string;
    const flags = (this.state.feature_flags ?? []) as Row[];
    this.state.feature_flags = flags;
    const audit = (this.state.feature_flag_audit ?? []) as Row[];
    this.state.feature_flag_audit = audit;

    const existing = flags.find((f) => f.flag_key === flagKey);
    const previousValue = existing ? (existing.value ?? null) : null;
    const rollbackValue = (args.p_rollback_value as unknown) ?? previousValue ?? null;

    if (existing) {
      existing.value_type = args.p_value_type;
      existing.value = args.p_new_value;
      existing.rollback_value = rollbackValue;
      existing.reason_code = (args.p_reason_code as string | null) ?? null;
      existing.ticket_ref = (args.p_ticket_ref as string | null) ?? null;
      existing.expires_at = (args.p_expires_at as string | null) ?? null;
      existing.updated_by = args.p_actor_clerk_user_id;
      existing.updated_at = new Date().toISOString();
    } else {
      flags.push({
        flag_key: flagKey,
        value_type: args.p_value_type,
        value: args.p_new_value,
        rollback_value: rollbackValue,
        reason_code: (args.p_reason_code as string | null) ?? null,
        ticket_ref: (args.p_ticket_ref as string | null) ?? null,
        expires_at: (args.p_expires_at as string | null) ?? null,
        updated_by: args.p_actor_clerk_user_id,
        updated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      });
    }

    audit.push({
      id: randomUUID(),
      flag_key: flagKey,
      previous_value: previousValue,
      new_value: args.p_new_value,
      actor_clerk_user_id: args.p_actor_clerk_user_id,
      reason_code: (args.p_reason_code as string | null) ?? null,
      ticket_ref: (args.p_ticket_ref as string | null) ?? null,
      expires_at: (args.p_expires_at as string | null) ?? null,
      changed_at: new Date().toISOString(),
    });

    return [{ previous_value: previousValue, new_value: args.p_new_value }];
  }

  /**
   * Mirrors record_admin_privileged_action_approval() (Phase 16-E,
   * 20260829000000_tier0_admin_action_audit.sql): the requester of a
   * `request_id` (its earliest 'requested' event's actor) can never satisfy
   * their own approval — inserting an 'approved' event only for a DISTINCT
   * actor, then counting distinct approvers. No advisory lock is needed
   * here: this harness runs single-threaded, so the concurrency the real
   * `pg_advisory_xact_lock` protects against cannot occur in a fake.
   */
  private recordAdminPrivilegedActionApproval(args: Record<string, unknown>) {
    const requestId = args.p_request_id as string;
    const actor = args.p_actor as string;
    const table = (this.state.admin_privileged_action_events ?? []) as Row[];
    this.state.admin_privileged_action_events = table;

    const requested = table
      .filter((row) => row.request_id === requestId && row.event === "requested")
      .sort((a, b) => String(a.occurred_at ?? "").localeCompare(String(b.occurred_at ?? "")))[0];

    if (!requested) return { recorded: false, reason: "no_matching_request" };
    if (requested.actor_clerk_user_id === actor) return { recorded: false, reason: "self_approval_blocked" };

    table.push({
      id: randomUUID(),
      request_id: requestId,
      event: "approved",
      actor_clerk_user_id: actor,
      action_type: args.p_action_type as string,
      target_type: args.p_target_type as string,
      target_id: (args.p_target_id as string | null) ?? null,
      reason_code: (args.p_reason_code as string | null) ?? null,
      correlation_id: (args.p_correlation_id as string | null) ?? null,
      security_classification: (args.p_security_classification as string) ?? "HIGH_RISK_TIER0",
      outcome_detail: null,
      occurred_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });

    const approvers = new Set(
      table.filter((row) => row.request_id === requestId && row.event === "approved").map((row) => row.actor_clerk_user_id)
    );
    const required = (args.p_required_approvals as number) ?? 2;

    return { recorded: true, approvals: approvers.size, required, satisfied: approvers.size >= required };
  }

  /** Outbox rows the emulated RPCs wrote. Asserted on; never a real table. */
  outboxEvents: Row[] = [];

  /**
   * Mirrors finalize_media_asset(): guarded on pending/stored, and idempotent.
   * A replay reports the existing terminal status rather than transitioning
   * again — the same shape the SQL returns, so the caller's branch on
   * `finalized === false && status === 'finalized'` is exercised for real.
   */
  private finalizeMediaAsset(args: Record<string, unknown>) {
    const assetId = args.p_asset_id as string;
    const row = (this.state.media_assets ?? []).find((a) => a.id === assetId);

    if (!row || (row.status !== "pending" && row.status !== "stored")) {
      return { finalized: false, asset_id: assetId, status: row?.status ?? null };
    }

    const now = new Date().toISOString();
    row.status = "finalized";
    row.byte_size = args.p_byte_size as number;
    row.declared_content_type =
      (args.p_declared_content_type as string | null) ?? row.declared_content_type ?? null;
    row.stored_at = row.stored_at ?? now;
    row.finalized_at = now;

    return { finalized: true, asset_id: assetId, status: "finalized" };
  }

  /**
   * Mirrors record_media_ingest(): guarded on pending/inspecting, idempotent,
   * and it refuses a verification that arrives without the facts. The refusal
   * matters — the real SQL raises there, so a caller that forgot the checksum
   * must fail here too rather than sail through the double.
   */
  private recordMediaIngest(args: Record<string, unknown>) {
    const assetId = args.p_asset_id as string;
    const ingestStatus = args.p_ingest_status as string;

    if (ingestStatus === "verified" && (!args.p_verified_mime || !args.p_checksum_sha256)) {
      throw new Error("verified_requires_mime_and_checksum");
    }

    const row = (this.state.media_assets ?? []).find((a) => a.id === assetId);
    if (!row) return { recorded: false, reason: "not_found" };
    if (row.ingest_status !== "pending" && row.ingest_status !== "inspecting") {
      return { recorded: false, reason: "already_ingested", ingest_status: row.ingest_status };
    }

    row.ingest_status = ingestStatus;
    row.verified_mime = (args.p_verified_mime as string | null) ?? row.verified_mime ?? null;
    row.checksum_sha256 = (args.p_checksum_sha256 as string | null) ?? row.checksum_sha256 ?? null;
    row.ingest_failure_reason = (args.p_failure_reason as string | null) ?? null;
    row.duplicate_of_asset_id = (args.p_duplicate_of as string | null) ?? row.duplicate_of_asset_id ?? null;
    row.moderation_status = (args.p_moderation_status as string | null) ?? row.moderation_status;
    row.moderation_engine = (args.p_moderation_engine as string | null) ?? row.moderation_engine ?? null;
    row.ingested_at = new Date().toISOString();

    return {
      recorded: true,
      asset_id: assetId,
      ingest_status: row.ingest_status,
      moderation_status: row.moderation_status,
      quarantine_status: row.quarantine_status,
    };
  }

  /**
   * Mirrors claim_generation_tx(): the queued -> processing compare-and-set
   * with its `generation.processing` event.
   *
   * The predicate is the whole point and is reproduced exactly — only a row
   * still in "queued" may be claimed, so a second caller gets `not_queued`
   * and no second event. A fake that claimed unconditionally would let a
   * duplicate-execution test pass while production duplicated work.
   */
  private claimGenerationTx(args: Record<string, unknown>) {
    const generationId = args.p_generation_id as string;
    const row = this.state.generations.find((g) => g.id === generationId);

    if (!row) return { claimed: false, reason: "not_found" };
    if (row.status !== "queued") return { claimed: false, reason: "not_queued", status: row.status };

    row.status = "processing";
    const stage = args.p_stage as string | null;
    if (stage) {
      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      const orchestration = { ...((metadata.orchestration ?? {}) as Record<string, unknown>) };
      orchestration.stage = stage;
      row.metadata = { ...metadata, orchestration };
    }
    row.updated_at = new Date().toISOString();

    const eventId = randomUUID();
    this.outboxEvents.push({
      event_id: eventId,
      event_type: "generation.processing",
      event_version: 1,
      aggregate_type: "generation",
      aggregate_id: generationId,
      trace_id: (args.p_trace_id as string) ?? null,
      payload: { generationId, provider: row.provider },
      // Captured by emit_outbox_event in SQL; captured here so tenant
      // assertions see the same shape.
      tenant_id: row.clerk_user_id ?? null,
      status: "pending",
      published_at: null,
    });

    return { claimed: true, status: "processing", event_id: eventId };
  }

  private cancelGenerationTx(args: Record<string, unknown>) {
    const generationId = args.p_generation_id as string;
    const row = this.state.generations.find((g) => g.id === generationId);

    // Same predicate as the SQL: queued/processing only.
    if (!row || (row.status !== "queued" && row.status !== "processing")) {
      return { applied: false, status: row?.status ?? null, event_id: null };
    }

    row.status = "cancelled";
    row.completed_at = new Date().toISOString();
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    const orchestration = { ...((metadata.orchestration ?? {}) as Record<string, unknown>) };
    orchestration.stage = "cancelled";
    row.metadata = { ...metadata, orchestration };
    row.updated_at = new Date().toISOString();

    // The event is written only because the transition applied — the same
    // ordering the SQL guarantees, even though only the SQL makes it atomic.
    const eventId = (args.p_event_id as string) ?? randomUUID();
    this.outboxEvents.push({
      event_id: eventId,
      event_type: "generation.cancelled",
      event_version: 1,
      aggregate_type: "generation",
      aggregate_id: generationId,
      trace_id: (args.p_trace_id as string) ?? null,
      payload: { generationId, provider: row.provider },
      status: "pending",
      published_at: null,
    });

    return { applied: true, status: "cancelled", event_id: eventId };
  }

  /**
   * Emulates create_generation_tx. Same predicate the SQL uses: an existing
   * (owner, idempotency_key) is a replay, and the project must belong to the
   * caller. The ATOMICITY is proven on real PostgreSQL, not here.
   */
  private createGenerationTx(args: Record<string, unknown>) {
    const owner = args.p_clerk_user_id as string;
    const projectId = args.p_project_id as string;
    const key = (args.p_idempotency_key as string) ?? null;

    if (!this.state.projects) this.state.projects = [];
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project || project.clerk_user_id !== owner) {
      return { data: null, error: { message: "project_not_found" } };
    }

    if (key !== null) {
      const existing = this.state.generations.find(
        (g) => g.clerk_user_id === owner && g.idempotency_key === key
      );
      if (existing) {
        return {
          data: {
            generation_id: existing.id,
            created: false,
            request_hash: existing.request_hash ?? null,
            status: existing.status,
          },
          error: null,
        };
      }
    }

    const id = randomUUID();
    this.state.generations.push({
      id,
      project_id: projectId,
      clerk_user_id: owner,
      generation_type: args.p_generation_type,
      provider: args.p_provider,
      model: args.p_model,
      prompt: args.p_prompt,
      negative_prompt: (args.p_negative_prompt as string) ?? null,
      status: "queued",
      input_url: (args.p_input_url as string) ?? null,
      output_url: null,
      thumbnail_url: null,
      error_message: null,
      metadata: (args.p_metadata as Record<string, unknown>) ?? {},
      idempotency_key: key,
      request_hash: (args.p_request_hash as string) ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: null,
      temporal_workflow_id: null,
    });

    return {
      data: { generation_id: id, created: true, request_hash: args.p_request_hash ?? null, status: "queued" },
      error: null,
    };
  }

  /** Merges only the orchestration keys the SQL owns, as jsonb_set does. */
  private mergeOrchestration(row: Row, patch: Record<string, unknown>): void {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    const orchestration = { ...((metadata.orchestration ?? {}) as Record<string, unknown>) };
    row.metadata = {
      ...metadata,
      orchestration: { ...orchestration, ...patch, updatedAt: new Date().toISOString() },
    };
  }

  /** Latest attempt number, which the SQL derives rather than accepting. */
  private latestAttemptNo(generationId: string): number | null {
    const numbers = this.state.generation_attempts
      .filter((a) => a.generation_id === generationId)
      .map((a) => Number(a.attempt_no))
      .filter((n) => Number.isInteger(n));
    return numbers.length > 0 ? Math.max(...numbers) : null;
  }

  private recordEvent(
    eventType: string,
    generationId: string,
    payload: Row,
    args: Record<string, unknown>
  ): string {
    const eventId = (args.p_event_id as string) ?? randomUUID();
    this.outboxEvents.push({
      event_id: eventId,
      event_type: eventType,
      event_version: 1,
      aggregate_type: "generation",
      aggregate_id: generationId,
      trace_id: (args.p_trace_id as string) ?? null,
      // jsonb_strip_nulls: an absent optional field is omitted, not null.
      payload: Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== null && v !== undefined)),
      status: "pending",
      published_at: null,
    });
    return eventId;
  }

  private completeGenerationTx(args: Record<string, unknown>) {
    const generationId = args.p_generation_id as string;
    const row = this.state.generations.find((g) => g.id === generationId);

    // Same predicate as the SQL: processing only.
    if (!row || row.status !== "processing") {
      return { applied: false, status: row?.status ?? null, event_id: null };
    }

    row.status = "completed";
    row.output_url = args.p_output_url as string;
    row.thumbnail_url = (args.p_thumbnail_url as string) ?? null;
    row.error_message = null;
    row.completed_at = new Date().toISOString();
    this.mergeOrchestration(row, {
      stage: "completed",
      provider: args.p_provider,
      workflow: args.p_workflow,
      isMock: args.p_is_mock,
    });
    row.updated_at = new Date().toISOString();

    const eventId = this.recordEvent(
      "generation.completed",
      generationId,
      {
        generationId,
        provider: args.p_provider,
        attemptNo: this.latestAttemptNo(generationId),
        durationMs: args.p_duration_ms ?? null,
      },
      args
    );

    return { applied: true, status: "completed", event_id: eventId };
  }

  private failGenerationTx(args: Record<string, unknown>) {
    const generationId = args.p_generation_id as string;
    const row = this.state.generations.find((g) => g.id === generationId);

    if (!row || row.status !== "processing") {
      return { applied: false, status: row?.status ?? null, event_id: null };
    }

    row.status = "failed";
    row.error_message = (args.p_error_message as string) ?? null;
    row.completed_at = new Date().toISOString();
    this.mergeOrchestration(row, {
      stage: "failed",
      errorCode: args.p_error_code,
      retryable: args.p_retryable,
      ...(args.p_provider_job ? { providerJob: args.p_provider_job } : {}),
    });
    row.updated_at = new Date().toISOString();

    const eventId = this.recordEvent(
      "generation.failed",
      generationId,
      {
        generationId,
        provider: (args.p_provider as string) ?? row.provider,
        errorCode: args.p_error_code,
        attemptNo: this.latestAttemptNo(generationId),
      },
      args
    );

    return { applied: true, status: "failed", event_id: eventId };
  }
}

class FakeQueryBuilder {
  private rows: Row[];
  private table: string;
  private filters: Filter[] = [];
  private mode: "select" | "update" | "insert" = "select";
  private payload: Row = {};
  private insertRows: Row[] = [];
  private selectAfterWrite = false;
  private limitCount: number | null = null;
  private selectColumns = "*";
  private state: FakeSupabaseState;
  private wantsCount = false;
  private headOnly = false;

  constructor(rows: Row[], table: string, state: FakeSupabaseState) {
    this.rows = rows;
    this.table = table;
    this.state = state;
  }

  /** Mirrors the real client's `select(columns, { count, head })` — `count: "exact"` reports the matched row count; `head: true` skips returning rows. */
  select(cols?: string, options?: { count?: "exact" | "planned" | "estimated"; head?: boolean }) {
    if (typeof cols === "string") this.selectColumns = cols;
    if (options?.count) this.wantsCount = true;
    if (options?.head) this.headOnly = true;
    if (this.mode === "select") this.mode = "select";
    else this.selectAfterWrite = true;
    return this;
  }

  insert(payload: Row | Row[]) {
    this.mode = "insert";
    this.insertRows = Array.isArray(payload) ? payload : [payload];
    return this;
  }

  update(payload: Row) {
    this.mode = "update";
    this.payload = payload;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push({ kind: "neq", column, value });
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push({ kind: "in", column, values });
    return this;
  }

  is(column: string, value: unknown) {
    if (value === null) this.filters.push({ kind: "isNull", column });
    return this;
  }

  not(column: string, op: string, value: unknown) {
    if (op === "is" && value === null) this.filters.push({ kind: "notNull", column });
    return this;
  }

  /** Supports the `a.is.null,a.lt.<ts>` shape the finalization lease uses. */
  or(clause: string) {
    this.filters.push({ kind: "or", column: "", orClauses: clause.split(",") });
    return this;
  }

  order() {
    return this;
  }

  limit(n: number) {
    this.limitCount = n;
    return this;
  }

  private matchesOr(row: Row, clauses: string[]): boolean {
    return clauses.some((clause) => {
      const [column, op, ...rest] = clause.split(".");
      const operand = rest.join(".");
      const actual = readField(row, column);
      if (op === "is" && operand === "null") return actual === null || actual === undefined;
      if (op === "lt") return actual !== null && actual !== undefined && String(actual) < operand;
      if (op === "eq") return String(actual) === operand;
      return false;
    });
  }

  private matching(): Row[] {
    return this.rows.filter((row) =>
      this.filters.every((f) => {
        const actual = readField(row, f.column);
        switch (f.kind) {
          case "eq":
            return actual === f.value;
          case "neq":
            return actual !== f.value;
          case "in":
            return (f.values ?? []).includes(actual);
          case "isNull":
            return actual === null || actual === undefined;
          case "notNull":
            return actual !== null && actual !== undefined;
          case "or":
            return this.matchesOr(row, f.orClauses ?? []);
        }
      })
    );
  }

  private execute(): { data: unknown; error: null; count?: number | null } {
    if (this.mode === "insert") {
      const nullable = NULLABLE_COLUMNS[this.table] ?? [];
      const inserted = this.insertRows.map((r) => {
        const row: Row = {
          // Real UUIDs: production's wire/keyspace contracts validate ids.
          id: r.id ?? randomUUID(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...(COLUMN_DEFAULTS[this.table] ?? {}),
          ...r,
        };
        // Omitted nullable columns read back as NULL, exactly as in Postgres.
        for (const column of nullable) {
          if (row[column] === undefined) row[column] = null;
        }
        this.rows.push(row);
        return row;
      });
      return { data: inserted, error: null };
    }

    if (this.mode === "update") {
      const matched = this.matching();
      for (const row of matched) {
        Object.assign(row, this.payload, { updated_at: new Date().toISOString() });
      }
      // Critical: an UPDATE whose predicate matched nothing returns no rows.
      // That is exactly how production code detects a lost compare-and-set.
      return { data: matched, error: null };
    }

    const matched = this.matching();
    const selected = this.limitCount === null ? matched : matched.slice(0, this.limitCount);
    return {
      data: this.headOnly ? [] : this.embed(selected),
      error: null,
      count: this.wantsCount ? matched.length : null,
    };
  }

  /**
   * Resolves the PostgREST embedded-resource syntax for the ROUTING tables
   * (Phase 7-B): `provider_models ( ..., providers ( ... ) )`.
   *
   * A foreign-key walk, nothing more. It contains no routing policy — every
   * eligibility decision and the whole tie-break still run in production code
   * against the rows this returns. Scoped to the join the route repository
   * actually issues rather than a general PostgREST parser, because a
   * half-correct general implementation would be a second query engine whose
   * bugs would read as routing bugs.
   */
  private embed(rows: Row[]): Row[] {
    if (!this.selectColumns.includes("(")) return rows;

    const find = (table: string, id: unknown): Row | null =>
      (this.state[table] ?? []).find((r) => r.id === id) ?? null;

    if (this.table === "model_routes") {
      return rows.map((row) => {
        const providerModel = find("provider_models", row.provider_model_id);
        const embedded: Row = { ...row };
        embedded.models = find("models", row.model_id);
        embedded.model_versions = find("model_versions", row.model_version_id);
        embedded.provider_models = providerModel
          ? { ...providerModel, providers: find("providers", providerModel.provider_id) }
          : null;
        return embedded;
      });
    }

    return rows;
  }

  async single() {
    const { data } = this.execute();
    const rows = data as Row[];
    if (rows.length !== 1) {
      return { data: null, error: { message: `expected 1 row from ${this.table}, got ${rows.length}` } };
    }
    return { data: rows[0], error: null };
  }

  async maybeSingle() {
    const { data } = this.execute();
    const rows = data as Row[];
    return { data: rows[0] ?? null, error: null };
  }

  then<TResult1, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null; count?: number | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}
