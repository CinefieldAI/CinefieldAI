# Provider Network — Phase 8 Foundation

Status: foundation batch. One provider network, four adapters, no new paid
provider and no live provider call made from this repository.

## The execution chain

```
Model Router          decides WHERE            (server-side, Phase 7-B/C/D/E)
      |
      v
Temporal              owns the lifecycle       retry, cancellation, signals,
      |                                         finalization — nothing else does
      v
SQS + DLQ             transports the command
      |
      v
Provider Worker       executes it
      |
      v
ProviderAdapter       normalizes one provider
      |
      v
Temporal              receives the normalized result
```

The router never calls a provider. The adapter never owns a lifecycle. The
worker never decides where work goes. Each of those is asserted by a test.

## Capability declaration, not duck-typing

Until Phase 8 the core discovered what an adapter could do by checking whether
a method existed — `if (adapter.cancel)`. That answers "is there a function",
which is a different question from "does this provider support cancellation",
and the gap between them is where invented behaviour lives.

Every adapter now declares a `ProviderCapabilityMatrix`, and each capability
carries one of four statuses:

| Status | Meaning |
| --- | --- |
| `proven` | implemented **and** exercised against the real provider |
| `implemented_not_live_validated` | built against a documented/typed surface, never run live |
| `unsupported_by_adapter` | the provider may support it; Cinefield has not built it |
| `unknown_provider_capability` | nobody here has verified whether the provider supports it |

The last two are deliberately distinct. `false` would lose the only
information that says what to do next: one is work, the other is research.
`isUsable()` returns true only for the first two, and the cancel path now
consults the declaration rather than the method.

## fal.ai capability matrix

Every "implemented" below traces to the **installed SDK's own type surface** —
`node_modules/@fal-ai/client/src/queue.d.ts` declares `submit`, `status`,
`result` and `cancel` on `QueueClient`. That is verifiable in this repository
today. Nothing is inferred from memory or from what a provider probably does.

| Capability | Status | Evidence |
| --- | --- | --- |
| Submit | `implemented_not_live_validated` | `client.subscribe()`, with `onEnqueue` capturing the real request id |
| Status | `implemented_not_live_validated` | `queue.status(endpointId, { requestId })` — real lookup, works cross-process |
| Result | `implemented_not_live_validated` | `queue.result(endpointId, { requestId })` — real fetch, works cross-process |
| Polling | `implemented_not_live_validated` | Temporal-driven; the SDK supports status lookup |
| Webhook | `unsupported_by_adapter` | a `webhookUrl` submit option exists; Cinefield does not use it and has no ingress route |
| **Webhook authentication** | `unknown_provider_capability` | **no verifier, header or timestamp scheme in the SDK** |
| Cancel | `implemented_not_live_validated` | `queue.cancel(endpointId, { requestId })`, documented to throw when it cannot cancel |
| Ambiguous reconciliation | `implemented_not_live_validated` | built on `queue.status` |
| Native idempotency | `unknown_provider_capability` | no caller-supplied key in any submit option |

Nothing is `proven`, because proven means exercised live and this batch makes
no paid call.

### Why the webhook stays unbuilt

fal can call a URL. Cinefield cannot currently **prove** that a given callback
came from fal — the SDK ships no signature verifier and no documented header to
check. An unverifiable callback endpoint is an unauthenticated way for anyone
to claim a job finished, which is worse than having no webhook at all.
Inventing a scheme would be worse still. So the capability is marked unverified,
the ingress is not built, and the Security Release Gate stays open.

The internal plumbing is ready: `webhook-continuation.ts` accepts only a
branded `VerifiedWebhookEvent`, which a plain object literal cannot satisfy, so
an unverified payload cannot reach the continuation even by accident.

## fal execution model — durable by identifier

```
Router-selected route      (server-side, persisted on the generation)
   -> Temporal              owns lifecycle, retry timing, cancellation
   -> SQS                   transports the command
   -> Provider Worker       executes the activity
   -> fal submit            client.subscribe(), onEnqueue captures the request id
   -> provider request id   persisted on generation_attempts.provider_job_id
   -> endpoint id           persisted in the submission's resume metadata
   -> Temporal              controls what happens next
   -> queue.status          by (endpointId, requestId)
   -> queue.result          by (endpointId, requestId)
   -> normalized output
```

### Provider result recovery MUST NOT depend on worker process memory

It used to. `submit()` held its images in a module-level `Map` keyed by
generation id and `getResult()` read them back out, which made one process's
memory the only copy of a job fal had **already run and already billed**. A
crash between completion and storage lost that output permanently; a
continuation resumed on another worker found nothing.

The Map is **removed**, not demoted to a fast path. A "durable first, memory
second" fallback would pass in the process that submitted and fail everywhere
else — hiding exactly the defect it appears to fix.

`getResult()` and `getStatus()` now address the request by
`(endpointId, requestId)`, both of which live in PostgreSQL:

| Identifier | Durable home |
| --- | --- |
| request id | `generation_attempts.provider_job_id` |
| endpoint id | submission resume metadata (`generations.metadata.orchestration.providerJob.resume`) |
| route / provider model | `generation_attempts.model_route_id`, `.provider_model` |

Any process holding the attempt row can recover the output: the worker that
submitted, a different worker, or the same worker after a restart.

**The cost, stated:** in the synchronous path `subscribe()` already has the
images in hand and `getResult()` fetches them again from the queue. That is
one extra HTTP round-trip per generation against an already-completed request.
It buys recoverability of a billed job, and the only way to avoid it is the
in-memory copy that caused the defect.

### `subscribe()` is retained — deliberately

`submit()` still uses `client.subscribe()`, which keeps the activity open until
fal finishes. The alternative — `queue.submit()` returning immediately, with
Temporal timers driving the polling — is the architecturally cleaner shape and
the SDK supports it.

It was **not** adopted in this repair batch, for reasons that are about risk
rather than preference. Switching fal to asynchronous changes its registry
`executionMode`, moves it onto the workflow's dispatch-and-observe path, and
alters which submission outcomes are reachable — including the ambiguity
classification, which is the one part of this system where being wrong costs a
duplicate charge. That is a behavioural change deserving its own batch and live
validation, not a side effect of fixing result durability.

Lifecycle ownership is not violated in the meantime: Temporal still owns retry,
cancellation, finalization and the polling schedule; the activity's wait is
bounded by Cinefield's own 90-second timeout inside Temporal's 5-minute
start-to-close. What `subscribe()` costs is a long-held activity, not
authority.

## Submission evidence

The Phase 6/6R ladder is unchanged; Phase 8 only feeds it honestly.

| Provider outcome | Evidence | Failover |
| --- | --- | --- |
| Accepted, job id returned | `job` + `provider_job_id` | never — reconcile instead |
| Conclusively rejected (auth, quota, bad request) | `none` | safe |
| Never left Cinefield (not configured, validation) | `none` | safe |
| Timeout, dropped connection, unparseable result | `ambiguous` | **never** |

`fal.submit()` waits for completion inside `subscribe()`, so a timeout can land
long after a billable job started — which is why `PROVIDER_TIMEOUT`,
`PROVIDER_FAILED` and `OUTPUT_MISSING` are absent from the
`provesNoProviderJob` allowlist. `onEnqueue` captures the real request id
*before* the wait, so a later failure carries JOB evidence rather than
collapsing into permanent ambiguity.

## Provider job correlation

```
generation_id  (never changes, not even across failover)
  └── generation_attempts.id          one row per provider attempt
        ├── model_route_id            which route ran it
        ├── model_version_id
        ├── provider / provider_model the adapter that executed
        └── provider_job_id           the provider's own id
```

Durable in PostgreSQL. **Never in Redis** — Redis A holds ephemeral health and
runtime controls only, and a lost key must never lose a provider job.

## Cancellation

| Adapter | Cancel |
| --- | --- |
| mock | `proven` |
| fal | `implemented_not_live_validated` — real `queue.cancel` |
| gemini | `unsupported_by_adapter` — completes in submit, no job handle |
| cloudflare-workers-ai | `unsupported_by_adapter` — same |

A resolved `queue.cancel` means fal **accepted** the cancellation, not that the
job was free — the SDK's own docs warn the server may be unable to stop a
request already running. A throw is reported as `failed`, whose settlement
class is `unknown_reconcile`: more conservative than `unsupported`, because an
unanswered cancel leaves the job's fate genuinely unknown. **No path converts a
failure into a confirmation.**

## Ambiguous reconciliation

`reconcileSubmission(providerJobId, …)` asks the provider whether a job exists.
For fal this is `queue.status`, and it returns:

- `job_exists` — the job is real and must never be duplicated
- `no_such_job` — **fal's adapter never returns this**
- `unknown` — everything else

That middle row is the important one. A failing status call is not proof of
absence: a 404 could be a wrong endpoint id, an expired record, or a transient
failure. Returning `no_such_job` for any of those would clear the
reconciliation block and let Cinefield submit a job fal is already running. The
synthetic `fal-<generationId>` fallback id is rejected before any call for the
same reason — fal has never seen it, so a "not found" would prove nothing.

## Other adapters still hold results in memory

Gemini and Cloudflare Workers AI keep a process-local result map between
`submit()` and `getResult()`. That is **not** the same defect and is not fixed
here, because it is not fixable the same way: both complete inside `submit()`,
neither returns a job handle, and neither provider offers a
"fetch result by id" API this repository can verify. There is nothing durable
to read back.

The consequence is bounded and worth stating: a crash mid-`executeGeneration`
loses their output, and the generation goes to reconciliation rather than
silently completing. Closing that properly means either a durable
intermediate store or a provider-side retrieval API, and neither should be
invented here.

## Status

```
FAL.AI FOUNDATION CODE:  restart-safe result/status recovery implemented
FAL.AI LIVE VALIDATION:  PENDING — no paid call has been made from this repo
FAL.AI WEBHOOK SECURITY: PROVIDER_MECHANISM_NOT_VERIFIED — gate open
ADDITIONAL PROVIDERS:    NOT_CONFIGURED
```

This is not a claim of public-production readiness.

## Not in this batch

No new provider (Runway, Runware, xAI, Bedrock, Azure, OpenAI, Replicate,
Kling, Seedance). No credentials. No paid call. No fake production route. Phase
9 still owns media finalization; Phase 10 still owns billing.
