import { randomUUID } from "node:crypto";
import { FakeSupabaseClient } from "./fake-supabase";
import type { CommandBus, CommandEnvelope } from "@/lib/contracts/command-bus";
import { parseCommand, serializeCommand, commandIdFor, type WireCommandType } from "@/lib/contracts/command-wire";

/**
 * Shared harness plumbing for the zero-cost E2E (Phase 6R.12).
 *
 * Fakes ONLY external boundaries — the AWS transport and the
 * Supabase/Storage network. Everything Cinefield decides is real code.
 */

// ---------------------------------------------------------------------------
// SQS transport double
// ---------------------------------------------------------------------------

/**
 * In-memory stand-in for AWS SQS that preserves the REAL wire contract.
 *
 * It does not reimplement any Cinefield logic. It serializes the envelope
 * with production's own `serializeCommand`, stores the resulting string,
 * and hands it back to the provider worker to be parsed by production's own
 * `parseCommand`. So the message shape, the deterministic commandId, and the
 * FIFO dedup identity are all exercised for real — only the network is fake.
 *
 * FIFO deduplication is modelled the way SQS actually behaves: a message
 * whose MessageDeduplicationId was already accepted inside the dedup window
 * is silently dropped by the transport. `deliverDuplicate()` exists to
 * bypass that and simulate the case SQS explicitly does NOT protect
 * against — at-least-once redelivery of an already-accepted message.
 */
export class FakeSqsTransport implements CommandBus {
  /** Raw serialized message bodies, exactly as production would send them. */
  messages: { body: string; messageGroupId: string; deduplicationId: string }[] = [];
  /** Dedup ids the transport has already accepted (SQS FIFO dedup window). */
  private acceptedDedupIds = new Set<string>();
  enqueueCount = 0;
  dedupDroppedCount = 0;

  async enqueue(envelope: CommandEnvelope): Promise<void> {
    this.enqueueCount += 1;

    const type = envelope.command.type as WireCommandType;
    const body = serializeCommand({
      commandId: commandIdFor(type, envelope.command.attemptId),
      type,
      generationId: envelope.command.generationId,
      attemptId: envelope.command.attemptId,
      issuedAt: new Date().toISOString(),
      ...(envelope.traceId ? { traceId: envelope.traceId } : {}),
    });

    if (this.acceptedDedupIds.has(envelope.idempotencyKey)) {
      // Exactly what SQS FIFO does with a duplicate inside the dedup window.
      this.dedupDroppedCount += 1;
      return;
    }
    this.acceptedDedupIds.add(envelope.idempotencyKey);

    this.messages.push({
      body,
      messageGroupId: envelope.command.generationId,
      deduplicationId: envelope.idempotencyKey,
    });
  }

  /** Pops the next message, parsed by PRODUCTION's parser. */
  receive() {
    const message = this.messages.shift();
    if (!message) return null;
    const parsed = parseCommand(message.body);
    if (!parsed.ok) throw new Error(`fake-sqs: production parser rejected the body: ${parsed.reason}`);
    return { command: parsed.command, raw: message };
  }

  /**
   * Re-queues an already-delivered message, simulating SQS at-least-once
   * redelivery (which dedup does not prevent once the message was accepted
   * and its visibility timeout lapsed).
   */
  deliverDuplicate(raw: { body: string; messageGroupId: string; deduplicationId: string }) {
    this.messages.push(raw);
  }
}

// ---------------------------------------------------------------------------
// Supabase admin double injection
// ---------------------------------------------------------------------------

/**
 * Points every real module at the in-memory Supabase double.
 *
 * `supabaseAdmin.ts` caches its client in a module-level variable and all
 * seven orchestration/worker modules resolve through `getSupabaseAdminClient()`
 * at call time, so priming that cache redirects the whole graph — including
 * Storage, which flows through the same client — without touching a single
 * line of production code.
 */
export async function installFakeSupabase(db: FakeSupabaseClient): Promise<void> {
  // isSupabaseAdminConfigured() gates several code paths on these being
  // present. Non-secret placeholders pointing at an unroutable host — the
  // double intercepts every call, so nothing is ever sent anywhere.
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://fake-supabase.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= "e2e-double-not-a-real-key";

  const { __setSupabaseAdminClientForTesting } = await import("@/lib/supabase/supabaseAdmin");
  __setSupabaseAdminClientForTesting(db as never);
}

/** Restores normal admin-client resolution after a scenario. */
export async function uninstallFakeSupabase(): Promise<void> {
  const { __setSupabaseAdminClientForTesting } = await import("@/lib/supabase/supabaseAdmin");
  __setSupabaseAdminClientForTesting(null);
}

/** Fixture builders shared by the E2E scenarios. */
export function seedGeneration(
  db: FakeSupabaseClient,
  overrides: Record<string, unknown> = {}
): { generationId: string; clerkUserId: string } {
  // A real UUID: production's command-wire contract validates generationId
  // against a strict UUID pattern, so a fixture must satisfy it too.
  const generationId = (overrides.id as string) ?? randomUUID();
  const clerkUserId = (overrides.clerk_user_id as string) ?? "user_e2e";

  db.state.generations.push({
    id: generationId,
    project_id: "project-e2e",
    clerk_user_id: clerkUserId,
    generation_type: "image",
    provider: "mock",
    model: "mock-image",
    prompt: "zero-cost e2e synthetic prompt",
    negative_prompt: null,
    status: "queued",
    input_url: null,
    output_url: null,
    thumbnail_url: null,
    error_message: null,
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    completed_at: null,
    temporal_workflow_id: null,
    ...overrides,
  });

  return { generationId, clerkUserId };
}
