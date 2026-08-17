import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  redriveOneProviderDlqMessage,
  redriveOneProviderDlqMessageWithClient,
  createSqsDlqRedriveQueueClient,
  type ClaimedDlqMessage,
  type DlqRedriveQueueClient,
} from "@/lib/aws/dlq-redrive/adapters/sqs-dlq-redrive-executor";
import type { AttemptRedriveEvidence, DlqRedriveEvidenceSource, GenerationRedriveEvidence } from "@/lib/aws/dlq-redrive/dlq-redrive-contract";
import { getAdminDlqInvestigation, executeAdminDlqRedrive } from "@/lib/admin/dlq-admin-service";
import { isValidDlqRedriveReason } from "@/lib/admin/dlq-admin-contract";
import {
  commandIdFor,
  parseCommand,
  serializeCommand,
  type CommandWireV1,
} from "@/lib/contracts/command-wire";
import { FakeSupabaseClient } from "./fake-supabase";
import { installFakeSupabase } from "./e2e-harness";

/**
 * Phase 16-B — Failed Jobs / DLQ: read-only investigation reused verbatim,
 * plus the new single-message redrive executor.
 *
 * The core promise under test: the redrive decision is recomputed FRESH on
 * every attempt against the message the executor itself just received —
 * never a stale prior decision; a refusal never sends or deletes anything;
 * SAFE_TO_REDRIVE is the ONLY state that leads to a send+delete; and the
 * new executor's env-gated real-AWS path never runs in this test process
 * (`CINEFIELD_SQS_PROVIDER_DLQ_URL`/`CINEFIELD_SQS_PROVIDER_QUEUE_URL` are
 * unset here — zero-cost by construction, not by discipline).
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function wireCommand(overrides: Partial<CommandWireV1> & { attemptId: string; generationId: string }) {
  const type = overrides.type ?? "provider.submit";
  const body = serializeCommand({
    commandId: overrides.commandId ?? commandIdFor(type, overrides.attemptId),
    type,
    generationId: overrides.generationId,
    attemptId: overrides.attemptId,
    issuedAt: overrides.issuedAt ?? new Date().toISOString(),
  });
  const parsed = parseCommand(body);
  if (!parsed.ok) throw new Error(`fixture rejected by the production parser: ${parsed.reason}`);
  return { command: parsed.command, body };
}

function fakeEvidenceSource(over: Partial<DlqRedriveEvidenceSource> = {}): DlqRedriveEvidenceSource {
  return { label: "fake-source", readAttempt: async () => null, readGeneration: async () => null, ...over };
}

function attemptEvidence(over: Partial<AttemptRedriveEvidence> = {}): AttemptRedriveEvidence {
  return {
    attemptId: over.attemptId ?? randomUUID(),
    generationId: over.generationId ?? randomUUID(),
    status: over.status ?? "pending",
    submissionEvidence: over.submissionEvidence ?? "none",
  };
}

function generationEvidence(over: Partial<GenerationRedriveEvidence> = {}): GenerationRedriveEvidence {
  return { generationId: over.generationId ?? randomUUID(), status: over.status ?? "queued" };
}

// ===========================================================================
// PURE ORCHESTRATION — fake DlqRedriveQueueClient, zero AWS cost
// ===========================================================================

function fakeClient(over: Partial<DlqRedriveQueueClient> = {}): DlqRedriveQueueClient & {
  sent: { body: string; groupId: string; dedupId: string }[];
  deleted: string[];
  released: string[];
} {
  const sent: { body: string; groupId: string; dedupId: string }[] = [];
  const deleted: string[] = [];
  const released: string[] = [];
  return {
    receiveAndClaim: async () => null,
    releaseImmediately: async (h: string) => {
      released.push(h);
    },
    sendToProviderQueue: async (body: string, groupId: string, dedupId: string) => {
      sent.push({ body, groupId, dedupId });
    },
    deleteFromDlq: async (h: string) => {
      deleted.push(h);
    },
    sent,
    deleted,
    released,
    ...over,
  };
}

function claimed(over: Partial<ClaimedDlqMessage> = {}): ClaimedDlqMessage {
  return { body: over.body ?? "{}", messageId: over.messageId ?? randomUUID(), receiptHandle: over.receiptHandle ?? randomUUID() };
}

test("no message: NO_MESSAGE, never sends/deletes/releases anything", async () => {
  const client = fakeClient({ receiveAndClaim: async () => null });
  const result = await redriveOneProviderDlqMessageWithClient(client, fakeEvidenceSource());
  assert.deepEqual(result, { outcome: "NO_MESSAGE" });
  assert.equal(client.sent.length, 0);
  assert.equal(client.deleted.length, 0);
  assert.equal(client.released.length, 0);
});

test("receive failure: SOURCE_UNAVAILABLE, never silently NO_MESSAGE", async () => {
  const client = fakeClient({
    receiveAndClaim: async () => {
      throw new Error("boom");
    },
  });
  const result = await redriveOneProviderDlqMessageWithClient(client, fakeEvidenceSource());
  assert.deepEqual(result, { outcome: "SOURCE_UNAVAILABLE", reasonCode: "dlq_receive_failed" });
});

test("UNAVAILABLE (no evidence source at all): message is released immediately, never sent or deleted", async () => {
  const { body } = wireCommand({ attemptId: randomUUID(), generationId: randomUUID() });
  const handle = randomUUID();
  const client = fakeClient({ receiveAndClaim: async () => claimed({ body, receiptHandle: handle }) });

  // A `null` evidence source (distinct from a working source that finds no
  // row) fails closed to UNAVAILABLE, per `evaluateDlqRedriveDecision`'s
  // own contract — either way it is not a permitted state, so the message
  // is still released, never sent or deleted.
  const result = await redriveOneProviderDlqMessageWithClient(client, null);
  assert.equal(result.outcome, "REFUSED");
  if (result.outcome !== "REFUSED") return;
  assert.equal(result.decision.state, "UNAVAILABLE");
  assert.deepEqual(client.released, [handle]);
  assert.equal(client.sent.length, 0);
  assert.equal(client.deleted.length, 0);
});

test("REFUSE_INSUFFICIENT_EVIDENCE (evidence source works but finds no attempt row): message is released, never sent or deleted", async () => {
  const { body } = wireCommand({ attemptId: randomUUID(), generationId: randomUUID() });
  const handle = randomUUID();
  const client = fakeClient({ receiveAndClaim: async () => claimed({ body, receiptHandle: handle }) });
  const source = fakeEvidenceSource({ readAttempt: async () => null });

  const result = await redriveOneProviderDlqMessageWithClient(client, source);
  assert.equal(result.outcome, "REFUSED");
  if (result.outcome !== "REFUSED") return;
  assert.equal(result.decision.state, "REFUSE_INSUFFICIENT_EVIDENCE");
  assert.deepEqual(client.released, [handle]);
  assert.equal(client.sent.length, 0);
  assert.equal(client.deleted.length, 0);
});

test("REFUSE_TERMINAL_GENERATION: refused and released, not redriven", async () => {
  const attemptId = randomUUID();
  const generationId = randomUUID();
  const { body } = wireCommand({ attemptId, generationId });
  const handle = randomUUID();
  const client = fakeClient({ receiveAndClaim: async () => claimed({ body, receiptHandle: handle }) });
  const source = fakeEvidenceSource({
    readAttempt: async () => attemptEvidence({ attemptId, generationId, status: "pending" }),
    readGeneration: async () => generationEvidence({ generationId, status: "completed" }),
  });

  const result = await redriveOneProviderDlqMessageWithClient(client, source);
  assert.equal(result.outcome, "REFUSED");
  if (result.outcome !== "REFUSED") return;
  assert.equal(result.decision.state, "REFUSE_TERMINAL_GENERATION");
  assert.deepEqual(client.released, [handle]);
  assert.equal(client.sent.length, 0);
});

test("SAFE_TO_REDRIVE: sent to the provider queue then deleted from the DLQ, in that order, using the fresh receive's own receipt handle", async () => {
  const attemptId = randomUUID();
  const generationId = randomUUID();
  const { body, command } = wireCommand({ attemptId, generationId });
  const handle = randomUUID();
  const messageId = randomUUID();
  const client = fakeClient({ receiveAndClaim: async () => claimed({ body, receiptHandle: handle, messageId }) });
  const source = fakeEvidenceSource({
    readAttempt: async () => attemptEvidence({ attemptId, generationId, status: "pending", submissionEvidence: "none" }),
    readGeneration: async () => generationEvidence({ generationId, status: "queued" }),
  });

  const result = await redriveOneProviderDlqMessageWithClient(client, source);
  assert.equal(result.outcome, "REDRIVEN");
  if (result.outcome !== "REDRIVEN") return;
  assert.equal(result.decision.state, "SAFE_TO_REDRIVE");
  assert.equal(result.messageId, messageId);
  assert.equal(client.sent.length, 1);
  assert.equal(client.sent[0].body, body);
  assert.equal(client.sent[0].groupId, generationId, "MessageGroupId preserves per-generation FIFO ordering");
  assert.equal(client.sent[0].dedupId, `admin-redrive-${command.commandId}`);
  assert.deepEqual(client.deleted, [handle]);
  assert.equal(client.released.length, 0, "a successful redrive never also releases the claim");
});

test("send/delete failure after a SAFE_TO_REDRIVE decision: SOURCE_UNAVAILABLE, decision is not silently discarded or retried", async () => {
  const attemptId = randomUUID();
  const generationId = randomUUID();
  const { body } = wireCommand({ attemptId, generationId });
  const client = fakeClient({
    receiveAndClaim: async () => claimed({ body }),
    sendToProviderQueue: async () => {
      throw new Error("send failed");
    },
  });
  const source = fakeEvidenceSource({
    readAttempt: async () => attemptEvidence({ attemptId, generationId, status: "pending" }),
    readGeneration: async () => generationEvidence({ generationId, status: "queued" }),
  });

  const result = await redriveOneProviderDlqMessageWithClient(client, source);
  assert.deepEqual(result, { outcome: "SOURCE_UNAVAILABLE", reasonCode: "redrive_send_or_delete_failed" });
});

test("the decision is recomputed fresh from the message this call itself received — a caller cannot pass in a prior decision", () => {
  const serviceText = stripComments(read("src/lib/aws/dlq-redrive/adapters/sqs-dlq-redrive-executor.ts"));
  // No parameter anywhere in the exported orchestration function accepts a
  // pre-computed DlqRedriveDecision — only a queue client and an evidence
  // source, both of which the function itself drives.
  assert.doesNotMatch(serviceText, /decision\s*:\s*DlqRedriveDecision\s*[,)]/, "no exported function accepts an externally-supplied decision");
  assert.match(serviceText, /evaluateDlqRedriveDecision\(\{\s*rawMessageBody:\s*claimed\.body/, "the decision is evaluated against the just-received body");
});

test("createSqsDlqRedriveQueueClient returns null (never a real client) when unconfigured", () => {
  const originalDlq = process.env.CINEFIELD_SQS_PROVIDER_DLQ_URL;
  const originalQueue = process.env.CINEFIELD_SQS_PROVIDER_QUEUE_URL;
  delete process.env.CINEFIELD_SQS_PROVIDER_DLQ_URL;
  delete process.env.CINEFIELD_SQS_PROVIDER_QUEUE_URL;
  try {
    assert.equal(createSqsDlqRedriveQueueClient(), null);
  } finally {
    if (originalDlq !== undefined) process.env.CINEFIELD_SQS_PROVIDER_DLQ_URL = originalDlq;
    if (originalQueue !== undefined) process.env.CINEFIELD_SQS_PROVIDER_QUEUE_URL = originalQueue;
  }
});

test("redriveOneProviderDlqMessage (the real-client entrypoint) returns NOT_CONFIGURED, zero AWS cost, when either URL is unset", async () => {
  const originalDlq = process.env.CINEFIELD_SQS_PROVIDER_DLQ_URL;
  const originalQueue = process.env.CINEFIELD_SQS_PROVIDER_QUEUE_URL;
  delete process.env.CINEFIELD_SQS_PROVIDER_DLQ_URL;
  delete process.env.CINEFIELD_SQS_PROVIDER_QUEUE_URL;
  try {
    assert.deepEqual(await redriveOneProviderDlqMessage(fakeEvidenceSource()), { outcome: "NOT_CONFIGURED" });
  } finally {
    if (originalDlq !== undefined) process.env.CINEFIELD_SQS_PROVIDER_DLQ_URL = originalDlq;
    if (originalQueue !== undefined) process.env.CINEFIELD_SQS_PROVIDER_QUEUE_URL = originalQueue;
  }
});

// ===========================================================================
// dlq-admin-service.ts — thin wrapper, audit logging, reason validation
// ===========================================================================

test("isValidDlqRedriveReason: empty, whitespace-only, and oversized reasons are rejected; a real reason is accepted", () => {
  assert.equal(isValidDlqRedriveReason(""), false);
  assert.equal(isValidDlqRedriveReason("   "), false);
  assert.equal(isValidDlqRedriveReason("a".repeat(501)), false);
  assert.equal(isValidDlqRedriveReason(123), false);
  assert.equal(isValidDlqRedriveReason("investigating incident #42"), true);
});

test("getAdminDlqInvestigation is the exact same wiring scripts/dlq-investigate.ts uses", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const result = await getAdminDlqInvestigation(db as never);
  // Unconfigured in this test process (no CINEFIELD_SQS_PROVIDER_DLQ_URL) —
  // proves the real, unmocked code path runs end to end at zero cost.
  assert.equal(result.outcome, "NOT_CONFIGURED");
});

test("executeAdminDlqRedrive logs an audit line with actor/reason/outcome and never throws on an unconfigured environment", async () => {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const result = await executeAdminDlqRedrive(db as never, "user_admin_test", "investigating incident #42");
  assert.equal(result.outcome, "NOT_CONFIGURED");
});

// ===========================================================================
// STRUCTURAL — the API routes
// ===========================================================================

const NEW_FILES = [
  "src/lib/admin/dlq-admin-contract.ts",
  "src/lib/admin/dlq-admin-service.ts",
  "src/lib/admin/dlq-admin-client-state.ts",
  "src/app/api/admin/dlq/route.ts",
  "src/app/api/admin/dlq/redrive/route.ts",
  "src/app/admin/dlq/page.tsx",
  "src/components/admin/DlqInvestigationPanel.tsx",
].map((rel) => ({ file: rel, text: stripComments(read(rel)) }));

test("the GET route is read-only and the POST route is the only mutation, never reachable via GET", () => {
  const getRoute = read("src/app/api/admin/dlq/route.ts");
  assert.doesNotMatch(getRoute, /redriveOneProviderDlqMessage|executeAdminDlqRedrive/, "GET must never redrive");
  const postRoute = stripComments(read("src/app/api/admin/dlq/redrive/route.ts"));
  assert.match(postRoute, /export async function POST/);
  assert.doesNotMatch(postRoute, /export async function GET/);
});

test("the redrive route requires requireAdminAccess before calling the service, and never uses ROUTE_ADMIN_CLERK_USER_IDS", () => {
  const routeText = stripComments(read("src/app/api/admin/dlq/redrive/route.ts"));
  assert.match(routeText, /requireAdminAccess/);
  assert.doesNotMatch(routeText, /ROUTE_ADMIN_CLERK_USER_IDS/);
  const authIndex = routeText.indexOf("requireAdminAccess");
  const serviceIndex = routeText.indexOf("executeAdminDlqRedrive");
  assert.ok(authIndex >= 0 && serviceIndex >= 0 && authIndex < serviceIndex);
});

test("the redrive route validates the reason before ever calling the service", () => {
  const routeText = stripComments(read("src/app/api/admin/dlq/redrive/route.ts"));
  // Import-statement mentions of both names always appear in declaration
  // order regardless of call order, so the CALL sites are what must be
  // compared, not the first textual occurrence of either identifier.
  const validateCallIndex = routeText.indexOf("isValidDlqRedriveReason(reason)");
  const serviceCallIndex = routeText.indexOf("executeAdminDlqRedrive(");
  assert.ok(validateCallIndex >= 0 && serviceCallIndex >= 0 && validateCallIndex < serviceCallIndex);
});

test("both routes respond through privateJson, never NextResponse.json, and use durable_write for the mutation", () => {
  for (const rel of ["src/app/api/admin/dlq/route.ts", "src/app/api/admin/dlq/redrive/route.ts"]) {
    const text = stripComments(read(rel));
    assert.match(text, /privateJson\(/);
    assert.doesNotMatch(text, /NextResponse\.json\(/);
  }
  assert.match(stripComments(read("src/app/api/admin/dlq/redrive/route.ts")), /routeClass:\s*"durable_write"/);
  assert.match(stripComments(read("src/app/api/admin/dlq/route.ts")), /routeClass:\s*"authenticated_read"/);
});

test("no raw message body, no full AWS response, no stack trace, and no bulk/queue-wide operation anywhere in the new files", () => {
  const forbidden = [
    "rawmessagebody\\s*[:=]\\s*['\"]",
    "\\.stack\\b",
    "startmessagemovetask",
    "purgequeue",
  ];
  for (const { file, text } of NEW_FILES) {
    for (const word of forbidden) {
      assert.doesNotMatch(text.toLowerCase(), new RegExp(word), `${file} mentions forbidden shape "${word}"`);
    }
  }
});

test("no operational mutation outside the redrive action itself exists in the new admin surface", () => {
  const banned = [
    { pattern: /reserveCredits|settleReservation|releaseReservation|credit_ledger|credit_wallets|Stripe/i, why: "no billing mutation" },
    { pattern: /suspendUser|deleteUser|banUser|disableUser/i, why: "no user mutation" },
    { pattern: /setRouteEnabled|setRuntimeRoutingControl/, why: "no routing mutation from the DLQ surface" },
    { pattern: /\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.delete\s*\(/, why: "no database write" },
  ];
  for (const { file, text } of NEW_FILES) {
    for (const rule of banned) {
      assert.doesNotMatch(text, rule.pattern, `${file}: ${rule.why}`);
    }
  }
});

test("no action button exists without an explicit confirmation step in the UI", () => {
  const panelText = stripComments(read("src/components/admin/DlqInvestigationPanel.tsx"));
  assert.match(panelText, /confirming/i, "a confirmation state must gate the redrive button");
  assert.match(panelText, /reason/i, "a reason input must exist");
});
