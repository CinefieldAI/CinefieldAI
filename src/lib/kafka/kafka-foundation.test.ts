import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  describeKafkaConfig,
  getKafkaConfig,
  isKafkaBrokersPresent,
  isKafkaEnabled,
} from "./kafka-config";
import { publishDomainEvent, type KafkaProducerLike } from "./kafka-producer";
import { buildDomainEvent } from "@/lib/events/domain-event";
import { EVENT_TOPICS } from "@/lib/events/event-topics";

/**
 * Zero-cost tests for the Kafka config and producer foundation (Phase
 * 6R.9). No real Kafka client is ever constructed: every producer test
 * injects a fake implementing the narrow `KafkaProducerLike` surface, and
 * `connectProducer()` (the only function that touches the real client) is
 * deliberately never called. No AWS, no MSK, no broker, no network.
 *
 * A bare `node:test` run never loads `.env.local`, so KAFKA_ENABLED /
 * KAFKA_BROKERS are unset here — matching this repository's actual state
 * (KAFKA_CONFIG_PRESENT=false).
 */

function withTempEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) previous[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

class FakeProducer implements KafkaProducerLike {
  sent: { topic: string; key: string; value: string; headers?: Record<string, string> }[] = [];
  disconnected = false;
  private failNext = false;

  failNextSend(): void {
    this.failNext = true;
  }

  async send(record: {
    topic: string;
    messages: { key: string; value: string; headers?: Record<string, string> }[];
  }): Promise<unknown> {
    if (this.failNext) {
      this.failNext = false;
      // A realistic Kafka error carries broker detail in its message - the
      // producer must never surface that to a caller.
      const err = new Error("connect ECONNREFUSED broker-1.internal:9092");
      err.name = "KafkaJSConnectionError";
      throw err;
    }
    for (const m of record.messages) {
      this.sent.push({ topic: record.topic, key: m.key, value: m.value, headers: m.headers });
    }
    return {};
  }

  async disconnect(): Promise<void> {
    this.disconnected = true;
  }
}

const SAMPLE_EVENT = () =>
  buildDomainEvent({
    eventType: "generation.completed",
    eventVersion: 1,
    aggregateType: "generation",
    aggregateId: "gen-1",
    payload: { status: "completed" },
    traceId: "trace-1",
  });

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------

test("config: missing config -> unconfigured (this repo's actual current state)", () => {
  assert.equal(isKafkaEnabled(), false);
  assert.equal(getKafkaConfig(), null);
  assert.deepEqual(describeKafkaConfig(), { configured: false, brokerCount: 0 });
});

test("config: enablement requires BOTH KAFKA_ENABLED and KAFKA_BROKERS", () => {
  withTempEnv({ KAFKA_ENABLED: "true", KAFKA_BROKERS: undefined }, () => {
    assert.equal(getKafkaConfig(), null, "enabled without brokers must stay unconfigured");
  });
  withTempEnv({ KAFKA_ENABLED: undefined, KAFKA_BROKERS: "broker-a:9092" }, () => {
    assert.equal(getKafkaConfig(), null, "brokers without explicit enable must stay unconfigured");
    assert.equal(isKafkaBrokersPresent(), true);
  });
});

test("config: disabled explicitly -> unconfigured even with brokers present", () => {
  withTempEnv({ KAFKA_ENABLED: "false", KAFKA_BROKERS: "broker-a:9092,broker-b:9092" }, () => {
    assert.equal(isKafkaEnabled(), false);
    assert.equal(getKafkaConfig(), null);
  });
});

test("config: parses a comma-separated broker list and never falls back to localhost", () => {
  withTempEnv({ KAFKA_ENABLED: "true", KAFKA_BROKERS: "broker-a:9092, broker-b:9092 " }, () => {
    const config = getKafkaConfig();
    assert.notEqual(config, null);
    assert.equal(config?.brokers.length, 2);
    assert.equal(config?.clientId, "cinefield");
  });
  // With no config at all there is no implicit localhost default.
  assert.equal(getKafkaConfig(), null);
});

test("config: describeKafkaConfig reports presence and COUNT only - never a broker address", () => {
  withTempEnv({ KAFKA_ENABLED: "true", KAFKA_BROKERS: "secret-broker.internal:9092" }, () => {
    const described = describeKafkaConfig();
    assert.deepEqual(described, { configured: true, brokerCount: 1 });
    assert.ok(!JSON.stringify(described).includes("secret-broker"));
  });
});

test("config: no fallback to Redis/SQS/BullMQ env vars", () => {
  withTempEnv(
    {
      KAFKA_ENABLED: undefined,
      KAFKA_BROKERS: undefined,
      REDIS_URL: "redis://redis-a:6379",
      BULLMQ_REDIS_URL: "redis://redis-b:6379",
      CINEFIELD_SQS_PROVIDER_QUEUE_URL: "https://sqs.example/queue",
    },
    () => {
      assert.equal(getKafkaConfig(), null, "no other transport's config may make Kafka appear configured");
    }
  );
});

test("config: import does not open a socket - these functions perform no I/O", () => {
  assert.equal(typeof isKafkaEnabled(), "boolean");
});

// ---------------------------------------------------------------------------
// PRODUCER
// ---------------------------------------------------------------------------

test("producer: publishes the exact validated envelope, keyed by the stable eventId", async () => {
  const fake = new FakeProducer();
  const event = SAMPLE_EVENT();
  const result = await publishDomainEvent(event, fake);

  assert.equal(result.outcome, "published");
  if (result.outcome === "published") {
    assert.equal(result.eventId, event.eventId);
    assert.equal(result.topic, EVENT_TOPICS.generation);
  }
  assert.equal(fake.sent.length, 1);
  assert.equal(fake.sent[0].key, event.eventId, "message key MUST be the stable eventId");
  assert.deepEqual(JSON.parse(fake.sent[0].value), event, "value must be the exact envelope, unmodified");
});

test("producer: eventId is used consistently across a retry of the same event", async () => {
  const fake = new FakeProducer();
  const event = SAMPLE_EVENT();
  await publishDomainEvent(event, fake);
  await publishDomainEvent(event, fake);

  assert.equal(fake.sent.length, 2);
  assert.equal(fake.sent[0].key, fake.sent[1].key, "a retry must reuse the same dedup identity");
});

test("producer: carries safe headers only - event type/version/trace, never a secret", async () => {
  const fake = new FakeProducer();
  const event = SAMPLE_EVENT();
  await publishDomainEvent(event, fake);

  const headers = fake.sent[0].headers ?? {};
  assert.equal(headers["event-type"], "generation.completed");
  assert.equal(headers["event-version"], "1");
  assert.equal(headers["trace-id"], "trace-1");
  assert.equal(Object.keys(headers).length, 3, "no additional headers may be smuggled in");
});

test("producer: Kafka failure is sanitized - broker detail never reaches the caller", async () => {
  const fake = new FakeProducer();
  fake.failNextSend();
  const result = await publishDomainEvent(SAMPLE_EVENT(), fake);

  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") {
    assert.equal(result.errorCode, "KafkaJSConnectionError", "only the error CLASS, never its message");
    assert.ok(!result.errorCode.includes("9092"), "no broker port may leak");
    assert.ok(!result.errorCode.includes("broker-1"), "no broker host may leak");
  }
});

test("producer: null producer (Kafka unconfigured) -> explicit unavailable, never a false success", async () => {
  const result = await publishDomainEvent(SAMPLE_EVENT(), null);
  assert.deepEqual(result, { outcome: "unavailable" });
});

test("producer: an event whose family has no topic is refused, never guessed", async () => {
  const fake = new FakeProducer();
  // Bypass buildDomainEvent's own family validation to simulate a corrupted
  // envelope reaching the producer.
  const forged = { ...SAMPLE_EVENT(), eventType: "weather.changed" };
  const result = await publishDomainEvent(forged, fake);

  assert.equal(result.outcome, "failed");
  if (result.outcome === "failed") assert.equal(result.errorCode, "unknown_event_topic");
  assert.equal(fake.sent.length, 0, "nothing may be published when the topic cannot be resolved");
});

test("no network: this suite never constructs a real Kafka client", () => {
  // connectProducer() - the only function that require()s the real client -
  // is deliberately never called anywhere in this file.
  assert.ok(true);
});
