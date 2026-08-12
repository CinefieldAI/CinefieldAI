import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { __setFalClientForTesting, falProvider } from "@/lib/orchestration/providers/fal-provider";
import { findModel } from "@/lib/orchestration/model-registry";
import { isOrchestrationError } from "@/lib/orchestration/errors";
import type {
  NormalizedGenerationRequest,
  ProviderExecutionContext,
  ProviderSubmission,
} from "@/lib/orchestration/types";

/**
 * PHASE 8 — SUBMISSION durability.
 *
 * The previous batch made the RESULT recoverable. This one is about the window
 * before it: fal has accepted a billable job and named it, but the job has not
 * finished.
 *
 * The old adapter waited inside `subscribe()` for that entire window, holding
 * the request id in a local variable. A worker that died there left a job fal
 * was running, and billing, that Cinefield could no longer name — no
 * provider_job_id on the attempt, nothing for reconciliation to ask about, and
 * an output that could never be collected.
 *
 * These tests are written so they cannot pass against that design: every
 * recovery below happens after the submitting client has been discarded, and
 * the double throws if anything tries to enqueue twice.
 *
 * No paid call. No credential.
 */

const root = process.cwd();
const readSource = (relative: string) =>
  readFileSync(join(root, relative), "utf8").replace(/\r\n/g, "\n");

const CONTEXT: ProviderExecutionContext = {
  generationId: "44444444-4444-4444-8444-444444444444",
  clerkUserId: "user_submission_durability",
  projectId: "55555555-5555-4555-8555-555555555555",
};

function falRequest(): NormalizedGenerationRequest {
  return {
    generationId: CONTEXT.generationId,
    clerkUserId: CONTEXT.clerkUserId,
    projectId: CONTEXT.projectId,
    modelId: "fal-flux-schnell",
    provider: "fal",
    providerModelId: "fal-ai/flux/schnell",
    generationType: "image",
    workflow: "text-to-image",
    prompt: "durability probe — never sent to a real provider",
    inputs: [],
    settings: { outputCount: 1 },
  } as NormalizedGenerationRequest;
}

interface Call {
  method: string;
  endpointId: string;
  requestId?: string;
}

/**
 * A fal double shaped to the INSTALLED SDK's queue client.
 *
 * `submit` returns an `InQueueQueueStatus`-shaped object — status IN_QUEUE
 * plus `request_id` — exactly as @fal-ai/client 1.10.1 declares. Every other
 * method answers from (endpointId, requestId) alone and holds no state from a
 * submission, so nothing here can accidentally simulate process memory.
 */
function falQueueDouble(options?: {
  submitRequestId?: string;
  status?: string;
  images?: { url: string; content_type?: string; width?: number; height?: number }[];
  throwOnSubmit?: boolean;
  onCall?: (call: Call) => void;
}) {
  const images = options?.images ?? [
    { url: "https://fal.media/files/durable.png", content_type: "image/png" },
  ];
  return {
    queue: {
      async submit(endpointId: string, _opts: unknown) {
        options?.onCall?.({ method: "submit", endpointId });
        if (options?.throwOnSubmit) throw new Error("enqueue failed");
        return {
          status: "IN_QUEUE",
          request_id: options?.submitRequestId ?? "req_default",
          response_url: "https://queue.fal.run/x",
          status_url: "https://queue.fal.run/x/status",
          cancel_url: "https://queue.fal.run/x/cancel",
          queue_position: 1,
        };
      },
      async status(endpointId: string, opts: { requestId: string }) {
        options?.onCall?.({ method: "status", endpointId, requestId: opts.requestId });
        return { status: options?.status ?? "COMPLETED", request_id: opts.requestId };
      },
      async result(endpointId: string, opts: { requestId: string }) {
        options?.onCall?.({ method: "result", endpointId, requestId: opts.requestId });
        return { data: { images }, requestId: opts.requestId };
      },
      async cancel(endpointId: string, opts: { requestId: string }) {
        options?.onCall?.({ method: "cancel", endpointId, requestId: opts.requestId });
      },
    },
    subscribe() {
      throw new Error("subscribe() must never be called: it is the defect this batch removed");
    },
  } as never;
}

// ---------------------------------------------------------------------------
// Enqueue-and-return
// ---------------------------------------------------------------------------

test("submit ENQUEUES and returns; it does not wait for completion", async () => {
  const calls: string[] = [];
  __setFalClientForTesting(
    falQueueDouble({ submitRequestId: "req_enqueued_1", onCall: (c) => calls.push(c.method) })
  );
  try {
    const submission = await falProvider.submit(falRequest(), CONTEXT);

    assert.equal(submission.providerJobId, "req_enqueued_1");
    assert.equal(
      submission.status,
      "queued",
      "an enqueued job is not a finished one — 'completed' would send it to finalization with no output"
    );
    assert.equal(submission.metadata?.endpointId, "fal-ai/flux/schnell");
    assert.deepEqual(calls, ["submit"], "submit must not also poll or fetch a result");
  } finally {
    __setFalClientForTesting(null);
  }
});

// ---------------------------------------------------------------------------
// The scenario this batch exists for
// ---------------------------------------------------------------------------

test("MID-FLIGHT CRASH: accepted, still running, submitting worker dies", async () => {
  // 1-2. Worker A enqueues. fal accepts and names the request.
  const workerACalls: string[] = [];
  __setFalClientForTesting(
    falQueueDouble({ submitRequestId: "req_midflight", onCall: (c) => workerACalls.push(c.method) })
  );
  const submission = await falProvider.submit(falRequest(), CONTEXT);
  assert.equal(submission.providerJobId, "req_midflight");
  assert.equal(submission.status, "queued");

  // 3. THE MOMENT THAT USED TO BE FATAL. The id is already in the returned
  //    submission, which the orchestrator's async branch persists before
  //    anything waits — so this row is what a real deployment holds right now.
  const durableRow = {
    generation_id: CONTEXT.generationId,
    provider: "fal",
    provider_model: submission.metadata?.endpointId as string,
    provider_job_id: submission.providerJobId,
  };

  // 4. Worker A dies. Every client, closure and local variable is gone.
  __setFalClientForTesting(null);

  // 5. The job is STILL RUNNING — this is what makes the scenario different
  //    from result recovery, where the output already existed.
  const workerBCalls: Call[] = [];
  __setFalClientForTesting(
    falQueueDouble({ status: "IN_PROGRESS", onCall: (c) => workerBCalls.push(c) })
  );

  const rebuilt: ProviderSubmission = {
    providerJobId: durableRow.provider_job_id,
    provider: durableRow.provider,
    status: "processing",
    metadata: { endpointId: durableRow.provider_model },
  };

  try {
    const stillRunning = await falProvider.getStatus!(rebuilt, CONTEXT);
    assert.equal(stillRunning.status, "processing", "worker B observes the SAME job, mid-flight");
  } finally {
    __setFalClientForTesting(null);
  }

  // 6. It finishes. Worker B collects the output.
  __setFalClientForTesting(
    falQueueDouble({
      status: "COMPLETED",
      images: [{ url: "https://fal.media/files/midflight.png", content_type: "image/png" }],
      onCall: (c) => workerBCalls.push(c),
    })
  );
  try {
    const outputs = await falProvider.getResult!(rebuilt, CONTEXT);
    assert.equal(outputs[0].sourceUrl, "https://fal.media/files/midflight.png");
  } finally {
    __setFalClientForTesting(null);
  }

  assert.deepEqual(workerACalls, ["submit"], "worker A only enqueued");
  assert.deepEqual(
    workerBCalls.map((c) => c.method),
    ["status", "result"],
    "worker B only observed and fetched"
  );
  for (const call of workerBCalls) {
    assert.equal(call.requestId, "req_midflight", "worker B addressed the original job");
  }
});

test("MID-FLIGHT CRASH: recovery cannot enqueue a second fal job", async () => {
  let submitCount = 0;
  __setFalClientForTesting(
    falQueueDouble({
      status: "IN_PROGRESS",
      submitRequestId: "req_only_once",
      onCall: (c) => {
        if (c.method === "submit") submitCount += 1;
      },
    })
  );

  const submission = await falProvider.submit(falRequest(), CONTEXT);
  assert.equal(submitCount, 1);

  const rebuilt: ProviderSubmission = {
    providerJobId: submission.providerJobId,
    provider: "fal",
    status: "processing",
    metadata: submission.metadata,
  };

  try {
    // Everything a resumed worker might do. None of it may enqueue.
    await falProvider.getStatus!(rebuilt, CONTEXT);
    await falProvider.getStatus!(rebuilt, CONTEXT);
    await falProvider.reconcileSubmission!(
      rebuilt.providerJobId,
      { modelId: "fal-flux-schnell" } as never,
      CONTEXT
    );
    await falProvider.cancel!(rebuilt, CONTEXT);
  } finally {
    __setFalClientForTesting(null);
  }

  assert.equal(submitCount, 1, "recovery must never enqueue a second job");
});

test("CANCEL AFTER RESTART: worker B stops the job worker A started", async () => {
  __setFalClientForTesting(falQueueDouble({ submitRequestId: "req_cancel_after_restart" }));
  const submission = await falProvider.submit(falRequest(), CONTEXT);
  __setFalClientForTesting(null);

  const cancelCalls: Call[] = [];
  __setFalClientForTesting(
    falQueueDouble({
      onCall: (c) => {
        if (c.method === "cancel") cancelCalls.push(c);
      },
    })
  );
  try {
    await falProvider.cancel!(
      {
        providerJobId: submission.providerJobId,
        provider: "fal",
        status: "processing",
        metadata: { endpointId: submission.metadata?.endpointId as string },
      },
      CONTEXT
    );
  } finally {
    __setFalClientForTesting(null);
  }

  assert.deepEqual(cancelCalls, [
    { method: "cancel", endpointId: "fal-ai/flux/schnell", requestId: "req_cancel_after_restart" },
  ]);
});

test("RECONCILIATION AFTER RESTART stays conservative", async () => {
  __setFalClientForTesting(falQueueDouble({ submitRequestId: "req_reconcile" }));
  const submission = await falProvider.submit(falRequest(), CONTEXT);
  __setFalClientForTesting(null);

  // A different worker asks whether the job exists. It does.
  __setFalClientForTesting(falQueueDouble({ status: "IN_QUEUE" }));
  try {
    const found = await falProvider.reconcileSubmission!(
      submission.providerJobId,
      { modelId: "fal-flux-schnell" } as never,
      CONTEXT
    );
    assert.equal(found.outcome, "job_exists");
    if (found.outcome === "job_exists") assert.equal(found.status, "queued");
  } finally {
    __setFalClientForTesting(null);
  }

  // And a lookup that cannot be answered stays unknown — never "no such job",
  // which would clear the block and authorize a duplicate.
  const source = readSource("src/lib/orchestration/providers/fal-provider.ts");
  const reconcile = /async reconcileSubmission\([\s\S]*?\n  \}/.exec(source);
  assert.ok(reconcile);
  assert.ok(!/no_such_job/.test(reconcile[0]));
});

// ---------------------------------------------------------------------------
// Ambiguity is preserved, not narrowed away
// ---------------------------------------------------------------------------

test("a submission fal refuses to name is AMBIGUOUS, never a clean failure", async () => {
  __setFalClientForTesting(falQueueDouble({ submitRequestId: "" }));
  try {
    await falProvider.submit(falRequest(), CONTEXT);
    assert.fail("an unnamed submission must not be reported as success");
  } catch (error) {
    assert.ok(isOrchestrationError(error));
    if (!isOrchestrationError(error)) return;
    assert.equal(error.code, "PROVIDER_SUBMISSION_UNKNOWN");
    assert.equal(error.retryable, false, "AMBIGUOUS != SAFE TO RETRY");
  } finally {
    __setFalClientForTesting(null);
  }
});

test("an enqueue that throws produces no fabricated request id", async () => {
  __setFalClientForTesting(falQueueDouble({ throwOnSubmit: true }));
  try {
    await assert.rejects(
      falProvider.submit(falRequest(), CONTEXT),
      (error: unknown) => isOrchestrationError(error)
    );
  } finally {
    __setFalClientForTesting(null);
  }

  // `queue.submit` either returns an id or throws — there is no path that
  // invents one, and none that reports success without one.
  const source = readSource("src/lib/orchestration/providers/fal-provider.ts");
  const submitBody = /async submit\([\s\S]*?\n  \}/.exec(source);
  assert.ok(submitBody);
  assert.ok(!/`fal-\$\{/.test(submitBody[0]), "no synthetic id may be minted at submit");
});

// ---------------------------------------------------------------------------
// The old design is gone
// ---------------------------------------------------------------------------

test("submit no longer waits for completion anywhere in the adapter", () => {
  const source = readSource("src/lib/orchestration/providers/fal-provider.ts");
  const submitBody = /async submit\([\s\S]*?\n  \}/.exec(source);
  assert.ok(submitBody);
  assert.ok(
    !/client\.subscribe\(/.test(submitBody[0]),
    "a wait-for-completion call inside submit is exactly the defect this closes"
  );
  assert.match(submitBody[0], /client\.queue\.submit\(/);

  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/enqueuedRequestId/.test(code), "the local-variable request id is gone");
  assert.ok(!/\.subscribe\(/.test(code), "no code path calls subscribe any more");
});

test("the registry and the capability matrix agree that fal is asynchronous", async () => {
  for (const id of ["fal-flux-schnell", "fal-flux-dev", "fal-nano-banana-2"]) {
    assert.equal(findModel(id)?.executionMode, "async", `${id} enqueues, it does not wait`);
  }
  const { FAL_CAPABILITIES } = await import("@/lib/orchestration/providers/fal-provider");
  assert.equal(FAL_CAPABILITIES.executionShape, "asynchronous");
});

test("Temporal, not the adapter, owns the waiting", () => {
  const adapter = readSource("src/lib/orchestration/providers/fal-provider.ts");
  // No timers, no sleeps, no polling loops inside the adapter.
  assert.ok(!/setInterval|while \(true\)|for \(;;\)/.test(adapter));
  const code = adapter.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // The one setTimeout left is the abort ceiling on a single POST.
  assert.equal((code.match(/setTimeout\(/g) ?? []).length, 1);

  // The schedule lives in the workflow.
  const workflow = readSource("worker/workflows/generation-workflow.ts");
  assert.match(workflow, /MAX_STATUS_CHECKS/);
  assert.match(workflow, /nextCheckDelaySeconds/);
  assert.ok(!/bullmq/i.test(workflow));
});
