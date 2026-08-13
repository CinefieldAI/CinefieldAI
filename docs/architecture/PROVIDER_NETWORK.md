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
| Submit | `implemented_not_live_validated` | `queue.submit(endpointId, { input })` → `request_id`, enqueue only |
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

## fal execution model — asynchronous, durable by identifier

```
Router-selected route      (server-side, persisted on the generation)
   -> Temporal              owns lifecycle, retry timing, cancellation
   -> SQS                   transports the command
   -> Provider Worker       runs the submit activity
   -> queue.submit          ENQUEUE ONLY — returns fal's request_id
   -> request id persisted  generations.metadata.orchestration.providerJob
                            -> generation_attempts.provider_job_id
   -> activity RETURNS      nothing is waiting on a provider any more
   -> Temporal timers       decide when to look again
   -> queue.status          by (endpointId, requestId)
   -> queue.result          by (endpointId, requestId)
   -> normalized output
```

### A provider request ID for an accepted, billable job must never exist only in worker process memory

That is the rule this phase closed, and it took two passes.

The first pass fixed **result** recovery. The second found the window before
it: `submit()` used `client.subscribe()`, which held the connection open until
fal finished, and the request id lived in a local variable for that entire
time — often a minute or more. A worker that died there left a job fal was
running, and billing, that Cinefield could no longer name. No
`provider_job_id` on the attempt, nothing for reconciliation to ask about, no
way to collect the output.

`queue.submit` returns the moment fal accepts, carrying `request_id`. The
orchestrator's async branch persists it before anything waits. Acceptance and
identification are now one short POST, which also makes the **ambiguity window
narrower than it was**: the uncertain interval is a single request rather than
a whole generation.

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

There is no longer a redundant fetch to apologise for: `submit()` never holds
the images, so `getResult()` is the only place they are read.

### `subscribe()` is gone

The previous batch retained it and said so; this one removed it. What changed
is not the SDK but the question being asked: once "can the request id be lost
to a process failure?" was answered honestly, keeping a minute-long wait inside
an activity was no longer a style preference.

fal models are now `executionMode: "async"` in the registry — a declarative
field nothing branches on, so the behavioural switch is `submission.status`
returning `"queued"` instead of `"completed"`. The async machinery it hands off
to is the one Phase 6B/6C built and tested: `markProcessingAsync` persists the
job, the activity returns, and `checkAsyncGeneration` collects later.

Temporal owns the waiting outright now. The adapter holds no timer except a
90-second abort ceiling on the enqueue POST, and contains no polling loop —
asserted by a test.

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

## Production reachability gate

**Enabled route != production-safe route.**

A provider that cannot prove it survives a worker dying mid-generation does
not run canonical production work. This is a **hard eligibility condition**
inside `rejectionFor()` — the one function both routers share — so it is
evaluated before runtime controls, before the circuit breaker, and before any
health, cost, quality or priority is weighed. A route rejected here never
reaches the code that scores anything, and its evaluation carries no score at
all.

The rejection reason is `provider_execution_not_restart_safe`, deliberately
distinct from `provider_disabled`: nobody turned this off, and turning
anything on will not change it.

### Durability matrix

| Provider | Execution durability | Canonical production routing | Reason |
| --- | --- | --- | --- |
| **fal.ai** | `implemented_not_live_validated` | **code-eligible** | durable request id, cross-process status/result/cancel; never run live |
| **mock** | `restart_safe` | eligible | reaches no network, creates no billable job — a crash costs a re-run |
| **Gemini** | `not_proven` | **BLOCKED** | process-local result dependency; no fetch-by-id recovery exists |
| **Cloudflare Workers AI** | `not_proven` | **BLOCKED** | same |

`fal.ai` is **eligible but not live-validated**, and those are different
claims. The recovery code is real and tested against doubles across separate
client instances; it has never been run against the live API. That debt is
tracked, not hidden behind eligibility.

### Why exclusion rather than a fix

Gemini and Cloudflare both complete inside `submit()` and return no job
handle, and neither offers a verifiable fetch-result-by-id API. There is
nothing durable to read back, so the fal solution has no analogue. Closing the
gap needs a durable output handoff — which is **Phase 9's media plane**, and
inventing a blob store, a Redis result cache or a temp file inside a provider
batch would be the wrong fix in the wrong phase. A test asserts none of those
appeared.

So the choice was between shipping a provider that can lose a billed job's
output and not routing production traffic to it. The rule that settles it: a
provider that cannot prove restart-safe execution is not eligible.

### What nothing can override

| Attempt | Result |
| --- | --- |
| priority 10 000 | still excluded |
| every DB flag enabled | still excluded |
| perfect health, zero errors, 1 ms latency | still excluded |
| zero cost, top trusted quality | still excluded |
| runtime flags clear | still excluded |
| failover candidate | still excluded — same resolver, no weaker path |

Runtime controls can only ever **subtract**; there is no control shape that
adds a route back. Admin route policy and provider execution safety are
separate concepts, and an operator cannot enable their way past a missing
recovery path.

### Public production availability (gap CLOSED)

The server has been fail-closed since the durability gate landed: creating a
generation for a Gemini-backed model raises `NO_ELIGIBLE_ROUTE` before any row
exists. The catalog did not know that, so /generate kept offering nano-banana
while the server refused it — a product that looks broken rather than one that
is honest.

**Public capability != production availability.** What a model *can do* and
whether it *can run* are different questions with different owners. The
capability registry answers the first; the route table answers the second.

**Build-time catalog != live route availability.** Two layers, split honestly:

| Layer | Carries | Why it may |
| --- | --- | --- |
| `public-model-catalog.ts` (build) | capabilities + `productionReady` | execution durability is a property of the shipped adapter — it cannot change without a deploy |
| `GET /api/models` (runtime) | the above + `productionAvailability` / `productionAvailable` | route enablement changes at runtime, and only a query can see it |

A build artifact is never presented as knowing live route state. The static
flag is named `productionReady`, not `available`, for exactly that reason.

**One eligibility truth.** `resolveModelAvailability` calls
`listRouteCandidates` and `rejectionFor` — the router's own functions. It
re-implements no check and contains no scorer; a test asserts that
`candidate.enabled`, `providerEnabled`, `providerModelEnabled`, `routeStatus`
and the scoring functions appear nowhere in it. A second "is this usable"
implementation is how a catalog eventually disagrees with the thing it
describes.

**Availability is EXISTENCE of a safe route, not "the winner is safe".** A
model with a top-priority Gemini route and a low-priority fal route is
`available` — the router will simply never pick the Gemini one.

| States | Meaning |
| --- | --- |
| `available` | at least one route passes hard eligibility |
| `temporarily_unavailable` | routes exist and are structurally fine; something that heals on its own is in the way |
| `not_production_ready` | no routes, or every one blocked structurally — an operator must act |

**Product language only.** The response carries a state and nothing else: no
provider, no provider model, no route id, no priority, no score, no breaker
state, no durability enum. `internalReasons` — including
`provider_execution_not_restart_safe` — is computed for logs and never
serialized. "This model is unavailable" is a product fact; "gemini has unproven
execution durability" is not the browser's business.

**UI, narrowly.** `ModelSelector` refuses to select a model the registry knows
and the server will refuse, and its row reads `Unavailable`. The gate is
`isOrchestrationModel(id) && !isProductionReadyModel(id)`, so it fires only for
models with a real server-side entry — every marketing card in that list has no
server model at all and is untouched. No Gemini model is silently remapped to
fal, and no direct fallback exists.

**The server is still the authority.** `POST /api/generate` re-derives
eligibility itself and never consults availability — asserted by a test. A
stale, cached or forged availability value grants nothing.

## Status

```
FAL RESULT DURABILITY:      PASS — recovered from (endpointId, requestId)
FAL SUBMISSION DURABILITY:  PASS — request id persisted before any wait
FAL ASYNC EXECUTION:        PASS — enqueue-and-return, Temporal observes
FAL LIVE VALIDATION:        PENDING — no paid call has been made from this repo
FAL WEBHOOK SECURITY:       PROVIDER_MECHANISM_NOT_VERIFIED — gate open
GEMINI ROUTABILITY:         BLOCKED_UNTIL_DURABLE — excluded by the hard gate
CLOUDFLARE ROUTABILITY:     BLOCKED_UNTIL_DURABLE — excluded by the hard gate
PUBLIC AVAILABILITY:        CONSISTENT — catalog and server agree; runtime
                            availability derived from the router's eligibility
ADDITIONAL PROVIDERS:       NOT_CONFIGURED
```

This is not a claim of public-production readiness.

## Not in this batch

No new provider (Runway, Runware, xAI, Bedrock, Azure, OpenAI, Replicate,
Kling, Seedance). No credentials. No paid call. No fake production route. Phase
9 still owns media finalization; Phase 10 still owns billing.
