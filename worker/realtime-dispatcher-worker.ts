/**
 * Cinefield realtime outbox dispatcher entry point (Phase 11 closure).
 *
 * Long-lived process for AWS ECS Fargate — the missing arrow in the locked
 * chain: business transaction → Postgres Outbox → THIS WORKER → Notification
 * Service → Redis Streams → SSE Gateway → Browser. Lives outside `src/` for
 * the same reason the Temporal and provider workers do: nothing under the
 * Next.js graph may reach it, and nothing here may be pulled into a serverless
 * bundle.
 *
 * ---------------------------------------------------------------------------
 * WHY A SEPARATE PROCESS, NOT A LOOP INSIDE AN EXISTING WORKER
 * ---------------------------------------------------------------------------
 * Hosting this inside `temporal-worker` or `provider-worker` would couple
 * three unrelated ownerships to one lifecycle: a Redis outage that crashed the
 * dispatcher would take down provider submission, which is the money path.
 * The blast radii are deliberately different sizes — losing realtime delivery
 * is a degraded UI, losing provider submission is a failed paid generation —
 * and a shared process makes the cheap failure able to cause the expensive
 * one.
 *
 * They also want different restart behaviour. This loop should restart
 * eagerly and often; a Temporal worker restarting eagerly is how sticky task
 * queues thrash. Separate container, separate supervision, separate scaling.
 *
 * ---------------------------------------------------------------------------
 * IT OWNS DELIVERY AND NOTHING ELSE
 * ---------------------------------------------------------------------------
 * It cannot create a generation, start a workflow, submit or retry a provider,
 * move credits, release quarantine or mint a URL — it imports nothing that
 * could, and a structural test asserts those imports stay absent.
 *
 * Credentials: the Supabase service role and Redis A URL come from the
 * environment (ECS task definition secrets in production). Nothing here reads,
 * logs or prints one.
 *
 * Run:  npm run realtime:dispatcher
 */

import { dispatchRealtimeOnce, readRealtimeDebt } from "../src/lib/realtime/outbox-dispatcher";
import { getSupabaseAdminClient, isSupabaseAdminConfigured } from "../src/lib/supabase/supabaseAdmin";

/**
 * CADENCE. Realtime means the gap between a committed fact and a browser
 * frame, and this loop is most of that gap. A cron at one-minute granularity
 * would make "realtime" a misnomer, which is exactly why the roadmap's
 * dispatcher is a long-running process rather than a scheduled task.
 *
 * IDLE_MS is the pause after an empty claim. Short enough to feel immediate,
 * long enough that an idle system is not issuing twenty queries a second.
 * A full batch is followed by NO pause at all — a backlog should drain at the
 * speed the database allows, not at the speed of a timer.
 */
const IDLE_MS = 750;
const ERROR_BASE_MS = 1_000;
const ERROR_MAX_MS = 30_000;
const BATCH_LIMIT = 100;
/** Must exceed the time one batch can take, or a slow pass loses its own lease. */
const LEASE_SECONDS = 60;
/** Debt is logged occasionally, as counts only. */
const DEBT_LOG_EVERY_MS = 60_000;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

async function main(): Promise<void> {
  if (!isSupabaseAdminConfigured()) {
    // Fail loudly at startup rather than looping forever against nothing.
    console.error("[realtime-dispatcher] Supabase admin is not configured; refusing to start");
    process.exitCode = 1;
    return;
  }

  const admin = getSupabaseAdminClient();
  const controller = new AbortController();
  let stopping = false;

  const stop = () => {
    if (stopping) return;
    stopping = true;
    // Finish the in-flight pass, then exit — ECS sends SIGTERM before killing
    // a task, and a pass abandoned mid-flight leaves rows leased until their
    // lease expires. Draining is cheaper than waiting out a lease.
    console.log("[realtime-dispatcher] shutdown requested; finishing current pass");
    controller.abort();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  console.log("[realtime-dispatcher] started");

  let errorStreak = 0;
  let lastDebtLog = 0;

  while (!controller.signal.aborted) {
    try {
      const result = await dispatchRealtimeOnce({ admin, limit: BATCH_LIMIT, leaseSeconds: LEASE_SECONDS });
      errorStreak = 0;

      if (result.claimed > 0) {
        // Counts only. No event id, no tenant, no payload — a log line that
        // carries a user's content is a data leak with a timestamp on it.
        console.log(
          `[realtime-dispatcher] claimed=${result.claimed} published=${result.published} ` +
            `notUserFacing=${result.notUserFacing} unroutable=${result.unroutable} ` +
            `invalid=${result.invalid} transportFailed=${result.transportFailed} ` +
            `lostLease=${result.lostLease}`
        );
      }

      if (Date.now() - lastDebtLog >= DEBT_LOG_EVERY_MS) {
        lastDebtLog = Date.now();
        const debt = await readRealtimeDebt(admin);
        if (debt && (debt.pending > 0 || debt.dispatching > 0)) {
          console.log(
            `[realtime-dispatcher] debt pending=${debt.pending} dispatching=${debt.dispatching} ` +
              `oldestSec=${debt.oldestPendingSeconds} maxAttempts=${debt.maxAttempts} ` +
              `unroutable=${debt.unroutable} invalid=${debt.invalid}`
          );
        }
      }

      // A full batch means more is waiting: keep going without pausing.
      if (result.claimed < BATCH_LIMIT) {
        await sleep(IDLE_MS, controller.signal);
      }
    } catch (error) {
      // A pass that threw resolved nothing, so the debt is intact and the
      // claim's lease will expire. Back off with jitter so a database or
      // Redis outage is not amplified by a tight retry loop, and so several
      // replicas do not return in the same instant.
      errorStreak += 1;
      const ceiling = Math.min(ERROR_MAX_MS, ERROR_BASE_MS * 2 ** (errorStreak - 1));
      const delay = Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
      // Class only — never a driver message, which can echo row content.
      console.error(
        `[realtime-dispatcher] pass failed (${error instanceof Error ? error.name : "unknown"}); ` +
          `retry in ${delay}ms`
      );
      await sleep(delay, controller.signal);
    }
  }

  console.log("[realtime-dispatcher] stopped");
}

void main();
