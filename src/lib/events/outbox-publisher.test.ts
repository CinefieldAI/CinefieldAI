import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildDomainEvent } from "./domain-event";
import { drainOutboxOnce, type OutboxPublisherRepository } from "./outbox-publisher";
import type { ClaimedOutboxEvent } from "./outbox-repository";
import type { KafkaProducerLike } from "@/lib/kafka/kafka-producer";

/**
 * Zero-cost tests for the outbox publisher (Phase 6R.9).
 *
 * Both dependencies are injected as in-memory fakes — the repository via
 * the publisher's own `testRepositoryOverride` seam, and Kafka via the
 * narrow `KafkaProducerLike` surface. No Supabase connection, no Kafka
 * client, no network. This proves the publisher's ORCHESTRATION logic:
 * claim, publish, resolve, and above all what happens when Kafka is down.
 *
 * The database-level guarantees themselves (same-transaction outbox insert,
 * FOR UPDATE SKIP LOCKED claim exclusivity) are SQL behavior that mocks
 * cannot prove — see the SQL proof functions in
 * supabase/migrations/20260812130000_outbox_events.sql and this phase's
 * explicitly reported limitation.
 */

// Payloads satisfy the Phase 6R.15 schema registry: since that phase the
// producer validates every event before sending, so a fixture that does not
// match its registered contract would be refused at the gate rather than
// exercising the outbox behaviour these tests are about.
const GEN_A = "11111111-1111-4111-8111-111111111111";
const RES_B = "22222222-2222-4222-8222-222222222222";

const EVENT_A = buildDomainEvent({
  eventType: "generation.completed",
  eventVersion: 1,
  aggregateType: "generation",
  aggregateId: "gen-a",
  payload: { generationId: GEN_A, provider: "mock", attemptNo: 1 },
});

const EVENT_B = buildDomainEvent({
  eventType: "credit.reserved",
  eventVersion: 1,
  aggregateType: "credit_reservation",
  aggregateId: "res-b",
  payload: { reservationId: RES_B, amount: 10 },
});

class FakeProducer implements KafkaProducerLike {
  sent: string[] = [];
  private failNext = false;

  failNextSend(): void {
    this.failNext = true;
  }

  async send(record: { topic: string; messages: { key: string; value: string }[] }): Promise<unknown> {
    if (this.failNext) {
      this.failNext = false;
      const err = new Error("connect ECONNREFUSED broker:9092");
      err.name = "KafkaJSConnectionError";
      throw err;
    }
    for (const m of record.messages) this.sent.push(m.key);
    return {};
  }

  async disconnect(): Promise<void> {}
}

/** In-memory outbox standing in for the Supabase-backed repository. */
class FakeRepository implements OutboxPublisherRepository {
  published = new Set<string>();
  failedBack = new Map<string, string | undefined>();
  claimCalls = 0;
  private pending: ClaimedOutboxEvent[];

  constructor(events: { event: typeof EVENT_A; claimToken: string }[]) {
    this.pending = events.map((e) => ({ event: e.event, publishAttempts: 1, claimToken: e.claimToken }));
  }

  async claimPendingEvents() {
    this.claimCalls += 1;
    // A second pass sees nothing new — proves the publisher does not loop.
    if (this.claimCalls > 1) return { outcome: "claimed" as const, events: [] };
    return { outcome: "claimed" as const, events: this.pending };
  }

  async markPublished(eventId: string) {
    this.published.add(eventId);
    return { outcome: "resolved" as const };
  }

  async markFailed(eventId: string, _claimToken: string, errorCode?: string) {
    this.failedBack.set(eventId, errorCode);
    return { outcome: "resolved" as const };
  }
}

test("drain: publishes each claimed event and marks it published", async () => {
  const repo = new FakeRepository([
    { event: EVENT_A, claimToken: "token-a" },
    { event: EVENT_B, claimToken: "token-b" },
  ]);
  const producer = new FakeProducer();

  const result = await drainOutboxOnce(producer, 100, repo);

  assert.equal(result.claimed, 2);
  assert.equal(result.published, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.kafkaUnavailable, false);
  assert.ok(repo.published.has(EVENT_A.eventId));
  assert.ok(repo.published.has(EVENT_B.eventId));
  assert.deepEqual(producer.sent.sort(), [EVENT_A.eventId, EVENT_B.eventId].sort());
});

test("KAFKA UNAVAILABLE: events are NOT published and remain retryable - the whole point of the outbox", async () => {
  const repo = new FakeRepository([{ event: EVENT_A, claimToken: "token-a" }]);

  // null producer == Kafka unconfigured/unavailable
  const result = await drainOutboxOnce(null, 100, repo);

  assert.equal(result.claimed, 1);
  assert.equal(result.published, 0, "nothing may be marked published when Kafka is unavailable");
  assert.equal(result.failed, 1);
  assert.equal(result.kafkaUnavailable, true);
  assert.equal(repo.published.size, 0, "the event must NOT be recorded as published");
  assert.ok(repo.failedBack.has(EVENT_A.eventId), "the event must be returned to pending for retry");
  assert.equal(repo.failedBack.get(EVENT_A.eventId), "kafka_unavailable");
});

test("publish failure: event returned to pending with a sanitized error code, never dropped", async () => {
  const repo = new FakeRepository([{ event: EVENT_A, claimToken: "token-a" }]);
  const producer = new FakeProducer();
  producer.failNextSend();

  const result = await drainOutboxOnce(producer, 100, repo);

  assert.equal(result.published, 0);
  assert.equal(result.failed, 1);
  assert.equal(repo.published.size, 0);
  assert.equal(repo.failedBack.get(EVENT_A.eventId), "KafkaJSConnectionError");
  assert.ok(!String(repo.failedBack.get(EVENT_A.eventId)).includes("9092"), "no broker detail may leak");
});

test("per-event resolution: one failure does not discard the successes in the same batch", async () => {
  const repo = new FakeRepository([
    { event: EVENT_A, claimToken: "token-a" },
    { event: EVENT_B, claimToken: "token-b" },
  ]);
  const producer = new FakeProducer();
  producer.failNextSend(); // only the FIRST send fails

  const result = await drainOutboxOnce(producer, 100, repo);

  assert.equal(result.claimed, 2);
  assert.equal(result.published, 1);
  assert.equal(result.failed, 1);
  assert.equal(repo.published.size, 1, "the successful event stays published");
  assert.equal(repo.failedBack.size, 1, "only the failed event is returned to pending");
});

test("empty outbox: drain is a clean no-op", async () => {
  const repo = new FakeRepository([]);
  const result = await drainOutboxOnce(new FakeProducer(), 100, repo);
  assert.deepEqual(result, { claimed: 0, published: 0, failed: 0, kafkaUnavailable: false });
});

test("no daemon: drainOutboxOnce performs exactly ONE claim pass and returns", async () => {
  const repo = new FakeRepository([{ event: EVENT_A, claimToken: "token-a" }]);
  await drainOutboxOnce(new FakeProducer(), 100, repo);
  assert.equal(repo.claimCalls, 1, "must not loop - scheduling belongs to a caller, not this module");
});

test("stable identity: the eventId sent to Kafka is exactly the one from the outbox row", async () => {
  const repo = new FakeRepository([{ event: EVENT_A, claimToken: "token-a" }]);
  const producer = new FakeProducer();
  await drainOutboxOnce(producer, 100, repo);
  assert.deepEqual(producer.sent, [EVENT_A.eventId]);
});

test("a retried event keeps the same eventId - duplicate delivery stays deduplicable", async () => {
  const producer = new FakeProducer();

  // First pass fails, event returns to pending.
  const firstRepo = new FakeRepository([{ event: EVENT_A, claimToken: "token-a" }]);
  producer.failNextSend();
  await drainOutboxOnce(producer, 100, firstRepo);
  assert.equal(firstRepo.published.size, 0);

  // Second pass (a later drain) reclaims the SAME event and succeeds.
  const secondRepo = new FakeRepository([{ event: EVENT_A, claimToken: "token-a-retry" }]);
  await drainOutboxOnce(producer, 100, secondRepo);

  assert.ok(secondRepo.published.has(EVENT_A.eventId));
  assert.deepEqual(producer.sent, [EVENT_A.eventId], "the retry published the same stable identity");
});
