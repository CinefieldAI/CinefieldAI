import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { acceptDurableTraceId, continueTrace, resolveTraceContext, type TraceContext } from "./trace-context";

/**
 * The in-process trace scope (Phase 13-A).
 *
 * ---------------------------------------------------------------------------
 * WHY ASYNCLOCALSTORAGE, AND EXACTLY HOW FAR IT IS TRUSTED
 * ---------------------------------------------------------------------------
 * 25 modules log through the guarded logger, across several hundred call
 * sites. Threading a trace id through every one of them would be a diff
 * across the orchestration, provider, Redis and workflow paths — enormous,
 * risky on the money path, and it would still miss anything added later.
 *
 * So the trace is ambient WITHIN one process context: `runInTraceScope` binds
 * it, the logger reads it when a caller did not pass one, and every existing
 * log line gains correlation without changing.
 *
 * ---------------------------------------------------------------------------
 * IT DOES NOT CROSS A DURABLE BOUNDARY, AND THAT IS NOT A LIMITATION TO WORK
 * AROUND
 * ---------------------------------------------------------------------------
 * An async context is memory in one process. It does not survive an SQS
 * message, a Temporal workflow, an outbox row, a worker restart or a
 * different container — and code that assumed it did would produce traces
 * that silently break exactly where a distributed trace is most useful.
 *
 * So every durable hop carries the trace id EXPLICITLY, as a field:
 *
 *   Temporal   -> `GenerationWorkflowInput.traceId`, durable in workflow history
 *   SQS        -> `CommandEnvelope.traceId`, already on the wire contract
 *   outbox     -> `outbox_events.trace_id`, already a column
 *   security   -> `security_events.trace_id`, already a column
 *
 * The ambient scope is a convenience for logging inside one hop. The field is
 * the contract between hops. A test asserts the durable carriers exist.
 */

interface Scope {
  context: TraceContext;
}

const storage = new AsyncLocalStorage<Scope>();

/**
 * Runs `fn` with a bound trace context.
 *
 * Synchronous wrapper around the async callback so the binding covers
 * everything the request awaits.
 */
export function runInTraceScope<T>(context: TraceContext, fn: () => T): T {
  return storage.run({ context }, fn);
}

/** The active context, or undefined outside a scope. Never throws. */
export function currentTraceContext(): TraceContext | undefined {
  return storage.getStore()?.context;
}

/**
 * The active trace id, or undefined.
 *
 * Undefined is a legitimate answer and callers must treat it as one. A
 * scheduled job, a worker loop and a system-initiated security event all run
 * outside any request, and inventing a trace id for them would fabricate a
 * correlation that never existed — ¶ "No fake trace id for scheduled/system
 * events".
 */
export function currentTraceId(): string | undefined {
  return storage.getStore()?.context.traceId;
}

/**
 * Begins a request scope at the HTTP edge.
 *
 * `trustInbound` defaults to FALSE. Every request today arrives from a
 * browser, and a browser-supplied `traceparent` is attacker-controlled text
 * that would land in operator dashboards. When an upstream we control exists
 * — 12-A's Cloudflare edge, or an internal service — this becomes true at
 * that one boundary.
 */
export function beginRequestTrace<T>(
  headers: Headers | null | undefined,
  fn: (context: TraceContext) => T,
  options?: { trustInbound?: boolean }
): T {
  const context = resolveTraceContext(headers?.get("traceparent") ?? null, options);
  return runInTraceScope(context, () => fn(context));
}

/**
 * Binds a trace for the REMAINDER of the current request, without a callback.
 *
 * `enterWith` rather than `run`, and the difference is what makes this usable
 * at the boundary that already exists. `guardRoute` is called first by all 14
 * API routes but it RETURNS before the handler body runs, so a callback form
 * would only cover the guard itself. `enterWith` sets the store for the
 * current async context and everything it subsequently awaits — which is the
 * rest of the handler.
 *
 * Node's docs caution that `enterWith` can bleed into a surrounding context
 * when called outside one. It does not here: a route handler is invoked in
 * its own async context per request, and concurrent requests were verified to
 * stay isolated before this was relied on.
 *
 * Returns the context so a caller that wants it explicitly can have it. Most
 * do not — the logger reads the ambient scope.
 */
export function enterRequestTrace(
  headers: Headers | null | undefined,
  options?: { trustInbound?: boolean }
): TraceContext {
  const context = resolveTraceContext(headers?.get("traceparent") ?? null, options);
  storage.enterWith({ context });
  return context;
}

/**
 * Resumes a trace that arrived over a durable boundary.
 *
 * Validates on the way in — a queue message is not an authority (6R.22), and
 * a workflow argument written by an older build is still input. An
 * unusable value yields a fresh context rather than a broken one, so the
 * trace restarts visibly instead of correlating to nothing.
 */
export function resumeDurableTrace<T>(traceId: unknown, fn: (context: TraceContext) => T): T {
  const accepted = acceptDurableTraceId(traceId);
  const context = accepted ? continueTrace(accepted) : resolveTraceContext(null);
  return runInTraceScope(context, () => fn(context));
}
