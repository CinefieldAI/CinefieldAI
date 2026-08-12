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
| Status | `implemented_not_live_validated` | `queue.status(endpointId, { requestId })` |
| Result | `implemented_not_live_validated` | `queue.result(endpointId, { requestId })` |
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

## Not in this batch

No new provider (Runway, Runware, xAI, Bedrock, Azure, OpenAI, Replicate,
Kling, Seedance). No credentials. No paid call. No fake production route. Phase
9 still owns media finalization; Phase 10 still owns billing.
