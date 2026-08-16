/**
 * Manual, operator-invoked DLQ investigation (Phase 15-D/3).
 *
 * Run:  npx tsx scripts/dlq-investigate.ts
 *
 * ---------------------------------------------------------------------------
 * READ-ONLY, BY CONSTRUCTION
 * ---------------------------------------------------------------------------
 * Peeks at most one message from `cinefield-provider-dlq.fifo`
 * (`VisibilityTimeout: 0` — never hides it from anyone else), evaluates it
 * against durable Cinefield evidence through the EXISTING Phase 15-D/1
 * decision engine, and prints a bounded result. It never redrives, deletes,
 * or mutates anything — there is no code path in this file, or in either of
 * the two modules it calls, capable of doing so.
 *
 * ---------------------------------------------------------------------------
 * NO HTTP ROUTE. NO SCHEDULER. NO NEW ADMIN-AUTH SYSTEM.
 * ---------------------------------------------------------------------------
 * This is a plain script, invoked manually from a shell — the same shape
 * `scripts/dr-restore-proof-verify.ts` (Phase 15-C/2) already uses for a
 * manual operator tool. Running it already requires the same AWS and
 * Supabase service-role credentials the provider worker and every other
 * operational script in this repository require; that credential boundary
 * IS the access control. It deliberately does not call
 * `assertStartupConfiguration` — that gate exists to refuse an invalid
 * PRODUCTION RUNTIME at process start for a long-lived worker, and forcing
 * it here could make this narrow investigation tool refuse to run during
 * exactly the messy-production-config moment it exists to help diagnose.
 *
 * Prints bounded JSON only: an outcome, a decision state, a reason code, and
 * the two ids the decision engine already validated as UUIDs. Never the raw
 * message body, never a raw AWS SDK response, never a stack trace.
 */

import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/supabaseAdmin";
import { createSupabaseDlqRedriveSource } from "@/lib/aws/dlq-redrive/adapters/supabase-dlq-redrive-source";
import { createSqsDlqMessageSource } from "@/lib/aws/dlq-redrive/adapters/sqs-dlq-message-source";
import { investigateProviderDlq } from "@/lib/aws/dlq-redrive/dlq-investigation-service";

async function main(): Promise<void> {
  const messageSource = createSqsDlqMessageSource();
  const evidenceSource = isSupabaseAdminConfigured()
    ? createSupabaseDlqRedriveSource(getSupabaseAdminClient())
    : null;

  const result = await investigateProviderDlq({ messageSource, evidenceSource });

  if (result.outcome === "DECIDED") {
    console.log(
      JSON.stringify(
        {
          outcome: result.outcome,
          state: result.decision.state,
          reasonCode: result.decision.reasonCode,
          attemptId: result.decision.attemptId,
          generationId: result.decision.generationId,
          sourceQueue: result.decision.sourceQueue,
          dlqName: result.decision.dlqName,
        },
        null,
        2
      )
    );
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({ outcome: "SCRIPT_FAILED", error: error instanceof Error ? error.name : "UnknownError" })
  );
  process.exit(1);
});
