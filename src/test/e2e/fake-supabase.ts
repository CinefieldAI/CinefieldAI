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
};

/** Column defaults the real schema applies when an INSERT omits them. */
const COLUMN_DEFAULTS: Record<string, Row> = {
  generation_attempts: { status: "pending", submission_evidence: "none" },
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
    this.state = { generations: [], generation_attempts: [], ...initial } as FakeSupabaseState;
  }

  from(table: string) {
    if (!this.state[table]) this.state[table] = [];
    return new FakeQueryBuilder(this.state[table], table);
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
    return { data: null, error: null };
  }

  /** Outbox rows the emulated RPCs wrote. Asserted on; never a real table. */
  outboxEvents: Row[] = [];

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

  constructor(rows: Row[], table: string) {
    this.rows = rows;
    this.table = table;
  }

  select(_cols?: string) {
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

  private execute(): { data: unknown; error: null } {
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

    const selected = this.limitCount === null ? this.matching() : this.matching().slice(0, this.limitCount);
    return { data: selected, error: null };
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
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}
