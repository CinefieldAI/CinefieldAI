import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readiness } from "@/lib/health/health-service";
import { getAdminDlqInvestigation } from "./dlq-admin-service";
import { getAdminBullmqHealth } from "./bullmq-admin-service";
import type { DlqPresenceState, QueueHealthResult } from "./queue-health-contract";

/**
 * The Phase 16-B admin Queue Health read service.
 *
 * `readiness("provider-worker")` is reused verbatim for SQS status — that
 * runtime's own dependency matrix already marks `sqs` CRITICAL ("It is an
 * SQS consumer. No queue, no work.") and `redis-b` DEFERRED (unprovisioned
 * everywhere) — nothing here re-evaluates dependency health itself.
 */
export async function getAdminQueueHealth(admin: SupabaseClient): Promise<QueueHealthResult> {
  const [readinessReport, dlqResult, bullmqResult] = await Promise.all([
    readiness("provider-worker"),
    getAdminDlqInvestigation(admin),
    getAdminBullmqHealth(),
  ]);

  const sqsDependency = readinessReport.dependencies.find((d) => d.dependency === "sqs");

  let dlqPresence: DlqPresenceState = "UNKNOWN";
  if (dlqResult.outcome === "NO_MESSAGE") dlqPresence = "EMPTY";
  else if (dlqResult.outcome === "DECIDED") dlqPresence = "MESSAGE_PRESENT";

  return {
    sqs: {
      status: sqsDependency?.status ?? "UNKNOWN",
      reason: sqsDependency?.reason ?? "not_evaluated",
      dlqPresence,
    },
    bullmq: {
      configured: bullmqResult.outcome !== "NOT_CONFIGURED",
      queues: bullmqResult.outcome === "FOUND" ? bullmqResult.queues : [],
    },
    evaluatedAt: new Date().toISOString(),
  };
}
