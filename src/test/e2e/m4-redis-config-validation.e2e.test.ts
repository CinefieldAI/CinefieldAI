import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRedisUrl, getRedisConfig, isRedisEnabled } from "@/lib/redis/redis-config";
import { OrchestrationError } from "@/lib/orchestration/errors";

/**
 * M4 — a malformed REDIS_URL must fail as configuration, not as a crash.
 *
 * The defect these lock down was observed live: REDIS_ENABLED=true with a
 * block of pasted prose in REDIS_URL produced `TypeError: Invalid URL` inside
 * ioredis, three layers below the boundary, and took down every generation
 * request at route resolution.
 */

const ENABLED = process.env.REDIS_ENABLED;
const URL_VALUE = process.env.REDIS_URL;

function withEnv(enabled: string | undefined, url: string | undefined, run: () => void) {
  if (enabled === undefined) delete process.env.REDIS_ENABLED;
  else process.env.REDIS_ENABLED = enabled;
  if (url === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = url;

  try {
    run();
  } finally {
    if (ENABLED === undefined) delete process.env.REDIS_ENABLED;
    else process.env.REDIS_ENABLED = ENABLED;
    if (URL_VALUE === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = URL_VALUE;
  }
}

test("1. a valid redis:// URL is accepted", () => {
  assert.equal(validateRedisUrl("redis://default:pw@example.internal:6379"), null);
});

test("2. a valid rediss:// URL is accepted", () => {
  assert.equal(validateRedisUrl("rediss://default:pw@example.internal:6380"), null);
});

test("3. pasted prose is rejected BEFORE any client is constructed", () => {
  // The exact shape of the live incident.
  assert.equal(validateRedisUrl("CINEFIELD — REDIS .ENV.LOCAL HAZIRLAMA"), "invalid_url");
});

test("3b. a pasted CLI command is rejected", () => {
  // Also seen live: the whole `redis-cli -u redis://…` line.
  assert.equal(validateRedisUrl("redis-cli -u redis://default:pw@host:6379"), "invalid_url");
});

test("4. a missing URL is rejected when Redis is enabled", () => {
  assert.equal(validateRedisUrl(undefined), "missing_url");
  assert.equal(validateRedisUrl(""), "missing_url");
});

test("5. an unsupported scheme is rejected", () => {
  assert.equal(validateRedisUrl("http://example.internal:6379"), "unsupported_scheme");
  assert.equal(validateRedisUrl("postgres://user@host:5432/db"), "unsupported_scheme");
  assert.equal(validateRedisUrl("file:///etc/passwd"), "unsupported_scheme");
});

test("6. explicitly disabled Redis resolves to null, never an error", () => {
  withEnv("false", "anything at all", () => {
    assert.equal(isRedisEnabled(), false);
    assert.equal(getRedisConfig(), null);
  });
  withEnv(undefined, undefined, () => {
    assert.equal(getRedisConfig(), null);
  });
});

test("7. an invalid URL raises a TYPED error, not a raw TypeError", () => {
  withEnv("true", "CINEFIELD — REDIS .ENV.LOCAL HAZIRLAMA", () => {
    let caught: unknown;
    try {
      getRedisConfig();
    } catch (error) {
      caught = error;
    }

    assert.ok(caught instanceof OrchestrationError, "must be an OrchestrationError");
    assert.ok(!(caught instanceof TypeError));
    assert.equal((caught as OrchestrationError).code, "REDIS_CONFIGURATION_INVALID");
  });
});

test("7b. enabled-but-broken is NOT silently reinterpreted as disabled", () => {
  withEnv("true", "not a url", () => {
    // Returning null here would take rate limits, locks and the Phase 7-E
    // runtime routing controls offline while everything looked healthy.
    assert.throws(() => getRedisConfig(), OrchestrationError);
  });
});

test("8. the error carries no credential, host, or URL fragment", () => {
  const secretish = "redis-cli -u redis://default:SuperSecretPassword@my-host.example:17078";
  withEnv("true", secretish, () => {
    try {
      getRedisConfig();
      assert.fail("should have thrown");
    } catch (error) {
      const serialized = JSON.stringify({
        message: (error as OrchestrationError).message,
        body: (error as OrchestrationError).toResponseBody(),
        context: (error as { context?: unknown }).context,
      });

      assert.ok(!serialized.includes("SuperSecretPassword"), "no password");
      assert.ok(!serialized.includes("my-host.example"), "no host");
      assert.ok(!serialized.includes("17078"), "no port");
      assert.ok(!serialized.includes("redis-cli"), "no raw value at all");
      assert.ok(/invalid_url/.test(serialized), "only the non-secret shape");
    }
  });
});

test("8b. the three reasons are the only non-secret vocabulary", () => {
  const reasons = new Set(
    [
      validateRedisUrl(undefined),
      validateRedisUrl("nope"),
      validateRedisUrl("http://h:1"),
    ].filter(Boolean)
  );
  assert.deepEqual([...reasons].sort(), ["invalid_url", "missing_url", "unsupported_scheme"]);
});

test("9. a valid configuration still resolves for the runtime flag source", () => {
  withEnv("true", "redis://default:pw@example.internal:6379", () => {
    const config = getRedisConfig();
    assert.ok(config);
    assert.equal(config?.url, "redis://default:pw@example.internal:6379");
  });
});

test("11. Redis A / Redis B ownership is untouched by this change", async () => {
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const source = readFileSync(
    path.join(process.cwd(), "src/lib/redis/redis-config.ts"),
    "utf8"
  );

  assert.ok(!/BULLMQ_REDIS_URL/.test(source), "Redis A config must not know about Redis B");

  const bullmq = readFileSync(
    path.join(process.cwd(), "src/lib/bullmq/bullmq-config.ts"),
    "utf8"
  );
  assert.ok(/BULLMQ_REDIS_URL/.test(bullmq), "Redis B still reads its own variable");

  // Code, not prose: the header deliberately names REDIS_URL to explain that
  // Redis B is a DIFFERENT variable, so matching comments would fail on the
  // documentation that exists to prevent this very confusion.
  const bullmqCode = bullmq.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    !/process\.env\.REDIS_URL|process\.env\.REDIS_ENABLED/.test(bullmqCode),
    "BullMQ must never read Redis A's variables"
  );
});
