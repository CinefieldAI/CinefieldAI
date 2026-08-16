import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  DLQ_REDRIVE_DECISION_STATES,
  REDRIVE_PERMITTED_STATES,
  isRedrivePermitted,
  type AttemptRedriveEvidence,
  type DlqRedriveDecisionState,
  type DlqRedriveEvidenceSource,
  type GenerationRedriveEvidence,
} from "@/lib/aws/dlq-redrive/dlq-redrive-contract";
import { evaluateDlqRedriveDecision } from "@/lib/aws/dlq-redrive/dlq-redrive-decision-engine";
import { createSupabaseDlqRedriveSource } from "@/lib/aws/dlq-redrive/adapters/supabase-dlq-redrive-source";
import { evaluateProviderDlqMessage } from "@/lib/aws/dlq-redrive/dlq-redrive-service";
import { SQS_QUEUES } from "@/lib/aws/sqs-topology";
import {
  commandIdFor,
  parseCommand,
  serializeCommand,
  COMMAND_WIRE_VERSION,
  type CommandWireV1,
} from "@/lib/contracts/command-wire";
import { getSupabaseAdminClient } from "@/lib/supabase/supabaseAdmin";
import { FakeSupabaseClient } from "./fake-supabase";
import { installFakeSupabase, seedGeneration } from "./e2e-harness";

/**
 * Phase 15-D/1 — DLQ redrive decision engine + evidence contract.
 *
 * The core promise under test: SAFE_TO_REDRIVE is reachable through exactly
 * one durable-evidence shape (pending attempt, no submission evidence,
 * submittable generation), every other combination refuses by a NAMED
 * reason, and the engine never executes a provider, mutates billing, or
 * calls a real AWS redrive API — proven structurally, not just by
 * inspection.
 */

const ROOT = process.cwd();
const PKG_DIR = path.join(ROOT, "src", "lib", "aws", "dlq-redrive");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Directory walk (recursive one level for adapters/), not `git ls-files` — an untracked module must still be seen. */
function packageFiles(dir: string, prefix: string): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      out.push(...packageFiles(path.join(dir, entry.name), `${prefix}${entry.name}/`));
    } else if (entry.name.endsWith(".ts")) {
      out.push({
        file: `${prefix}${entry.name}`,
        text: stripComments(readFileSync(path.join(dir, entry.name), "utf8")),
      });
    }
  }
  return out;
}

const packageCode = packageFiles(PKG_DIR, "src/lib/aws/dlq-redrive/");

function wireCommand(overrides: Partial<CommandWireV1> & { attemptId: string; generationId: string }) {
  const type = overrides.type ?? "provider.submit";
  const body = serializeCommand({
    commandId: overrides.commandId ?? commandIdFor(type, overrides.attemptId),
    type,
    generationId: overrides.generationId,
    attemptId: overrides.attemptId,
    issuedAt: overrides.issuedAt ?? new Date().toISOString(),
    ...(overrides.traceId ? { traceId: overrides.traceId } : {}),
  });
  const parsed = parseCommand(body);
  if (!parsed.ok) throw new Error(`fixture rejected by the production parser: ${parsed.reason}`);
  return { command: parsed.command, body };
}

// ---------------------------------------------------------------------------
// Fake evidence source — pure engine tests, zero database
// ---------------------------------------------------------------------------

function fakeSource(over: Partial<DlqRedriveEvidenceSource> = {}): DlqRedriveEvidenceSource {
  return {
    label: "fake-source",
    readAttempt: async () => null,
    readGeneration: async () => null,
    ...over,
  };
}

function attemptEvidence(over: Partial<AttemptRedriveEvidence> = {}): AttemptRedriveEvidence {
  return {
    attemptId: "attempt-1",
    generationId: "generation-1",
    status: "pending",
    submissionEvidence: "none",
    ...over,
  };
}

function generationEvidence(over: Partial<GenerationRedriveEvidence> = {}): GenerationRedriveEvidence {
  return { generationId: "generation-1", status: "queued", ...over };
}

const ATTEMPT_ID = "11111111-1111-1111-1111-111111111111";
const GENERATION_ID = "22222222-2222-2222-2222-222222222222";

function validBody(over: Partial<{ attemptId: string; generationId: string }> = {}): string {
  const { body } = wireCommand({
    attemptId: over.attemptId ?? ATTEMPT_ID,
    generationId: over.generationId ?? GENERATION_ID,
  });
  return body;
}

// ===========================================================================
// A. THE ONE POSITIVE PATH
// ===========================================================================

test("A1: pending attempt + no evidence + submittable generation => SAFE_TO_REDRIVE", async () => {
  const source = fakeSource({
    readAttempt: async () => attemptEvidence({ attemptId: ATTEMPT_ID, generationId: GENERATION_ID }),
    readGeneration: async () => generationEvidence({ generationId: GENERATION_ID, status: "queued" }),
  });
  const decision = await evaluateDlqRedriveDecision({ rawMessageBody: validBody(), source });

  assert.equal(decision.state, "SAFE_TO_REDRIVE");
  assert.equal(decision.attemptId, ATTEMPT_ID);
  assert.equal(decision.generationId, GENERATION_ID);
  assert.equal(decision.sourceQueue, SQS_QUEUES.provider.name, "queue name reused, never invented");
  assert.equal(decision.dlqName, SQS_QUEUES.provider.dlqName, "DLQ name reused, never invented");
  assert.ok(isRedrivePermitted(decision.state));
});

test("A2: SAFE_TO_REDRIVE also reachable with generation status 'processing'", async () => {
  const source = fakeSource({
    readAttempt: async () => attemptEvidence({ attemptId: ATTEMPT_ID, generationId: GENERATION_ID }),
    readGeneration: async () => generationEvidence({ generationId: GENERATION_ID, status: "processing" }),
  });
  const decision = await evaluateDlqRedriveDecision({ rawMessageBody: validBody(), source });
  assert.equal(decision.state, "SAFE_TO_REDRIVE");
});

// ===========================================================================
// B. AMBIGUOUS PROVIDER STATE
// ===========================================================================

test("B1: submission_evidence 'ambiguous' refuses, never resubmitted", async () => {
  const source = fakeSource({
    readAttempt: async () =>
      attemptEvidence({ attemptId: ATTEMPT_ID, generationId: GENERATION_ID, submissionEvidence: "ambiguous", status: "failed" }),
    readGeneration: async () => generationEvidence({ generationId: GENERATION_ID }),
  });
  const decision = await evaluateDlqRedriveDecision({ rawMessageBody: validBody(), source });
  // attempt.status "failed" is itself terminal and is checked first — this
  // proves the terminal check does not accidentally let ambiguous evidence
  // through a different branch, not that ambiguous evidence is unreachable.
  assert.equal(decision.state, "REFUSE_TERMINAL_GENERATION");
});

test("B2: submission_evidence 'job' on a non-terminal attempt refuses as ambiguous", async () => {
  const source = fakeSource({
    readAttempt: async () =>
      attemptEvidence({ attemptId: ATTEMPT_ID, generationId: GENERATION_ID, submissionEvidence: "job", status: "processing" }),
    readGeneration: async () => generationEvidence({ generationId: GENERATION_ID, status: "processing" }),
  });
  const decision = await evaluateDlqRedriveDecision({ rawMessageBody: validBody(), source });
  assert.equal(decision.state, "REFUSE_AMBIGUOUS_PROVIDER_STATE");
  assert.equal(decision.reasonCode, "submission_evidence_present:job");
  assert.ok(!isRedrivePermitted(decision.state));
});

test("B3: attempt still 'claimed' (in flight, no evidence yet) refuses as ambiguous", async () => {
  const source = fakeSource({
    readAttempt: async () => attemptEvidence({ attemptId: ATTEMPT_ID, generationId: GENERATION_ID, status: "claimed" }),
    readGeneration: async () => generationEvidence({ generationId: GENERATION_ID }),
  });
  const decision = await evaluateDlqRedriveDecision({ rawMessageBody: validBody(), source });
  assert.equal(decision.state, "REFUSE_AMBIGUOUS_PROVIDER_STATE");
  assert.equal(decision.reasonCode, "attempt_in_flight:claimed");
});

test("B4: attempt 'submitting' refuses as ambiguous", async () => {
  const source = fakeSource({
    readAttempt: async () => attemptEvidence({ attemptId: ATTEMPT_ID, generationId: GENERATION_ID, status: "submitting" }),
    readGeneration: async () => generationEvidence({ generationId: GENERATION_ID }),
  });
  const decision = await evaluateDlqRedriveDecision({ rawMessageBody: validBody(), source });
  assert.equal(decision.state, "REFUSE_AMBIGUOUS_PROVIDER_STATE");
});

// ===========================================================================
// C. TERMINAL GENERATION / ATTEMPT
// ===========================================================================

for (const status of ["succeeded", "failed", "cancelled"] as const) {
  test(`C1(${status}): terminal attempt refuses, replay is invalid`, async () => {
    const source = fakeSource({
      readAttempt: async () => attemptEvidence({ attemptId: ATTEMPT_ID, generationId: GENERATION_ID, status }),
      readGeneration: async () => generationEvidence({ generationId: GENERATION_ID }),
    });
    const decision = await evaluateDlqRedriveDecision({ rawMessageBody: validBody(), source });
    assert.equal(decision.state, "REFUSE_TERMINAL_GENERATION");
    assert.equal(decision.reasonCode, `attempt_already_terminal:${status}`);
  });
}

for (const status of ["completed", "failed", "cancelled"] as const) {
  test(`C2(${status}): terminal generation refuses even with a pending attempt`, async () => {
    const source = fakeSource({
      readAttempt: async () => attemptEvidence({ attemptId: ATTEMPT_ID, generationId: GENERATION_ID, status: "pending" }),
      readGeneration: async () => generationEvidence({ generationId: GENERATION_ID, status }),
    });
    const decision = await evaluateDlqRedriveDecision({ rawMessageBody: validBody(), source });
    assert.equal(decision.state, "REFUSE_TERMINAL_GENERATION");
    assert.equal(decision.reasonCode, `generation_already_terminal:${status}`);
  });
}

// ===========================================================================
// D. INVALID / MALFORMED MESSAGE
// ===========================================================================

test("D1: not JSON refuses as invalid message, no evidence source touched", async () => {
  let touched = false;
  const source = fakeSource({ readAttempt: async () => ((touched = true), null) });
  const decision = await evaluateDlqRedriveDecision({ rawMessageBody: "not json", source });
  assert.equal(decision.state, "REFUSE_INVALID_MESSAGE");
  assert.equal(touched, false, "the evidence source must never be read for a malformed message");
});

test("D2: unsupported wire version refuses as invalid message", async () => {
  const body = JSON.stringify({
    v: COMMAND_WIRE_VERSION + 1,
    commandId: commandIdFor("provider.submit", ATTEMPT_ID),
    type: "provider.submit",
    generationId: GENERATION_ID,
    attemptId: ATTEMPT_ID,
    issuedAt: new Date().toISOString(),
  });
  const decision = await evaluateDlqRedriveDecision({ rawMessageBody: body, source: fakeSource() });
  assert.equal(decision.state, "REFUSE_INVALID_MESSAGE");
  assert.equal(decision.reasonCode, "schema_invalid:unsupported_version");
});

test("D3: an unknown field refuses as invalid message (secrets cannot ride along)", async () => {
  const body = JSON.stringify({
    v: COMMAND_WIRE_VERSION,
    commandId: commandIdFor("provider.submit", ATTEMPT_ID),
    type: "provider.submit",
    generationId: GENERATION_ID,
    attemptId: ATTEMPT_ID,
    issuedAt: new Date().toISOString(),
    apiKey: "sk-should-never-be-here",
  });
  const decision = await evaluateDlqRedriveDecision({ rawMessageBody: body, source: fakeSource() });
  assert.equal(decision.state, "REFUSE_INVALID_MESSAGE");
  assert.match(decision.reasonCode, /^schema_invalid:unknown_field/);
});

test("D4: message generationId disagreeing with durable attempt refuses as invalid", async () => {
  const source = fakeSource({
    readAttempt: async () =>
      attemptEvidence({ attemptId: ATTEMPT_ID, generationId: "33333333-3333-3333-3333-333333333333" }),
  });
  const decision = await evaluateDlqRedriveDecision({
    rawMessageBody: validBody({ attemptId: ATTEMPT_ID, generationId: GENERATION_ID }),
    source,
  });
  assert.equal(decision.state, "REFUSE_INVALID_MESSAGE");
  assert.equal(decision.reasonCode, "generation_mismatch");
});

// ===========================================================================
// E. INSUFFICIENT EVIDENCE
// ===========================================================================

test("E1: attempt not found refuses as insufficient evidence, never safe", async () => {
  const source = fakeSource({ readAttempt: async () => null });
  const decision = await evaluateDlqRedriveDecision({ rawMessageBody: validBody(), source });
  assert.equal(decision.state, "REFUSE_INSUFFICIENT_EVIDENCE");
  assert.equal(decision.reasonCode, "attempt_not_found");
});

test("E2: generation not found refuses as insufficient evidence", async () => {
  const source = fakeSource({
    readAttempt: async () => attemptEvidence({ attemptId: ATTEMPT_ID, generationId: GENERATION_ID }),
    readGeneration: async () => null,
  });
  const decision = await evaluateDlqRedriveDecision({ rawMessageBody: validBody(), source });
  assert.equal(decision.state, "REFUSE_INSUFFICIENT_EVIDENCE");
  assert.equal(decision.reasonCode, "generation_not_found");
});

test("E3: an unmodeled attempt status fails closed rather than defaulting to safe", async () => {
  const source = fakeSource({
    readAttempt: async () =>
      attemptEvidence({
        attemptId: ATTEMPT_ID,
        generationId: GENERATION_ID,
        // Cast past the closed union deliberately: proves the engine does
        // not fall through to SAFE_TO_REDRIVE for anything it does not
        // explicitly recognise, even if a future status value slipped past
        // the type system at a boundary.
        status: "unmodeled_future_status" as unknown as AttemptRedriveEvidence["status"],
      }),
    readGeneration: async () => generationEvidence({ generationId: GENERATION_ID }),
  });
  const decision = await evaluateDlqRedriveDecision({ rawMessageBody: validBody(), source });
  assert.equal(decision.state, "REFUSE_INSUFFICIENT_EVIDENCE");
  assert.equal(decision.reasonCode, "unmodeled_attempt_status:unmodeled_future_status");
});

// ===========================================================================
// F. UNAVAILABLE — FAIL CLOSED ON A READ FAILURE
// ===========================================================================

test("F1: no evidence source configured => UNAVAILABLE, not safe", async () => {
  const decision = await evaluateDlqRedriveDecision({ rawMessageBody: validBody(), source: null });
  assert.equal(decision.state, "UNAVAILABLE");
  assert.equal(decision.reasonCode, "evidence_source_not_configured");
});

test("F2: attempt read throwing => UNAVAILABLE", async () => {
  const source = fakeSource({
    readAttempt: async () => {
      throw new Error("connection reset");
    },
  });
  const decision = await evaluateDlqRedriveDecision({ rawMessageBody: validBody(), source });
  assert.equal(decision.state, "UNAVAILABLE");
  assert.equal(decision.reasonCode, "attempt_read_failed");
});

test("F3: generation read throwing => UNAVAILABLE", async () => {
  const source = fakeSource({
    readAttempt: async () => attemptEvidence({ attemptId: ATTEMPT_ID, generationId: GENERATION_ID }),
    readGeneration: async () => {
      throw new Error("connection reset");
    },
  });
  const decision = await evaluateDlqRedriveDecision({ rawMessageBody: validBody(), source });
  assert.equal(decision.state, "UNAVAILABLE");
  assert.equal(decision.reasonCode, "generation_read_failed");
});

// ===========================================================================
// G. PINNED ENUM — a new status can never silently inherit SAFE behaviour
// ===========================================================================

test("G1: DLQ_REDRIVE_DECISION_STATES is pinned to exactly the documented six", () => {
  assert.deepEqual(
    [...DLQ_REDRIVE_DECISION_STATES].sort(),
    [
      "REFUSE_AMBIGUOUS_PROVIDER_STATE",
      "REFUSE_INSUFFICIENT_EVIDENCE",
      "REFUSE_INVALID_MESSAGE",
      "REFUSE_TERMINAL_GENERATION",
      "SAFE_TO_REDRIVE",
      "UNAVAILABLE",
    ].sort()
  );
});

test("G2: exactly one state permits a redrive", () => {
  assert.deepEqual([...REDRIVE_PERMITTED_STATES], ["SAFE_TO_REDRIVE"]);
  for (const state of DLQ_REDRIVE_DECISION_STATES) {
    assert.equal(isRedrivePermitted(state), state === "SAFE_TO_REDRIVE");
  }
});

test("G3: every engine outcome across this file is a member of the pinned set", async () => {
  const states = new Set<DlqRedriveDecisionState>();
  const scenarios: { source: DlqRedriveEvidenceSource | null; body?: string }[] = [
    { source: fakeSource({ readAttempt: async () => attemptEvidence(), readGeneration: async () => generationEvidence() }) },
    { source: fakeSource({ readAttempt: async () => null }) },
    { source: null },
  ];
  for (const scenario of scenarios) {
    const decision = await evaluateDlqRedriveDecision({
      rawMessageBody: scenario.body ?? validBody(),
      source: scenario.source,
    });
    states.add(decision.state);
  }
  for (const state of states) {
    assert.ok(DLQ_REDRIVE_DECISION_STATES.includes(state));
  }
});

// ===========================================================================
// H. REAL ADAPTER — real repository reads against the in-memory Supabase double
// ===========================================================================

async function dlqScenario(over: {
  attempt?: Partial<Record<string, unknown>>;
  generationStatus?: string;
} = {}) {
  const db = new FakeSupabaseClient();
  await installFakeSupabase(db);
  const { generationId, clerkUserId } = seedGeneration(db, {
    metadata: { mock_mode: "async-success" },
    ...(over.generationStatus ? { status: over.generationStatus } : {}),
  });

  const attemptId = randomUUID();
  const a = over.attempt ?? {};
  db.state.generation_attempts.push({
    id: attemptId,
    generation_id: a.generation_id ?? generationId,
    attempt_no: 1,
    provider: "mock",
    provider_model: "mock-image-v1",
    provider_job_id: a.provider_job_id ?? null,
    submission_evidence: a.submission_evidence ?? "none",
    status: a.status ?? "pending",
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    submitted_at: null,
    completed_at: null,
    error_code: null,
    submission_error_code: null,
    cost_amount: null,
    cost_currency: null,
    latency_ms: null,
    workflow_id: null,
    workflow_run_id: null,
  });

  return { db, generationId, clerkUserId, attemptId };
}

test("H1: real adapter over a real pending/queued fixture reaches SAFE_TO_REDRIVE", async () => {
  const { generationId, attemptId } = await dlqScenario();
  const decision = await evaluateProviderDlqMessage(getSupabaseAdminClient(), validBody({ attemptId, generationId }));
  assert.equal(decision.state, "SAFE_TO_REDRIVE");
});

test("H2: real adapter over an ambiguous fixture refuses", async () => {
  const { generationId, attemptId } = await dlqScenario({
    attempt: { status: "failed", submission_evidence: "ambiguous" },
  });
  const decision = await evaluateProviderDlqMessage(getSupabaseAdminClient(), validBody({ attemptId, generationId }));
  assert.equal(decision.state, "REFUSE_TERMINAL_GENERATION");
});

test("H3: real adapter, attempt id that was never created, refuses as insufficient evidence", async () => {
  await dlqScenario();
  const ghostAttempt = randomUUID();
  const ghostGeneration = randomUUID();
  const decision = await evaluateProviderDlqMessage(
    getSupabaseAdminClient(),
    validBody({ attemptId: ghostAttempt, generationId: ghostGeneration })
  );
  assert.equal(decision.state, "REFUSE_INSUFFICIENT_EVIDENCE");
  assert.equal(decision.reasonCode, "attempt_not_found");
});

test("H4: real adapter's generation read selects nothing but status", async () => {
  const { generationId } = await dlqScenario();
  const admin = getSupabaseAdminClient();
  const source = createSupabaseDlqRedriveSource(admin);
  const evidence = await source.readGeneration(generationId);
  assert.deepEqual(evidence && Object.keys(evidence).sort(), ["generationId", "status"]);
});

// ===========================================================================
// I. SAFETY — STRUCTURAL PROOF THE ENGINE CANNOT ACT
// ===========================================================================

const BANNED_IDENTIFIERS: { pattern: RegExp; why: string }[] = [
  { pattern: /submitAttempt\s*\(/, why: "must never submit a provider" },
  { pattern: /executeGeneration\s*\(/, why: "must never execute a generation directly" },
  { pattern: /reserveCredits|settleReservation|releaseReservation/, why: "must never touch credit reservations" },
  { pattern: /cost_amount|cost_currency/, why: "must never write billing fields" },
  { pattern: /credit_ledger|credit_wallets/, why: "must never touch the money ledger" },
  { pattern: /claimAttemptForSubmission|markAttemptSubmitting|recordProviderJob|markAttemptTerminal/, why: "must never mutate an attempt's claim" },
  { pattern: /StartMessageMoveTask|@aws-sdk|new\s+SQSClient/, why: "must never call a real AWS redrive API" },
  { pattern: /\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.delete\s*\(/, why: "must never write to the database" },
];

test("I1: no file in the dlq-redrive package can execute a provider, spend money, or call AWS", () => {
  for (const { file, text } of packageCode) {
    for (const banned of BANNED_IDENTIFIERS) {
      assert.doesNotMatch(text, banned.pattern, `${file}: ${banned.why}`);
    }
  }
});

test("I2: the generation read is literally select(\"status\") — no wider select exists in the package", () => {
  const adapter = packageCode.find((f) => f.file.endsWith("supabase-dlq-redrive-source.ts"));
  assert.ok(adapter);
  const selects = [...adapter.text.matchAll(/\.select\(([^)]*)\)/g)].map((m) => m[1]);
  for (const args of selects) {
    assert.match(args, /^"status"$/, `unexpected select() arguments in the adapter: ${args}`);
  }
});

test("I3: no sensitive field name appears anywhere in the package", () => {
  const forbidden = ["prompt", "negative_prompt", "input_url", "output_url", "thumbnail_url", "apiKey", "signedUrl", "authorization"];
  for (const { file, text } of packageCode) {
    for (const word of forbidden) {
      assert.doesNotMatch(text.toLowerCase(), new RegExp(word.toLowerCase()), `${file} mentions forbidden field "${word}"`);
    }
  }
});

test("I4: a decision object never carries a field outside the documented contract shape", async () => {
  const source = fakeSource({
    readAttempt: async () => attemptEvidence({ attemptId: ATTEMPT_ID, generationId: GENERATION_ID }),
    readGeneration: async () => generationEvidence({ generationId: GENERATION_ID }),
  });
  const decision = await evaluateDlqRedriveDecision({ rawMessageBody: validBody(), source });
  const allowed = new Set(["state", "reasonCode", "commandId", "attemptId", "generationId", "sourceQueue", "dlqName", "evaluatedAt"]);
  for (const key of Object.keys(decision)) {
    assert.ok(allowed.has(key), `unexpected field on DlqRedriveDecision: ${key}`);
  }
});

// ===========================================================================
// J. CLASSIFICATION SEMANTICS ARE NOT CONTRADICTED
// ===========================================================================

test("J1: this engine's terminal/submittable literals agree with provider-command-handler.ts's own", () => {
  const handlerText = stripComments(read("worker/provider-command-handler.ts"));

  // The handler's own already-terminal check and its SUBMITTABLE_GENERATION_STATUSES
  // set. A structural (not semantic) agreement check: every status this
  // engine treats as terminal/submittable must appear in the handler's
  // source too, so the two vocabularies cannot silently diverge.
  for (const status of ["succeeded", "failed", "cancelled"]) {
    assert.match(handlerText, new RegExp(`"${status}"`), `handler no longer mentions attempt status "${status}"`);
  }
  for (const status of ["queued", "processing"]) {
    assert.match(
      handlerText,
      new RegExp(`SUBMITTABLE_GENERATION_STATUSES[\\s\\S]{0,80}"${status}"|"${status}"[\\s\\S]{0,80}SUBMITTABLE_GENERATION_STATUSES`),
      `handler's SUBMITTABLE_GENERATION_STATUSES no longer visibly includes "${status}"`
    );
  }
});

test("J2: the engine documents (does not silently reuse) CommandClassification as a distinct vocabulary", () => {
  const engineText = read(path.join("src", "lib", "aws", "dlq-redrive", "dlq-redrive-decision-engine.ts"));
  assert.match(engineText, /CommandClassification/, "the engine must name the classification it is NOT reusing directly");
});

// ===========================================================================
// K. WIRE VALIDATION IS PRODUCTION'S OWN
// ===========================================================================

test("K1: a fixture the production parser itself rejects is refused the same way through the engine", async () => {
  const body = JSON.stringify({ v: COMMAND_WIRE_VERSION, type: "provider.submit" });
  const directParse = parseCommand(body);
  assert.equal(directParse.ok, false);

  const decision = await evaluateDlqRedriveDecision({ rawMessageBody: body, source: fakeSource() });
  assert.equal(decision.state, "REFUSE_INVALID_MESSAGE");
});
