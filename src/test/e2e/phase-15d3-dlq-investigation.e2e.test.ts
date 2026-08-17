import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  DLQ_INVESTIGATION_QUEUE,
  createSqsDlqMessageSource,
} from "@/lib/aws/dlq-redrive/adapters/sqs-dlq-message-source";
import { investigateProviderDlq, type DlqInvestigationResult } from "@/lib/aws/dlq-redrive/dlq-investigation-service";
import type { DlqMessage, DlqMessageSource } from "@/lib/aws/dlq-redrive/dlq-message-source-contract";
import type { AttemptRedriveEvidence, DlqRedriveEvidenceSource, GenerationRedriveEvidence } from "@/lib/aws/dlq-redrive/dlq-redrive-contract";
import { SQS_QUEUES } from "@/lib/aws/sqs-topology";
import { commandIdFor, parseCommand, serializeCommand, type CommandWireV1 } from "@/lib/contracts/command-wire";

/**
 * Phase 15-D/3 — manual DLQ investigation entrypoint.
 *
 * The core promise under test: this path can only ever OBSERVE. It reads at
 * most one message (never deletes, never redrives), evaluates it through the
 * EXISTING Phase 15-D/1 decision engine (never a second implementation of
 * it), and its only possible outcomes are NOT_CONFIGURED, SOURCE_UNAVAILABLE,
 * NO_MESSAGE, or a DECIDED verdict from that unmodified engine.
 */

const ROOT = process.cwd();
const PKG_DIR = path.join(ROOT, "src", "lib", "aws", "dlq-redrive");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

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
const scriptCode = { file: "scripts/dlq-investigate.ts", text: stripComments(read("scripts/dlq-investigate.ts")) };
const allCode = [...packageCode, scriptCode];

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

const ATTEMPT_ID = "11111111-1111-1111-1111-111111111111";
const GENERATION_ID = "22222222-2222-2222-2222-222222222222";

function fakeMessageSource(over: Partial<DlqMessageSource> = {}): DlqMessageSource {
  return {
    label: "fake-dlq",
    peekMessage: async () => null,
    ...over,
  };
}

function fakeEvidenceSource(over: Partial<DlqRedriveEvidenceSource> = {}): DlqRedriveEvidenceSource {
  return {
    label: "fake-evidence",
    readAttempt: async () => null,
    readGeneration: async () => null,
    ...over,
  };
}

function attemptEvidence(over: Partial<AttemptRedriveEvidence> = {}): AttemptRedriveEvidence {
  return { attemptId: ATTEMPT_ID, generationId: GENERATION_ID, status: "pending", submissionEvidence: "none", ...over };
}

function generationEvidence(over: Partial<GenerationRedriveEvidence> = {}): GenerationRedriveEvidence {
  return { generationId: GENERATION_ID, status: "queued", ...over };
}

function message(over: Partial<DlqMessage> = {}): DlqMessage {
  return { body: wireCommand({ attemptId: ATTEMPT_ID, generationId: GENERATION_ID }).body, messageId: "msg-1", ...over };
}

// ===========================================================================
// A. SCOPE — CANONICAL DLQ ONLY
// ===========================================================================

test("1: DLQ_INVESTIGATION_QUEUE is the existing provider DLQ, never a second queue name", () => {
  assert.equal(DLQ_INVESTIGATION_QUEUE, SQS_QUEUES.provider.dlqName);
});

test("createSqsDlqMessageSource returns null (never a real client) when unconfigured", () => {
  const saved = process.env.CINEFIELD_SQS_PROVIDER_DLQ_URL;
  delete process.env.CINEFIELD_SQS_PROVIDER_DLQ_URL;
  try {
    assert.equal(createSqsDlqMessageSource(), null);
  } finally {
    if (saved !== undefined) process.env.CINEFIELD_SQS_PROVIDER_DLQ_URL = saved;
  }
});

// ===========================================================================
// B. INVESTIGATION SERVICE — FOUR OUTCOMES, NO FIFTH
// ===========================================================================

test("2/3: a valid ids-only message with safe evidence reaches SAFE_TO_REDRIVE via the existing engine", async () => {
  const result = await investigateProviderDlq({
    messageSource: fakeMessageSource({ peekMessage: async () => message() }),
    evidenceSource: fakeEvidenceSource({
      readAttempt: async () => attemptEvidence(),
      readGeneration: async () => generationEvidence(),
    }),
  });
  assert.equal(result.outcome, "DECIDED");
  assert.equal((result as { decision: { state: string } }).decision.state, "SAFE_TO_REDRIVE");
});

test("4: ambiguous evidence refuses through the existing engine, unmodified", async () => {
  const result = await investigateProviderDlq({
    messageSource: fakeMessageSource({ peekMessage: async () => message() }),
    evidenceSource: fakeEvidenceSource({
      readAttempt: async () => attemptEvidence({ submissionEvidence: "job", status: "processing" }),
      readGeneration: async () => generationEvidence({ status: "processing" }),
    }),
  });
  assert.equal(result.outcome, "DECIDED");
  assert.equal((result as { decision: { state: string } }).decision.state, "REFUSE_AMBIGUOUS_PROVIDER_STATE");
});

test("5: a terminal generation refuses", async () => {
  const result = await investigateProviderDlq({
    messageSource: fakeMessageSource({ peekMessage: async () => message() }),
    evidenceSource: fakeEvidenceSource({
      readAttempt: async () => attemptEvidence({ status: "pending" }),
      readGeneration: async () => generationEvidence({ status: "completed" }),
    }),
  });
  assert.equal(result.outcome, "DECIDED");
  assert.equal((result as { decision: { state: string } }).decision.state, "REFUSE_TERMINAL_GENERATION");
});

test("6: missing durable evidence (attempt not found) refuses as insufficient evidence", async () => {
  const result = await investigateProviderDlq({
    messageSource: fakeMessageSource({ peekMessage: async () => message() }),
    evidenceSource: fakeEvidenceSource({ readAttempt: async () => null }),
  });
  assert.equal(result.outcome, "DECIDED");
  assert.equal((result as { decision: { state: string } }).decision.state, "REFUSE_INSUFFICIENT_EVIDENCE");
});

test("7: a malformed message refuses as invalid, and the evidence source is never touched", async () => {
  let touched = false;
  const result = await investigateProviderDlq({
    messageSource: fakeMessageSource({ peekMessage: async () => ({ body: "not json", messageId: "msg-2" }) }),
    evidenceSource: fakeEvidenceSource({ readAttempt: async () => ((touched = true), null) }),
  });
  assert.equal(result.outcome, "DECIDED");
  assert.equal((result as { decision: { state: string } }).decision.state, "REFUSE_INVALID_MESSAGE");
  assert.equal(touched, false);
});

test("8: the queue itself being unreadable fails closed as SOURCE_UNAVAILABLE, never NO_MESSAGE", async () => {
  const result = await investigateProviderDlq({
    messageSource: fakeMessageSource({
      peekMessage: async () => {
        throw new Error("network blip");
      },
    }),
    evidenceSource: fakeEvidenceSource(),
  });
  assert.deepEqual(result, { outcome: "SOURCE_UNAVAILABLE", reasonCode: "dlq_read_failed" });
});

test("9: durable evidence being unreadable fails closed through the existing engine's own UNAVAILABLE state", async () => {
  const result = await investigateProviderDlq({
    messageSource: fakeMessageSource({ peekMessage: async () => message() }),
    evidenceSource: fakeEvidenceSource({
      readAttempt: async () => {
        throw new Error("db down");
      },
    }),
  });
  assert.equal(result.outcome, "DECIDED");
  assert.equal((result as { decision: { state: string } }).decision.state, "UNAVAILABLE");
});

test("10: an empty DLQ produces an explicit NO_MESSAGE, never treated as an error or as safe", async () => {
  const result = await investigateProviderDlq({
    messageSource: fakeMessageSource({ peekMessage: async () => null }),
    evidenceSource: fakeEvidenceSource(),
  });
  assert.deepEqual(result, { outcome: "NO_MESSAGE" });
});

test("no message source configured => NOT_CONFIGURED, never assumed empty or safe", async () => {
  const result = await investigateProviderDlq({ messageSource: null, evidenceSource: fakeEvidenceSource() });
  assert.deepEqual(result, { outcome: "NOT_CONFIGURED" });
});

test("every reachable outcome across this file is one of the four documented shapes", async () => {
  const scenarios: DlqInvestigationResult["outcome"][] = [];
  const cases: (() => Promise<DlqInvestigationResult>)[] = [
    () => investigateProviderDlq({ messageSource: null, evidenceSource: null }),
    () =>
      investigateProviderDlq({
        messageSource: fakeMessageSource({
          peekMessage: async () => {
            throw new Error("x");
          },
        }),
        evidenceSource: null,
      }),
    () => investigateProviderDlq({ messageSource: fakeMessageSource(), evidenceSource: null }),
    () =>
      investigateProviderDlq({
        messageSource: fakeMessageSource({ peekMessage: async () => message() }),
        evidenceSource: fakeEvidenceSource({ readAttempt: async () => attemptEvidence(), readGeneration: async () => generationEvidence() }),
      }),
  ];
  for (const run of cases) scenarios.push((await run()).outcome);
  for (const outcome of scenarios) {
    assert.ok(["NOT_CONFIGURED", "SOURCE_UNAVAILABLE", "NO_MESSAGE", "DECIDED"].includes(outcome));
  }
});

// ===========================================================================
// C. NO AWS MUTATION — STRUCTURAL PROOF
// ===========================================================================

const BANNED: { pattern: RegExp; why: string }[] = [
  { pattern: /PurgeQueueCommand/, why: "must never purge a queue" },
  { pattern: /StartMessageMoveTask/, why: "must never call the real AWS redrive API" },
  { pattern: /SetQueueAttributes|CreateQueueCommand|DeleteQueueCommand/, why: "must never mutate queue configuration" },
  { pattern: /submitAttempt\s*\(/, why: "must never submit a provider" },
  { pattern: /executeGeneration\s*\(/, why: "must never execute a generation" },
  { pattern: /claimAttemptForSubmission|markAttemptSubmitting|markAttemptTerminal|recordProviderJob/, why: "must never mutate an attempt" },
  { pattern: /reserveCredits|settleReservation|releaseReservation|cost_amount|credit_ledger|credit_wallets/, why: "must never touch money" },
  { pattern: /finalizeMedia|markCompleted/, why: "must never finalize a generation" },
  { pattern: /\.insert\s*\(|\.update\s*\(|\.upsert\s*\(|\.delete\s*\(/, why: "must never write to the database" },
];

// Phase 16-B added the package's one legitimate redrive executor
// (adapters/sqs-dlq-redrive-executor.ts) — it genuinely sends, deletes, and
// changes the visibility of exactly one message it just received itself.
// These three commands stay banned in every OTHER file this phase-15d3
// batch's own read-only investigation surface touches; `StartMessageMoveTask`
// (queue-wide, unbounded) stays banned everywhere including that file.
const MUTATING_MESSAGE_COMMANDS: { pattern: RegExp; why: string }[] = [
  { pattern: /DeleteMessageCommand/, why: "must never delete a DLQ message" },
  { pattern: /SendMessageCommand/, why: "must never send/redrive a message" },
  { pattern: /ChangeMessageVisibility/, why: "must never take exclusive ownership of a message" },
];

test("11-19: no AWS mutation, no provider execution, no billing mutation, no state mutation anywhere in the new files", () => {
  for (const { file, text } of allCode) {
    for (const banned of BANNED) {
      assert.doesNotMatch(text, banned.pattern, `${file}: ${banned.why}`);
    }
    if (file.endsWith("adapters/sqs-dlq-redrive-executor.ts")) continue;
    for (const banned of MUTATING_MESSAGE_COMMANDS) {
      assert.doesNotMatch(text, banned.pattern, `${file}: ${banned.why}`);
    }
  }
});

test("20: no HTTP route reaches the investigation path except the one Phase 16-B admin route built for exactly that", () => {
  // At Phase 15-D/3 time no HTTP route existed for this at all — the
  // assertion was "none." Phase 16-B intentionally adds exactly one:
  // /api/admin/dlq, authenticated, admin-only, read-only (see its own test
  // file, phase-16b-dlq-redrive.e2e.test.ts, for its auth/read-only
  // proof). Every OTHER route, admin or not, must still never reach this
  // path directly — the admin service (`dlq-admin-service.ts`) is the one
  // permitted caller.
  const apiDir = path.join(ROOT, "src", "app", "api");
  const apiFiles = readdirSync(apiDir, { recursive: true } as never) as string[];
  const allowed = path.join("admin", "dlq", "route.ts");
  for (const rel of apiFiles) {
    if (!rel.toString().endsWith(".ts")) continue;
    if (rel.toString().endsWith(allowed)) continue;
    const text = read(path.join("src", "app", "api", rel.toString()));
    assert.doesNotMatch(text, /dlq-investigate|dlq-investigation-service|sqs-dlq-message-source/, `src/app/api/${rel} must not reach the DLQ investigation path`);
  }
});

test("22: no scheduler, cron, or polling loop exists in the new files", () => {
  for (const { file, text } of allCode) {
    assert.doesNotMatch(text, /setInterval|schedules\.task|cron|while\s*\(\s*true\s*\)|while\s*\(\s*!\s*shuttingDown/, `${file} must not schedule or loop`);
  }
});

test("23: the script never logs a raw AWS response object or the raw message body", () => {
  assert.doesNotMatch(scriptCode.text, /console\.(log|error)\([^)]*response\b/, "must not log a raw AWS response");
  assert.doesNotMatch(scriptCode.text, /console\.(log|error)\([^)]*\bmessage\.body\b/i, "must not log the raw message body");
  assert.doesNotMatch(scriptCode.text, /message\.body/i);
});

test("24: no sensitive field name appears anywhere in the new files", () => {
  const forbidden = ["prompt", "negative_prompt", "input_url", "output_url", "apiKey", "signedUrl", "authorization", "messageattributes"];
  for (const { file, text } of allCode) {
    for (const word of forbidden) {
      assert.doesNotMatch(text.toLowerCase(), new RegExp(word.toLowerCase()), `${file} mentions forbidden field "${word}"`);
    }
  }
});

// ===========================================================================
// D. PHASE 15-D/1 ENGINE REUSED, NOT RE-IMPLEMENTED
// ===========================================================================

test("25: the investigation service imports the existing decision engine rather than reimplementing it", () => {
  const serviceText = read(path.join("src", "lib", "aws", "dlq-redrive", "dlq-investigation-service.ts"));
  assert.match(serviceText, /import\s*\{\s*evaluateDlqRedriveDecision\s*\}\s*from\s*"\.\/dlq-redrive-decision-engine"/);
  // And the service itself decides nothing about SAFE_TO_REDRIVE/REFUSE_*/UNAVAILABLE —
  // those literals must not appear anywhere outside the one import + pass-through.
  assert.doesNotMatch(stripComments(serviceText), /"SAFE_TO_REDRIVE"|"REFUSE_/);
});

test("the script itself never imports the decision engine directly, only through the service", () => {
  assert.doesNotMatch(scriptCode.text, /dlq-redrive-decision-engine/);
});
