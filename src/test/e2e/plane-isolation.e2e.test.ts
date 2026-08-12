import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { BULLMQ_QUEUE_NAMES } from "@/lib/bullmq/queue-names";
import {
  checkRedisRoleIsolation,
  describeRedisHardening,
  describeRedisSecurity,
  isBullmqConnectionSafe,
  redisConnectionFingerprint,
} from "@/lib/redis/redis-isolation";

/**
 * PLANE ISOLATION (Phase 6R-D, 6R-F, 6R.25).
 *
 * v1.6 gives four planes four jobs, and the whole point is that none of them
 * can quietly take on another's:
 *
 *   Temporal    generation lifecycle — the only owner
 *   SQS + DLQ   critical generation/provider commands
 *   BullMQ + Redis B  short auxiliary background work, and nothing else
 *   Trigger.dev cron, health, reconciliation, cleanup, audit, cost
 *   Redis A     application transient state, never queue state
 *
 * Most of these tests are structural on purpose. A runtime test shows a path
 * was not taken this time; an import-graph test shows the capability is
 * absent, and fails the day someone adds it.
 */

const readSource = (relative: string) =>
  readFileSync(join(process.cwd(), relative), "utf8").replace(/\r\n/g, "\n");

const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

const BULLMQ_FILES = walk(join(process.cwd(), "src/lib/bullmq"));

/** Env keys these tests manipulate; restored by every test that touches them. */
function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) saved[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// ===========================================================================
// 6R-D — BULLMQ IS AUXILIARY ONLY
// ===========================================================================

test("D1/D3: no BullMQ module can reach provider submission, finalization, credits, or Temporal", () => {
  const FORBIDDEN = [
    // Generation ownership.
    "executeGeneration",
    "submitAttempt",
    "claimAttemptForSubmission",
    "handleProviderCommand",
    "checkAsyncGeneration",
    // Finalization.
    "markCompleted",
    "markFailed",
    "markCancelled",
    "complete_generation_tx",
    "fail_generation_tx",
    "cancel_generation_tx",
    // Provider access.
    "provider-adapter",
    "provider-registry",
    "ProviderAdapter",
    // Temporal.
    "startGenerationWorkflow",
    "getTemporalClient",
    "generationWorkflow",
    // Credits.
    "reserveCredits",
    "settleGeneration",
    "refundGeneration",
    "reserve_credits",
    "settle_reservation",
    "refund_reservation",
    // The critical command plane.
    "getCommandBus",
    "SqsCommandBus",
  ];

  for (const file of BULLMQ_FILES) {
    const code = strip(readFileSync(file, "utf8"));
    for (const forbidden of FORBIDDEN) {
      assert.ok(
        !code.includes(forbidden),
        `${file} references ${forbidden} — BullMQ is auxiliary work only, never a lifecycle owner`
      );
    }
  }
});

test("D3: nothing on the critical path imports BullMQ either - the dependency runs neither way", () => {
  const CRITICAL = [
    ...walk(join(process.cwd(), "worker")),
    ...walk(join(process.cwd(), "src/lib/orchestration")),
    ...walk(join(process.cwd(), "src/lib/temporal")),
    ...walk(join(process.cwd(), "src/lib/aws")),
  ];

  for (const file of CRITICAL) {
    const code = strip(readFileSync(file, "utf8"));
    assert.ok(
      !/from\s+["'][^"']*bullmq[^"']*["']|require\(["'][^"']*bullmq/.test(code),
      `${file} imports BullMQ — the critical generation path must not depend on the auxiliary plane`
    );
  }
});

test("D2: the declared queue families are auxiliary, and none is generation-shaped", () => {
  const names = Object.values(BULLMQ_QUEUE_NAMES);
  assert.deepEqual(
    [...names].sort(),
    ["cache-refresh", "media-short", "notifications", "webhook-retry"],
    "the queue set is the auxiliary families v1.6 permits"
  );

  for (const name of names) {
    assert.ok(
      !/generation|provider|credit|billing|submit|finalize/i.test(name),
      `${name} names critical work — BullMQ may not own it`
    );
  }
});

test("D2: job payloads carry references, never blobs or secrets", async () => {
  const { buildJobRef } = await import("@/lib/bullmq/job-contracts");
  const ref = buildJobRef("generation", "11111111-1111-4111-8111-111111111111");

  assert.deepEqual(
    Object.keys(ref).sort(),
    ["enqueuedAt", "referenceId", "referenceType"],
    "a job reference is two identifiers plus an enqueue timestamp — no payload"
  );

  const contracts = strip(readSource("src/lib/bullmq/job-contracts.ts"));
  for (const forbidden of ["prompt", "apiKey", "token", "secret", "password", "bytes", "base64", "signedUrl"]) {
    assert.ok(
      !new RegExp(`\\b${forbidden}\\b`, "i").test(contracts),
      `job contracts must not carry ${forbidden}`
    );
  }
});

test("D4/D6: with Redis B absent, BullMQ is unconfigured and NEVER borrows Redis A", async () => {
  const { getBullmqRedisConfig, describeBullmqRedisConfig } = await import("@/lib/bullmq/bullmq-config");

  withEnv(
    {
      BULLMQ_REDIS_ENABLED: undefined,
      BULLMQ_REDIS_URL: undefined,
      REDIS_ENABLED: "true",
      REDIS_URL: "rediss://user:pw@app-redis.example:6379",
    },
    () => {
      assert.equal(getBullmqRedisConfig(), null, "no Redis B means no BullMQ connection");
      assert.equal(describeBullmqRedisConfig().configured, false);
    }
  );

  // And structurally: no BullMQ module may even read Redis A's variable.
  for (const file of BULLMQ_FILES) {
    const code = strip(readFileSync(file, "utf8"));
    assert.ok(
      !/process\.env\.REDIS_URL|["']REDIS_URL["']/.test(code),
      `${file} reads REDIS_URL — Redis A is not a BullMQ fallback`
    );
    assert.ok(
      !/getRedisConfig|getRedisClient/.test(code),
      `${file} reaches Redis A's client — the two roles must stay separate`
    );
  }
});

test("D4: a BullMQ failure cannot change generation lifecycle state", () => {
  // Structural, because it is the honest form of the claim: no BullMQ module
  // holds a reference to anything that can write a generation's status, so
  // no failure mode inside one can produce that write.
  for (const file of BULLMQ_FILES) {
    const code = strip(readFileSync(file, "utf8"));
    assert.ok(
      !/from\(["'`]generations["'`]\)|from\(["'`]generation_attempts["'`]\)/.test(code),
      `${file} touches a lifecycle table`
    );
    assert.ok(!/getSupabaseAdminClient/.test(code), `${file} holds a privileged DB client`);
  }
});

test("D5: auxiliary retries are job-local and bounded, with no exactly-once claim", async () => {
  const { BULLMQ_DEFAULT_JOB_OPTIONS } = await import("@/lib/bullmq/bullmq-job-defaults");

  assert.ok(
    typeof BULLMQ_DEFAULT_JOB_OPTIONS.attempts === "number" && BULLMQ_DEFAULT_JOB_OPTIONS.attempts >= 1,
    "retries are bounded"
  );
  assert.ok(BULLMQ_DEFAULT_JOB_OPTIONS.backoff, "and backed off rather than hot-looping");

  // The module must state the limitation rather than merely avoid the phrase:
  // a reader needs to know BullMQ is at-least-once, not be left to assume.
  const defaults = readSource("src/lib/bullmq/bullmq-job-defaults.ts");
  assert.ok(
    /does NOT provide exactly-once/i.test(defaults),
    "the at-least-once reality must be stated explicitly"
  );
});

// ===========================================================================
// 6R-F — TRIGGER.DEV IS OPERATIONAL ONLY
// ===========================================================================

test("F1: no Trigger task is a generation owner, provider executor, or finalizer", () => {
  const operationalDir = join(process.cwd(), "src/trigger/operational");
  const files = readdirSync(operationalDir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => join(operationalDir, f));

  const FORBIDDEN = [
    "executeGeneration",
    "submitAttempt",
    "startGenerationWorkflow",
    "getTemporalClient",
    "handleProviderCommand",
    "markCompleted",
    "markFailed",
    "complete_generation_tx",
    "fail_generation_tx",
    "bridgeVerifiedWebhookToTemporal",
    "reserve_credits",
    "settle_reservation",
    "refund_reservation",
  ];

  for (const file of files) {
    const code = strip(readFileSync(file, "utf8"));
    for (const forbidden of FORBIDDEN) {
      assert.ok(!code.includes(forbidden), `${file} references ${forbidden}`);
    }
  }
});

test("F3: reconciliation detects and reports - it never blindly resubmits", async () => {
  const services = strip(readSource("src/trigger/operational/operational-services.ts"));

  // The one thing reconciliation must never do.
  assert.ok(!/submitAttempt|executeGeneration|adapter\.submit/.test(services), "no resubmission path");
  // And it must not write lifecycle state either.
  assert.ok(!/\.update\(|\.insert\(|\.delete\(|\.upsert\(/.test(services), "detection only, no writes");

  // Ambiguous evidence is surfaced, not resolved.
  assert.ok(/ambiguous/i.test(services), "ambiguous submissions are reported for reconciliation");
});

test("F4/F5/F6: cleanup deletes nothing, restore is honest, costs are not invented", () => {
  const services = strip(readSource("src/trigger/operational/operational-services.ts"));

  // F4 — planning only.
  assert.ok(
    !/storage[\s\S]{0,60}\.remove\(|\.delete\(\)/.test(services),
    "cleanup must detect candidates, never delete an object"
  );

  // F5 — no faked restore.
  assert.ok(
    /unavailable/i.test(services),
    "restore verification reports unavailable rather than claiming a green check"
  );

  // F6 — no invented prices.
  assert.ok(
    !/creditPricePerUnit\s*[:=]\s*[0-9]|providerUnitCost\s*[:=]\s*[0-9]/.test(services),
    "no provider price is hardcoded"
  );
  assert.ok(/unpriced/i.test(services), "unpriced models are reported as unpriced");
});

test("F7: the retired Trigger generation tasks still cannot run in production", () => {
  for (const file of ["src/trigger/generation-task.ts", "src/trigger/async-continuation-task.ts"]) {
    const code = strip(readSource(file));
    assert.ok(/NODE_ENV === "production"/.test(code), `${file} must refuse in production`);
    assert.ok(/AbortTaskRunError/.test(code), `${file} must abort without retry`);
  }

  // And nothing dispatches them.
  const CALLERS = [
    ...walk(join(process.cwd(), "src/app")),
    ...walk(join(process.cwd(), "src/lib")),
    ...walk(join(process.cwd(), "worker")),
  ];
  for (const file of CALLERS) {
    const code = strip(readFileSync(file, "utf8"));
    assert.ok(
      !/generationTask\s*\.\s*trigger\s*\(|asyncContinuationTask\s*\.\s*trigger\s*\(/.test(code),
      `${file} dispatches a retired generation task`
    );
  }
});

// ===========================================================================
// 6R.25 — REDIS HARDENING
// ===========================================================================

test("R3: two roles pointing at ONE instance is detected, whatever the credentials", () => {
  // Same host and port, different password and different scheme: still one
  // instance, and the fingerprint must say so.
  withEnv(
    {
      REDIS_ENABLED: "true",
      REDIS_URL: "rediss://default:pw-one@shared.example.com:6379",
      BULLMQ_REDIS_ENABLED: "true",
      BULLMQ_REDIS_URL: "redis://default:pw-two@shared.example.com:6379",
    },
    () => {
      assert.deepEqual(checkRedisRoleIsolation(), { verdict: "shared_instance" });
      assert.equal(isBullmqConnectionSafe(), false);
    }
  );

  // Genuinely different instances.
  withEnv(
    {
      REDIS_URL: "rediss://default:pw@app.example.com:6379",
      BULLMQ_REDIS_URL: "rediss://default:pw@queue.example.com:6379",
    },
    () => {
      assert.deepEqual(checkRedisRoleIsolation(), { verdict: "isolated" });
      assert.equal(isBullmqConnectionSafe(), true);
    }
  );

  // The implicit default port must not read as a different instance.
  assert.equal(
    redisConnectionFingerprint("redis://h.example.com"),
    redisConnectionFingerprint("redis://h.example.com:6379")
  );
});

test("R3: a shared instance makes BullMQ report UNCONFIGURED rather than borrow Redis A", async () => {
  const { getBullmqRedisConfig, describeBullmqRedisConfig } = await import("@/lib/bullmq/bullmq-config");

  await withEnv(
    {
      REDIS_ENABLED: "true",
      REDIS_URL: "rediss://default:pw@shared.example.com:6379",
      BULLMQ_REDIS_ENABLED: "true",
      BULLMQ_REDIS_URL: "rediss://default:pw@shared.example.com:6379",
    },
    async () => {
      assert.equal(
        getBullmqRedisConfig(),
        null,
        "a misconfigured deployment runs no background jobs instead of poisoning Redis A"
      );
      const described = describeBullmqRedisConfig();
      assert.equal(described.configured, false);
      assert.equal(described.isolatedFromApplicationRedis, false);
    }
  );
});

test("R3: an unparseable URL reports unverifiable, never a false pass", () => {
  withEnv({ REDIS_URL: "not a url", BULLMQ_REDIS_URL: "rediss://q.example.com:6379" }, () => {
    const verdict = checkRedisRoleIsolation();
    assert.equal(verdict.verdict, "unverifiable");
    assert.equal(
      isBullmqConnectionSafe(),
      false,
      "a check that did not run is not a check that passed"
    );
  });
});

test("R1/R2: the security description reports TLS and auth as booleans, never a URL", () => {
  withEnv(
    {
      REDIS_URL: "rediss://default:super-secret-password@app.example.com:6379",
      BULLMQ_REDIS_URL: "redis://queue.example.com:6379",
    },
    () => {
      const security = describeRedisSecurity();

      assert.deepEqual(security.application, {
        configured: true,
        tls: true,
        authenticated: true,
        instance: redisConnectionFingerprint("rediss://app.example.com:6379"),
      });
      assert.equal(security.bullmq.tls, false, "redis:// is not TLS and must not be reported as such");
      assert.equal(security.bullmq.authenticated, false);

      // Nothing recoverable about the URL escapes.
      const serialized = JSON.stringify(security);
      for (const leak of ["super-secret-password", "app.example.com", "rediss://", "queue.example.com"]) {
        assert.ok(!serialized.includes(leak), `the description leaked ${leak}`);
      }
    }
  );
});

test("R5: code never claims live network isolation", () => {
  const hardening = describeRedisHardening();
  assert.equal(
    hardening.networkIsolationVerified,
    false,
    "code can see a URL scheme; it cannot see a firewall rule"
  );

  const source = readSource("src/lib/redis/redis-isolation.ts");
  assert.ok(
    /cannot see a firewall rule|control-plane verification/.test(source),
    "the limitation must be stated in the module, not only in a report"
  );
});

test("R4: distributed locks require an owner token to release", async () => {
  const lock = strip(readSource("src/lib/redis/distributed-lock.ts"));

  // Acquire is SET NX with a token; release is a compare-and-delete script.
  assert.ok(/NX/.test(lock), "acquisition is atomic SET NX");
  assert.ok(/ownerToken/.test(lock), "an owner token exists");
  // Release must be a compare-and-delete: the DEL is legal, but only when it
  // sits behind an ownership comparison inside one atomic script.
  const script = lock.match(/COMPARE_AND_DELETE_SCRIPT = `([\s\S]*?)`/)?.[1];
  assert.ok(script, "the release script was located");
  assert.ok(/redis\.call\('GET', KEYS\[1\]\)/.test(script!), "it reads the current owner");
  assert.ok(/current ~= ARGV\[1\]/.test(script!), "and compares it to the caller's token");
  assert.ok(
    script!.indexOf("ARGV[1]") < script!.indexOf("DEL"),
    "the ownership check must precede the delete — a stale owner must not remove a live lock"
  );

  // And no DEL of a lock key exists anywhere outside that script.
  const outsideScript = lock.replace(/COMPARE_AND_DELETE_SCRIPT = `[\s\S]*?`/, "");
  assert.ok(
    !/DEL/i.test(outsideScript.replace(/COMPARE_AND_DELETE\w*/g, "")),
    "no unconditional DEL of a lock key outside the compare-and-delete script"
  );
  assert.ok(/EX|expire|ttl/i.test(lock), "locks are TTL-bounded so a dead owner cannot hold forever");
});

test("R1: Redis A holds no queue state and no durable truth", () => {
  for (const file of walk(join(process.cwd(), "src/lib/redis"))) {
    const code = strip(readFileSync(file, "utf8"));
    assert.ok(!/bullmq/i.test(code) || file.endsWith("redis-isolation.ts"),
      `${file}: Redis A modules must not know about BullMQ (the isolation guard is the one exception)`);
    assert.ok(
      !/\b(?:client|redis)\s*\.\s*(?:keys|scan|flushdb|flushall)\s*\(/i.test(code),
      `${file}: Redis A must never be enumerated or flushed`
    );
  }
});

// ===========================================================================
// GATE 0 REGRESSION — all three terminal transitions are transactional
// ===========================================================================

test("GATE0: every generation terminal transition commits its event in one transaction", () => {
  const statusManager = readSource("src/lib/orchestration/status-manager.ts");

  for (const [fn, rpc] of [
    ["markCompleted", "complete_generation_tx"],
    ["markFailed", "fail_generation_tx"],
    ["markCancelled", "cancel_generation_tx"],
  ] as const) {
    const body = statusManager.match(new RegExp(`export async function ${fn}[\\s\\S]*?\\n}\\n`))?.[0];
    assert.ok(body, `${fn} was located`);
    assert.ok(body!.includes(`admin.rpc("${rpc}"`), `${fn} must call ${rpc}`);
    assert.ok(
      !/\.from\(["'`]generations["'`]\)/.test(body!),
      `${fn} must not also perform its own PostgREST write — that would be a second transaction`
    );
  }
});

test("GATE0: the storage upload stays OUTSIDE the finalization transaction", () => {
  const orchestrator = strip(readSource("src/lib/orchestration/orchestrator.ts"));
  const tail = orchestrator.match(/async function collectAndFinalize[\s\S]*?\n}\n/)![0];

  const uploadAt = tail.indexOf("uploadOutputs(");
  const completeAt = tail.indexOf("markCompleted(");
  assert.ok(uploadAt >= 0 && completeAt >= 0, "both steps are in the tail");
  assert.ok(
    uploadAt < completeAt,
    "the upload must finish before the transaction opens — holding a DB transaction across an object-store transfer pins a connection for a network round trip"
  );

  // And the SQL functions perform no external I/O of their own.
  const migration = readSource("supabase/migrations/20260814000000_finalization_outbox.sql");
  assert.ok(!/http|pg_net|dblink|COPY .* TO PROGRAM/i.test(migration), "no external I/O inside the transaction");
});
