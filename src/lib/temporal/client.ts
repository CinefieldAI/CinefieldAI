import "server-only";
import { Client, Connection } from "@temporalio/client";
import { readTemporalConfig } from "./config";

/**
 * Cinefield Temporal client (Phase 6R.2).
 *
 * The Next.js side's only way to reach Temporal. It STARTS, SIGNALS, QUERIES
 * and CANCELS workflows — it never runs one. Workflow and activity execution
 * belongs to the ECS Fargate worker (locked decision C); a Vercel function
 * cannot host a long-lived poller.
 *
 * Deliberately mirrors `supabaseAdmin.ts`: server-only, lazily constructed,
 * cached for the process, and throwing a typed "not configured" error rather
 * than silently degrading. No credential is ever logged or returned.
 *
 * IMPORTANT: nothing here imports `@temporalio/worker`, `@temporalio/workflow`
 * or `@temporalio/activity`. Those pull in native binaries and belong only to
 * the worker process; importing one from the Next.js graph would drag them
 * into the app bundle.
 */

export class TemporalNotConfiguredError extends Error {
  constructor() {
    super("TEMPORAL_NOT_CONFIGURED");
    this.name = "TemporalNotConfiguredError";
  }
}

/**
 * Connections are expensive (a gRPC channel with TLS) and are meant to be
 * long-lived and shared. Cached as a promise so concurrent callers during a
 * cold start await one handshake instead of opening several.
 */
let clientPromise: Promise<Client> | null = null;

/**
 * TEST-ONLY seam (Phase 6R-B). Primes the cache with a client built against
 * the @temporalio/testing time-skipping server, so the zero-cost ownership
 * tests can drive the REAL production execution service — resolver, starter,
 * workflow id, conflict policy and all — instead of a reimplementation of it.
 *
 * Mirrors `__setSupabaseAdminClientForTesting` in src/lib/supabase/
 * supabaseAdmin.ts: one explicit, reviewable injection point rather than
 * module patching (impossible under ESM).
 *
 * Production never calls this. Passing null restores normal resolution.
 */
export function __setTemporalClientForTesting(client: Client | null): void {
  clientPromise = client === null ? null : Promise.resolve(client);
}

async function connect(): Promise<Client> {
  const config = readTemporalConfig();
  if (!config) throw new TemporalNotConfiguredError();

  const connection = await Connection.connect({
    address: config.address,
    // Temporal Cloud is TLS-only. With an API key, `tls: true` is the plain
    // server-verified handshake; with mTLS the client presents its own pair.
    tls: config.apiKey
      ? true
      : {
          clientCertPair: {
            crt: Buffer.from(config.clientCertPem ?? "", "utf8"),
            key: Buffer.from(config.clientKeyPem ?? "", "utf8"),
          },
        },
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
  });

  return new Client({ connection, namespace: config.namespace });
}

/**
 * Process-wide Temporal client.
 *
 * Throws `TemporalNotConfiguredError` when the environment is not set up, so
 * an unconfigured deployment fails loudly at the call site instead of
 * appearing to queue work that no one will ever run. A failed connection
 * clears the cache so the next caller retries rather than inheriting a
 * permanently rejected promise.
 */
export async function getTemporalClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = connect().catch((error: unknown) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}

/**
 * Closes the cached connection. For worker/process shutdown and tests — not
 * for request handlers, which should keep sharing the connection.
 */
export async function closeTemporalClient(): Promise<void> {
  const pending = clientPromise;
  clientPromise = null;
  if (!pending) return;
  try {
    const client = await pending;
    await client.connection.close();
  } catch {
    // Already failed or already closed; nothing to release.
  }
}
