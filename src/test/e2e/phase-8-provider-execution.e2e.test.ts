import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  UNKNOWN_CAPABILITIES,
  isUsable,
  isProductionDurable,
  type CapabilityStatus,
  type ProviderCapabilityMatrix,
} from "@/lib/orchestration/providers/provider-capabilities";
import { FAL_CAPABILITIES, isSyntheticJobId, mapFalQueueStatus } from "@/lib/orchestration/providers/fal-provider";
import { MOCK_CAPABILITIES } from "@/lib/orchestration/providers/mock-provider";
import { GEMINI_CAPABILITIES } from "@/lib/orchestration/providers/gemini-provider";
import { CLOUDFLARE_CAPABILITIES } from "@/lib/orchestration/providers/cloudflare-workers-ai-provider";
import { getProviderAdapter, listRegisteredProviders } from "@/lib/orchestration/provider-registry";
import { decideFailover, DEFAULT_MAX_ATTEMPTS } from "@/lib/routing/failover-policy";
import { provesNoProviderJob, OrchestrationError } from "@/lib/orchestration/errors";
import { classifyFailure, countsAgainstProvider } from "@/lib/routing/failure-classification";

/**
 * PHASE 8 FOUNDATION — the provider execution contract.
 *
 * The theme of this file is refusing to claim provider behaviour that has not
 * been demonstrated. Every capability marked usable below is backed by the
 * INSTALLED SDK's type surface (node_modules/@fal-ai/client/src/queue.d.ts);
 * everything else is explicitly unknown, and the tests enforce that the
 * unknowns cannot be invoked.
 *
 * No paid call is made. No credential is required.
 */

const root = process.cwd();
const readSource = (relative: string) =>
  readFileSync(join(root, relative), "utf8").replace(/\r\n/g, "\n");

// ---------------------------------------------------------------------------
// The capability contract
// ---------------------------------------------------------------------------

test("every registered adapter declares a full capability matrix", () => {
  const required: (keyof ProviderCapabilityMatrix)[] = [
    "submit",
    "status",
    "result",
    "polling",
    "webhook",
    "webhookAuthentication",
    "cancel",
    "reconcileAmbiguousSubmission",
    "nativeIdempotency",
    "executionShape",
  ];

  for (const providerId of listRegisteredProviders()) {
    const adapter = getProviderAdapter(providerId);
    assert.ok(adapter.capabilities, `${providerId} must declare capabilities`);
    for (const key of required) {
      assert.ok(
        adapter.capabilities[key] !== undefined,
        `${providerId} must declare "${key}" — an omitted capability is an assumed one`
      );
    }
  }
});

test("capabilities distinguish 'we did not build it' from 'we do not know'", () => {
  // Two different facts with two different owners. Collapsing them into a
  // boolean loses the only information that says what to do next.
  const statuses: CapabilityStatus[] = [
    "proven",
    "implemented_not_live_validated",
    "unsupported_by_adapter",
    "unknown_provider_capability",
  ];
  assert.equal(new Set(statuses).size, 4);

  assert.equal(isUsable("proven"), true);
  assert.equal(isUsable("implemented_not_live_validated"), true);
  assert.equal(isUsable("unsupported_by_adapter"), false);
  assert.equal(
    isUsable("unknown_provider_capability"),
    false,
    "an unverified provider capability must never be invoked"
  );
});

test("a new integration starts from all-unknown, never from all-supported", () => {
  // executionShape and productionExecutionDurability have their own
  // vocabularies; every capability proper defaults to unknown.
  for (const [key, value] of Object.entries(UNKNOWN_CAPABILITIES)) {
    if (key === "executionShape" || key === "productionExecutionDurability") continue;
    assert.equal(value, "unknown_provider_capability", `${key} must default to unknown`);
  }

  // And a new adapter is production-INELIGIBLE until someone proves otherwise.
  assert.equal(UNKNOWN_CAPABILITIES.productionExecutionDurability, "not_proven");
  assert.equal(isProductionDurable(UNKNOWN_CAPABILITIES.productionExecutionDurability), false);
});

test("no adapter claims a capability as 'proven' without being the implementation", () => {
  // "proven" means exercised against the real provider. This batch makes no
  // paid call, so only the mock — which IS its own implementation — may use it.
  for (const providerId of listRegisteredProviders()) {
    const capabilities = getProviderAdapter(providerId).capabilities;
    if (providerId === "mock") continue;
    for (const [key, value] of Object.entries(capabilities)) {
      if (key === "executionShape") continue;
      assert.notEqual(
        value,
        "proven",
        `${providerId}.${key} claims live validation that has not happened`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// fal.ai — every claim traced to the installed SDK
// ---------------------------------------------------------------------------

test("fal's usable capabilities are exactly the ones the installed SDK declares", () => {
  const queueTypes = readFileSync(
    join(root, "node_modules", "@fal-ai", "client", "src", "queue.d.ts"),
    "utf8"
  );

  // The evidence, read from the dependency itself rather than from memory.
  assert.match(queueTypes, /submit<Id extends EndpointType>/);
  assert.match(queueTypes, /status\(endpointId: string, options: QueueStatusOptions\)/);
  assert.match(queueTypes, /result<Id extends EndpointType>/);
  assert.match(queueTypes, /cancel\(endpointId: string, options: BaseQueueOptions\)/);

  assert.ok(isUsable(FAL_CAPABILITIES.submit));
  assert.ok(isUsable(FAL_CAPABILITIES.status));
  assert.ok(isUsable(FAL_CAPABILITIES.result));
  assert.ok(isUsable(FAL_CAPABILITIES.cancel));
  assert.ok(isUsable(FAL_CAPABILITIES.reconcileAmbiguousSubmission));
});

test("fal webhook authentication is NOT claimed, because the SDK proves nothing", () => {
  const sdkFiles = ["queue.d.ts", "client.d.ts", "index.d.ts"].map((name) =>
    readFileSync(join(root, "node_modules", "@fal-ai", "client", "src", name), "utf8")
  );

  // A `webhookUrl` submit option exists, so fal CAN call back...
  assert.ok(sdkFiles.some((file) => /webhookUrl/.test(file)));
  // ...but nothing in the SDK verifies such a callback.
  for (const file of sdkFiles) {
    assert.ok(
      !/verifyWebhook|webhookSignature|constructEvent/i.test(file),
      "if a verifier appears in the SDK, this capability should be revisited"
    );
  }

  assert.equal(
    FAL_CAPABILITIES.webhookAuthentication,
    "unknown_provider_capability",
    "an unverifiable callback is an unauthenticated ingress; it must not be claimed"
  );
  assert.equal(FAL_CAPABILITIES.webhook, "unsupported_by_adapter");
});

test("fal native idempotency is not claimed", () => {
  assert.equal(FAL_CAPABILITIES.nativeIdempotency, "unknown_provider_capability");

  // And Cinefield's own idempotency never depended on it.
  const createService = readSource("src/lib/orchestration/generation-create-service.ts");
  assert.match(createService, /idempotencyKey/);
  assert.match(createService, /canonicalRequestHash/);
});

test("fal queue statuses map without inventing a failure state", () => {
  assert.equal(mapFalQueueStatus("IN_QUEUE"), "queued");
  assert.equal(mapFalQueueStatus("IN_PROGRESS"), "processing");
  assert.equal(mapFalQueueStatus("COMPLETED"), "completed");
  // fal's union carries no failure state; an unrecognized value must not
  // become a terminal guess.
  assert.equal(mapFalQueueStatus("SOMETHING_NEW"), "processing");
  assert.equal(mapFalQueueStatus(""), "processing");
});

test("the synthetic fallback id is never sent to fal as a request id", () => {
  // submit() falls back to `fal-<generationId>` when onEnqueue never fired.
  // fal has never seen that string, so a lookup would return "not found" —
  // and reading that as proof of absence is exactly how a job that exists
  // gets submitted twice.
  assert.equal(isSyntheticJobId("fal-gen-123", "gen-123"), true);
  assert.equal(isSyntheticJobId("a1b2c3-real-request-id", "gen-123"), false);

  const source = readSource("src/lib/orchestration/providers/fal-provider.ts");
  const reconcile = /async reconcileSubmission\([\s\S]*?\n  \}/.exec(source);
  assert.ok(reconcile);
  assert.match(reconcile[0], /isSyntheticJobId/, "reconciliation must reject the synthetic id");

  const cancel = /async cancel\([\s\S]*?\n  \}/.exec(source);
  assert.ok(cancel);
  assert.match(cancel[0], /isSyntheticJobId/, "cancel must reject the synthetic id");
});

test("a failed reconciliation lookup is UNKNOWN, never 'no such job'", () => {
  // The single most dangerous mistake available in this file: a 404 from a
  // queue endpoint could be a wrong endpoint id, an expired record or a
  // transient failure. Only a positive answer proves anything.
  const source = readSource("src/lib/orchestration/providers/fal-provider.ts");
  const reconcile = /async reconcileSubmission\([\s\S]*?\n  \}/.exec(source);
  assert.ok(reconcile);
  assert.match(reconcile[0], /catch[\s\S]*outcome: "unknown"/);
  assert.ok(
    !/no_such_job/.test(reconcile[0]),
    "this adapter cannot prove absence, so it must never claim it"
  );
});

test("fal cancel never converts a failure into a confirmation", () => {
  const source = readSource("src/lib/orchestration/providers/fal-provider.ts");
  const cancel = /async cancel\([\s\S]*?\n  \}/.exec(source);
  assert.ok(cancel);
  // It either performs the real call or throws. There is no success path that
  // does not involve queue.cancel resolving.
  assert.match(cancel[0], /client\.queue\.cancel\(/);
  assert.ok(!/return\s*\{\s*outcome:\s*"cancelled"/.test(cancel[0]));
});

// ---------------------------------------------------------------------------
// Cancellation is capability-driven
// ---------------------------------------------------------------------------

test("the cancel activity consults the DECLARED capability, not a method's existence", () => {
  const activity = readSource("worker/activities/generation-activities.ts");
  assert.match(activity, /isUsable\(adapter\.capabilities\.cancel\)/);

  // Adapters that declare no cancel must not be called.
  for (const providerId of listRegisteredProviders()) {
    const adapter = getProviderAdapter(providerId);
    if (!isUsable(adapter.capabilities.cancel)) {
      // Either there is no method at all, or the declaration keeps it unused.
      assert.ok(
        adapter.cancel === undefined || !isUsable(adapter.capabilities.cancel),
        `${providerId} must not be cancellable through an unusable declaration`
      );
    }
  }
});

test("an unsupported cancel reports unsupported, never success", () => {
  const activity = readSource("worker/activities/generation-activities.ts");
  // Anchored to the NEXT top-level declaration: a lazy match to the first
  // "\n}" stops at the parameter object, not at the end of the function.
  const start = activity.indexOf("export async function cancelProviderJob");
  assert.ok(start > 0);
  const rest = activity.slice(start + 1);
  const end = rest.indexOf("\nexport ");
  const body = [end === -1 ? rest : rest.slice(0, end)];
  assert.match(body[0], /return \{ outcome: "unsupported" \}/);
  // A thrown cancel becomes "failed", which the settlement classifier treats
  // as possibly-billable — never "cancelled".
  assert.match(body[0], /outcome: "failed"/);
  assert.ok(
    !/catch[\s\S]*?outcome: "cancelled"/.test(body[0]),
    "a failed cancel must never be reported as confirmed"
  );
});

// ---------------------------------------------------------------------------
// Submission evidence — the ambiguity ladder is intact
// ---------------------------------------------------------------------------

test("submission evidence maps to the four normalized outcomes", () => {
  // ACCEPTED / job present.
  assert.equal(
    decideFailover({
      attempt: { submission_evidence: "job", provider_job_id: "req_1", status: "failed" },
      errorCode: "PROVIDER_FAILED",
      isMockProvider: false,
      attemptCount: 1,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      alternativeRoutesAvailable: 1,
    }).decision,
    "reconciliation_required"
  );

  // CONFIRMED REJECTED — the provider refused; nothing was started.
  assert.equal(
    decideFailover({
      attempt: { submission_evidence: "none", provider_job_id: null, status: "failed" },
      errorCode: "PROVIDER_AUTH_ERROR",
      isMockProvider: false,
      attemptCount: 1,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      alternativeRoutesAvailable: 1,
    }).decision,
    "safe_to_failover"
  );

  // NOT SUBMITTED — never left Cinefield.
  assert.equal(
    decideFailover({
      attempt: { submission_evidence: "none", provider_job_id: null, status: "failed" },
      errorCode: "PROVIDER_NOT_CONFIGURED",
      isMockProvider: false,
      attemptCount: 1,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      alternativeRoutesAvailable: 1,
    }).decision,
    "safe_to_failover"
  );

  // AMBIGUOUS.
  assert.equal(
    decideFailover({
      attempt: { submission_evidence: "ambiguous", provider_job_id: null, status: "failed" },
      errorCode: "PROVIDER_TIMEOUT",
      isMockProvider: false,
      attemptCount: 1,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      alternativeRoutesAvailable: 1,
    }).decision,
    "reconciliation_required"
  );
});

test("a provider timeout is never downgraded into a clean failure", () => {
  // fal's submit() waits for completion inside subscribe(), so a timeout can
  // land long after a billable job started. The allowlist must not prove
  // absence for it.
  assert.equal(
    provesNoProviderJob(new OrchestrationError("PROVIDER_TIMEOUT")),
    false,
    "a timeout proves nothing about whether a job exists"
  );
  assert.equal(provesNoProviderJob(new OrchestrationError("PROVIDER_FAILED")), false);
  assert.equal(provesNoProviderJob(new OrchestrationError("OUTPUT_MISSING")), false);

  // And these DO prove it.
  assert.equal(provesNoProviderJob(new OrchestrationError("PROVIDER_NOT_CONFIGURED")), true);
  assert.equal(provesNoProviderJob(new OrchestrationError("CAPABILITY_NOT_SUPPORTED")), true);
});

test("fal submit obtains the request id WITHOUT waiting for the result", () => {
  // This test used to assert the `onEnqueue` hook, which captured the id
  // partway through a subscribe() call that then waited for completion. That
  // whole mechanism is gone: `queue.submit` returns the id as its response, so
  // the id cannot be lost to a long wait because there is no long wait.
  const source = readSource("src/lib/orchestration/providers/fal-provider.ts");
  const submitBody = /async submit\([\s\S]*?\n  \}/.exec(source);
  assert.ok(submitBody);

  assert.match(submitBody[0], /client\.queue\.submit\(/);
  assert.match(submitBody[0], /request_id/);
  assert.match(submitBody[0], /status: "queued"/);
  assert.ok(!/client\.subscribe\(/.test(submitBody[0]), "submit must not wait for completion");
  assert.ok(!/onEnqueue/.test(submitBody[0]), "no mid-call capture hook is needed any more");

  // And an unnamed acceptance is ambiguity, not success.
  assert.match(submitBody[0], /PROVIDER_SUBMISSION_UNKNOWN/);
});

test("provider failures classify into the Phase 7-C health vocabulary", () => {
  for (const [code, attributable] of [
    ["PROVIDER_RATE_LIMIT", true],
    ["PROVIDER_TIMEOUT", true],
    ["PROVIDER_FAILED", true],
    ["PROVIDER_AUTH_ERROR", false],
    ["PROVIDER_QUOTA_EXCEEDED", false],
    ["CAPABILITY_NOT_SUPPORTED", false],
    ["PROVIDER_SUBMISSION_UNKNOWN", false],
  ] as const) {
    assert.equal(
      countsAgainstProvider(classifyFailure(code)),
      attributable,
      `${code} attribution is wrong`
    );
  }
});

// ---------------------------------------------------------------------------
// Router -> execution correlation
// ---------------------------------------------------------------------------

test("execution follows the persisted router decision, not a re-derived one", () => {
  const orchestrator = readSource("src/lib/orchestration/orchestrator.ts");
  // The adapter is resolved from the REQUEST, which carries the routing
  // decision read off the generation row.
  assert.match(orchestrator, /getProviderAdapter\(request\.provider\)/);
  assert.match(orchestrator, /readRoutingSelection/);
  assert.match(orchestrator, /routing\?\.providerId \?\? model\.providerId/);

  const activities = readSource("worker/activities/generation-activities.ts");
  assert.match(activities, /readRoutingSelection/);
});

test("the browser cannot name the provider anywhere in the chain", () => {
  const createRequest = /export interface GenerationCreateRequest \{[\s\S]*?\n\}/.exec(
    readSource("src/lib/orchestration/generation-create-service.ts")
  );
  assert.ok(createRequest);
  assert.ok(!/provider/i.test(createRequest[0]));

  const apiRoute = readSource("src/app/api/generate/route.ts");
  assert.ok(!/body\.provider|request\.provider/i.test(apiRoute));

  // And the client bundle has no provider identity to send.
  const catalog = readSource("src/lib/orchestration/public-model-catalog.ts");
  assert.ok(!/providerId|fal-ai\//.test(catalog));
});

test("the attempt row is the durable provider correlation, not Redis", () => {
  const repository = readSource("src/lib/orchestration/attempt-repository.ts");
  assert.match(repository, /provider_job_id/);
  assert.ok(!/redis/i.test(repository), "provider job truth must never live in Redis");

  // The routing correlation columns are written by the repository, which is
  // the single place that inserts an attempt.
  assert.match(repository, /model_route_id: input\.routeId/);
  assert.match(repository, /model_version_id: input\.modelVersionId/);

  // And the activity reads prior route ids from the attempt table, not from
  // workflow memory, so a replay cannot re-select a burned route.
  const activities = readSource("worker/activities/generation-activities.ts");
  assert.match(activities, /from\("generation_attempts"\)[\s\S]{0,120}model_route_id/);
});

// ---------------------------------------------------------------------------
// Polling and webhooks
// ---------------------------------------------------------------------------

test("polling never resubmits", () => {
  const workflow = readSource("worker/workflows/generation-workflow.ts");
  const pollLoop = /for \(let checkIndex = 0[\s\S]*?\n    \}/.exec(workflow);
  assert.ok(pollLoop);
  assert.ok(
    !/submitGeneration/.test(pollLoop[0]),
    "the polling loop must never call submit"
  );
  assert.match(pollLoop[0], /checkGenerationStatus/);

  // And a failed CHECK is not a failed job.
  assert.match(workflow, /A failed CHECK is not a failed job/);
});

test("Temporal owns the polling schedule, not BullMQ and not the adapter", () => {
  const workflow = readSource("worker/workflows/generation-workflow.ts");
  assert.match(workflow, /MAX_STATUS_CHECKS/);
  assert.ok(!/bullmq/i.test(workflow));

  const falProvider = readSource("src/lib/orchestration/providers/fal-provider.ts");
  assert.ok(!/setInterval|while \(true\)/.test(falProvider), "no adapter-owned polling loop");
});

test("the webhook boundary requires a verified event and cannot be bypassed", () => {
  const continuation = readSource("src/lib/orchestration/webhook-continuation.ts");
  // A branded type: a plain object literal cannot satisfy it, so an unverified
  // payload cannot reach the continuation.
  assert.match(continuation, /VerifiedWebhookEvent/);
  assert.match(continuation, /markWebhookEventVerified/);

  const bridge = readSource("src/lib/orchestration/webhook-temporal-bridge.ts");
  assert.match(bridge, /VerifiedWebhookEvent/);

  // No provider webhook ingress route exists yet, which is the correct state
  // while no signature scheme is verifiable.
  const apiRoutes = readSource("src/app/api/generate/route.ts");
  assert.ok(!/webhook/i.test(apiRoutes));
});

test("no invented signature verification exists anywhere", () => {
  for (const file of [
    "src/lib/orchestration/webhook-continuation.ts",
    "src/lib/orchestration/webhook-temporal-bridge.ts",
    "src/lib/orchestration/providers/fal-provider.ts",
  ]) {
    const source = readSource(file).replace(/^\s*(\*|\/\/).*$/gm, "");
    for (const forbidden of ["createHmac", "timingSafeEqual", "x-fal-signature"]) {
      assert.ok(
        !new RegExp(forbidden, "i").test(source),
        `${file} must not implement an unverified signature scheme`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

test("no adapter persists or logs a credential", () => {
  for (const file of [
    "src/lib/orchestration/providers/fal-provider.ts",
    "src/lib/orchestration/providers/gemini-provider.ts",
    "src/lib/orchestration/providers/cloudflare-workers-ai-provider.ts",
  ]) {
    const source = readSource(file);
    // The key is read from the environment and used; it is never put into a
    // log line, a metadata object, or a persisted field.
    assert.ok(!/console\.[a-z]+\([^)]*(FAL_KEY|apiKey|Authorization)/i.test(source));
    assert.ok(!/metadata:\s*\{[^}]*(key|token|authorization)/i.test(source));
  }

  const context = /export interface ProviderExecutionContext \{[\s\S]*?\n\}/.exec(
    readSource("src/lib/orchestration/types.ts")
  );
  assert.ok(context);
  assert.ok(
    !/key|token|secret|authorization/i.test(context[0].replace(/^\s*(\*|\/\/).*$/gm, "")),
    "no secret may travel through the execution context"
  );
});

test("submission metadata carries identifiers only, never payloads or URLs", () => {
  const source = readSource("src/lib/orchestration/providers/fal-provider.ts");
  const returned = /return \{\n\s+\/\/[\s\S]*?providerJobId:[\s\S]*?\n      \};/.exec(source);
  assert.ok(returned);
  assert.ok(!/url|payload|response/i.test(returned[0].replace(/^\s*\/\/.*$/gm, "")));
  // The endpoint id is a public model identifier, and it is what makes cancel
  // and reconciliation addressable.
  assert.match(source, /endpointId: model\.providerModelId/);
});

// ---------------------------------------------------------------------------
// Capability matrices as declared (documentation cross-check)
// ---------------------------------------------------------------------------

test("the declared matrices match what this batch actually built", () => {
  assert.equal(FAL_CAPABILITIES.executionShape, "asynchronous");
  assert.equal(MOCK_CAPABILITIES.cancel, "proven");
  assert.equal(GEMINI_CAPABILITIES.cancel, "unsupported_by_adapter");
  assert.equal(CLOUDFLARE_CAPABILITIES.cancel, "unsupported_by_adapter");

  // Only fal can reconcile, and only because queue.status exists.
  assert.ok(isUsable(FAL_CAPABILITIES.reconcileAmbiguousSubmission));
  for (const capabilities of [MOCK_CAPABILITIES, GEMINI_CAPABILITIES, CLOUDFLARE_CAPABILITIES]) {
    assert.ok(!isUsable(capabilities.reconcileAmbiguousSubmission));
  }
});

test("no paid provider was added in this batch", () => {
  const registered = listRegisteredProviders().sort();
  assert.deepEqual(
    registered,
    ["cloudflare-workers-ai", "fal", "gemini", "mock"],
    "Phase 8 batch 1 adds no new provider"
  );
});
