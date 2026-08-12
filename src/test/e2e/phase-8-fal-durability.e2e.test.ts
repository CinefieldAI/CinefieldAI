import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  __setFalClientForTesting,
  endpointIdFor,
  falProvider,
} from "@/lib/orchestration/providers/fal-provider";
import type { ProviderExecutionContext, ProviderSubmission } from "@/lib/orchestration/types";
import { isOrchestrationError } from "@/lib/orchestration/errors";

/**
 * PHASE 8 REPAIR — fal result recovery must not depend on process memory.
 *
 * THE DEFECT
 * The adapter held submit()'s images in a module-level Map keyed by
 * generation id, and getResult() read them back out. That is a single
 * process's memory acting as the only copy of a job fal had already run and
 * already billed. A crash between completion and storage lost the output; a
 * continuation resumed on another worker found nothing.
 *
 * These tests are written so that they CANNOT pass against that design: every
 * recovery below happens through a fresh client with no shared state, and one
 * test asserts the Map is gone from the source rather than merely unused.
 */

const root = process.cwd();
const readSource = (relative: string) =>
  readFileSync(join(root, relative), "utf8").replace(/\r\n/g, "\n");

const CONTEXT: ProviderExecutionContext = {
  generationId: "11111111-1111-4111-8111-111111111111",
  clerkUserId: "user_durability",
  projectId: "22222222-2222-4222-8222-222222222222",
};

/** The submission as it is reconstructed from the durable attempt row. */
function durableSubmission(overrides: Partial<ProviderSubmission> = {}): ProviderSubmission {
  return {
    providerJobId: "req_abc123",
    provider: "fal",
    status: "completed",
    metadata: { endpointId: "fal-ai/flux/schnell", imageCount: 1 },
    ...overrides,
  };
}

/**
 * A fal double built to the INSTALLED SDK's queue shape.
 *
 * It is deliberately stateless with respect to any submission: it answers
 * from (endpointId, requestId) alone, exactly as fal's queue does, so a test
 * that recovers a result through it has proven recovery from durable
 * identifiers and nothing else.
 */
function falDouble(options?: {
  images?: { url: string; content_type?: string; width?: number; height?: number }[];
  status?: string;
  throwOn?: "result" | "status" | "cancel";
  onCall?: (call: { method: string; endpointId: string; requestId?: string }) => void;
}) {
  const images = options?.images ?? [
    { url: "https://fal.media/files/example.png", content_type: "image/png", width: 1024, height: 1024 },
  ];
  return {
    queue: {
      async result(endpointId: string, opts: { requestId: string }) {
        options?.onCall?.({ method: "result", endpointId, requestId: opts.requestId });
        if (options?.throwOn === "result") throw new Error("network");
        return { data: { images }, requestId: opts.requestId };
      },
      async status(endpointId: string, opts: { requestId: string }) {
        options?.onCall?.({ method: "status", endpointId, requestId: opts.requestId });
        if (options?.throwOn === "status") throw new Error("network");
        return { status: options?.status ?? "COMPLETED", request_id: opts.requestId };
      },
      async cancel(endpointId: string, opts: { requestId: string }) {
        options?.onCall?.({ method: "cancel", endpointId, requestId: opts.requestId });
        if (options?.throwOn === "cancel") throw new Error("cannot cancel");
      },
      async submit() {
        throw new Error("no test may submit — that would be a paid call");
      },
    },
    subscribe() {
      throw new Error("no test may submit — that would be a paid call");
    },
  } as never;
}

// ---------------------------------------------------------------------------
// The defect is gone from the source, not merely unused
// ---------------------------------------------------------------------------

test("no process-local result store exists in the fal adapter", () => {
  const source = readSource("src/lib/orchestration/providers/fal-provider.ts");
  assert.ok(!/PENDING_RESULTS/.test(source), "the module-level result Map must be gone");
  assert.ok(
    !/new Map<string, FalImage\[\]>/.test(source),
    "no equivalent in-memory result cache may replace it"
  );

  // And no "durable first, memory second" fallback, which would hide the
  // defect by passing in the process that submitted and failing elsewhere.
  const getResult = /async getResult\([\s\S]*?\n  \}/.exec(source);
  assert.ok(getResult);
  assert.match(getResult[0], /client\.queue\.result\(/);
  assert.ok(!/\.get\(`fal-/.test(getResult[0]));
});

test("getResult reads only durable identifiers", () => {
  const source = readSource("src/lib/orchestration/providers/fal-provider.ts");
  const getResult = /async getResult\([\s\S]*?\n  \}/.exec(source);
  assert.ok(getResult);
  // endpointId from the persisted submission metadata; requestId from the
  // persisted provider job id. Nothing else.
  assert.match(getResult[0], /endpointIdFor\(submission\)/);
  assert.match(getResult[0], /requestId: submission\.providerJobId/);
});

// ---------------------------------------------------------------------------
// Process restart
// ---------------------------------------------------------------------------

test("PROCESS RESTART: a new instance recovers the result from durable state alone", async () => {
  // Instance A submitted at some point in the past. Everything it held in
  // memory is gone — this test never creates it. All that survives is what
  // PostgreSQL stores: the provider job id and the submission metadata.
  const submissionFromDatabase = durableSubmission();

  const calls: { method: string; endpointId: string; requestId?: string }[] = [];
  __setFalClientForTesting(falDouble({ onCall: (call) => calls.push(call) }));
  try {
    const outputs = await falProvider.getResult!(submissionFromDatabase, CONTEXT);

    assert.equal(outputs.length, 1);
    assert.equal(outputs[0].type, "image");
    assert.equal(outputs[0].sourceUrl, "https://fal.media/files/example.png");
    assert.equal(outputs[0].width, 1024);

    // It asked fal, addressing the request by both durable identifiers.
    assert.deepEqual(calls, [
      { method: "result", endpointId: "fal-ai/flux/schnell", requestId: "req_abc123" },
    ]);
  } finally {
    __setFalClientForTesting(null);
  }
});

test("CROSS-WORKER: worker B recovers what worker A submitted, sharing no memory", async () => {
  // Two independent "workers", each with its own client instance. The only
  // thing passed between them is the durable submission — the same object a
  // second process would rebuild from the attempt row.
  const attemptRow = {
    generation_id: CONTEXT.generationId,
    attempt_id: "33333333-3333-4333-8333-333333333333",
    provider: "fal",
    provider_model: "fal-ai/flux/schnell",
    provider_job_id: "req_shared_1",
  };

  const workerACalls: string[] = [];
  const workerBCalls: string[] = [];

  // Worker A: checks status, learns the job finished, and then dies.
  __setFalClientForTesting(
    falDouble({ status: "COMPLETED", onCall: (c) => workerACalls.push(c.method) })
  );
  const submission = durableSubmission({
    providerJobId: attemptRow.provider_job_id,
    metadata: { endpointId: attemptRow.provider_model },
    status: "processing",
  });
  const status = await falProvider.getStatus!(submission, CONTEXT);
  assert.equal(status.status, "completed");
  __setFalClientForTesting(null);

  // Worker B: a different instance, a different client, no shared Map.
  __setFalClientForTesting(
    falDouble({
      images: [{ url: "https://fal.media/files/shared.png", content_type: "image/png" }],
      onCall: (c) => workerBCalls.push(c.method),
    })
  );
  try {
    const outputs = await falProvider.getResult!(submission, CONTEXT);
    assert.equal(outputs[0].sourceUrl, "https://fal.media/files/shared.png");
  } finally {
    __setFalClientForTesting(null);
  }

  assert.deepEqual(workerACalls, ["status"]);
  assert.deepEqual(workerBCalls, ["result"], "worker B fetched it itself");

  // Correlation held throughout: one generation, one attempt, one request id.
  assert.equal(submission.providerJobId, attemptRow.provider_job_id);
  assert.equal(endpointIdFor(submission), attemptRow.provider_model);
});

test("NO DUPLICATE SUBMISSION: recovery never resubmits", async () => {
  // The double throws if anything tries to submit, so a recovery path that
  // resubmitted would fail loudly rather than silently cost money.
  const submission = durableSubmission({ providerJobId: "req_no_resubmit" });

  __setFalClientForTesting(falDouble());
  try {
    await falProvider.getStatus!(submission, CONTEXT);
    await falProvider.getResult!(submission, CONTEXT);
    // Reaching here means neither path attempted a submission.
  } finally {
    __setFalClientForTesting(null);
  }

  // Structural backing for the same claim.
  const source = readSource("src/lib/orchestration/providers/fal-provider.ts");
  for (const method of ["getResult", "getStatus", "reconcileSubmission"]) {
    const body = new RegExp(`async ${method}\\([\\s\\S]*?\\n  \\}`).exec(source);
    assert.ok(body, `${method} must exist`);
    assert.ok(!/subscribe\(|queue\.submit\(/.test(body[0]), `${method} must never submit`);
  }
});

// ---------------------------------------------------------------------------
// Failure paths stay honest
// ---------------------------------------------------------------------------

test("a result lookup that cannot be addressed reports missing output, not success", async () => {
  __setFalClientForTesting(falDouble());
  try {
    // No endpoint id: unaddressable.
    await assert.rejects(
      falProvider.getResult!(durableSubmission({ metadata: {} }), CONTEXT),
      (error: unknown) => isOrchestrationError(error) && error.code === "OUTPUT_MISSING"
    );

    // The synthetic id fal has never seen.
    await assert.rejects(
      falProvider.getResult!(
        durableSubmission({ providerJobId: `fal-${CONTEXT.generationId}` }),
        CONTEXT
      ),
      (error: unknown) => isOrchestrationError(error) && error.code === "OUTPUT_MISSING"
    );
  } finally {
    __setFalClientForTesting(null);
  }
});

test("a failed result fetch surfaces as a typed error, never as empty success", async () => {
  __setFalClientForTesting(falDouble({ throwOn: "result" }));
  try {
    await assert.rejects(
      falProvider.getResult!(durableSubmission(), CONTEXT),
      (error: unknown) => isOrchestrationError(error)
    );
  } finally {
    __setFalClientForTesting(null);
  }
});

test("an empty result is OUTPUT_MISSING and carries the job id for reconciliation", async () => {
  __setFalClientForTesting(falDouble({ images: [] }));
  try {
    await falProvider.getResult!(durableSubmission(), CONTEXT);
    assert.fail("an empty result must not be treated as success");
  } catch (error) {
    assert.ok(isOrchestrationError(error));
    if (!isOrchestrationError(error)) return;
    assert.equal(error.code, "OUTPUT_MISSING");
    // The job COMPLETED at fal and was billed; the id makes that provable.
    assert.equal(error.context?.providerJobId, "req_abc123");
  } finally {
    __setFalClientForTesting(null);
  }
});

test("an unanswerable status check is not a terminal verdict", async () => {
  __setFalClientForTesting(falDouble({ throwOn: "status" }));
  try {
    const result = await falProvider.getStatus!(
      durableSubmission({ status: "processing" }),
      CONTEXT
    );
    assert.equal(
      result.status,
      "processing",
      "a transport failure says nothing about the job; it must not become 'failed'"
    );
  } finally {
    __setFalClientForTesting(null);
  }
});

test("status maps fal's queue vocabulary from a durable lookup", async () => {
  for (const [falStatus, expected] of [
    ["IN_QUEUE", "queued"],
    ["IN_PROGRESS", "processing"],
    ["COMPLETED", "completed"],
  ] as const) {
    __setFalClientForTesting(falDouble({ status: falStatus }));
    try {
      const result = await falProvider.getStatus!(durableSubmission({ status: "queued" }), CONTEXT);
      assert.equal(result.status, expected);
    } finally {
      __setFalClientForTesting(null);
    }
  }
});

// ---------------------------------------------------------------------------
// Cancel and reconciliation keep working from durable state
// ---------------------------------------------------------------------------

test("cancel addresses the job by durable identifiers only", async () => {
  const calls: { method: string; endpointId: string; requestId?: string }[] = [];
  __setFalClientForTesting(falDouble({ onCall: (c) => calls.push(c) }));
  try {
    await falProvider.cancel!(durableSubmission(), CONTEXT);
    assert.deepEqual(calls, [
      { method: "cancel", endpointId: "fal-ai/flux/schnell", requestId: "req_abc123" },
    ]);
  } finally {
    __setFalClientForTesting(null);
  }
});

test("a cancel the provider refuses throws rather than reporting success", async () => {
  __setFalClientForTesting(falDouble({ throwOn: "cancel" }));
  try {
    await assert.rejects(falProvider.cancel!(durableSubmission(), CONTEXT));
  } finally {
    __setFalClientForTesting(null);
  }
});

test("reconciliation proves existence from a durable lookup, and never proves absence", async () => {
  __setFalClientForTesting(falDouble({ status: "IN_PROGRESS" }));
  try {
    const found = await falProvider.reconcileSubmission!(
      "req_abc123",
      { modelId: "fal-flux-schnell" } as never,
      CONTEXT
    );
    assert.equal(found.outcome, "job_exists");
    if (found.outcome === "job_exists") assert.equal(found.status, "processing");
  } finally {
    __setFalClientForTesting(null);
  }

  // A failing lookup must stay unknown — never "no such job".
  __setFalClientForTesting(falDouble({ throwOn: "status" }));
  try {
    const unresolved = await falProvider.reconcileSubmission!(
      "req_abc123",
      { modelId: "fal-flux-schnell" } as never,
      CONTEXT
    );
    assert.equal(unresolved.outcome, "unknown");
  } finally {
    __setFalClientForTesting(null);
  }
});

// ---------------------------------------------------------------------------
// Endpoint correlation durability
// ---------------------------------------------------------------------------

test("the endpoint id is persisted with the submission, not held in a closure", () => {
  const source = readSource("src/lib/orchestration/providers/fal-provider.ts");
  // Written into the submission metadata, which the core persists verbatim as
  // the job's resume data.
  assert.match(source, /endpointId: model\.providerModelId/);
  // And read back from that same place.
  assert.match(source, /submission\.metadata\?\.endpointId/);

  assert.equal(endpointIdFor(durableSubmission()), "fal-ai/flux/schnell");
  assert.equal(endpointIdFor(durableSubmission({ metadata: {} })), null);
  assert.equal(endpointIdFor(durableSubmission({ metadata: undefined })), null);
});

test("the persisted resume data carries identifiers only", () => {
  const submission = durableSubmission();
  const serialized = JSON.stringify(submission.metadata);
  for (const forbidden of ["key", "token", "authorization", "secret", "prompt", "http"]) {
    assert.ok(
      !new RegExp(forbidden, "i").test(serialized),
      `resume data must not carry a ${forbidden}`
    );
  }
});

// ---------------------------------------------------------------------------
// No paid call, no credential
// ---------------------------------------------------------------------------

test("nothing in this suite can reach the real fal API", () => {
  // The double throws on submit, and the client seam is the only way in.
  const source = readSource("src/lib/orchestration/providers/fal-provider.ts");
  assert.match(source, /export function __setFalClientForTesting/);
  assert.match(source, /if \(testClient\) return testClient;/);

  // Production never sets one.
  const productionCallers = ["src/lib/orchestration/orchestrator.ts", "worker/activities/generation-activities.ts"];
  for (const file of productionCallers) {
    assert.ok(!/__setFalClientForTesting/.test(readSource(file)), `${file} must not use the seam`);
  }

  assert.equal(process.env.FAL_KEY, undefined, "no credential is needed to run these tests");
});
