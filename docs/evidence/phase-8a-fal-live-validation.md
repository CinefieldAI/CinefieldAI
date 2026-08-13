# Phase 8-A — fal.ai live validation

One controlled, user-authorized, billable generation, executed through the
canonical Cinefield path. This file exists because the previous audit could
find no durable record that any real fal call had ever run from this
repository, and a claim nobody can re-check is not evidence.

Everything below is read back from the live database and from Supabase
Storage after the fact. No value here is a secret: no key, no Authorization
header, no signed URL.

```
Timestamp (UTC)   2026-08-13T18:48:19Z … 18:48:35Z
Commit            d736db5
Authorized by     user, explicitly, for exactly ONE billable generation
Paid calls made   1
```

## What ran

```
Cinefield model     fal-flux-schnell
fal endpoint        fal-ai/flux/schnell
Aspect ratio        16:9  → image_size=landscape_16_9
Output count        1
generation_id       5950ae06-8635-491d-8c63-8e845f98b330
attempt_id          03a255a2-6db4-495e-b005-95f6e0db8127
model_route_id      085f4eaf-27bc-46eb-b1b4-56efd02eaf5c
model_version_id    66c29ecb-52b8-4004-ae98-eb35ad85ff5e
workflow_id         gen:5950ae06-8635-491d-8c63-8e845f98b330
provider_job_id     019ffc74-3460-7e01-b87a-85ef5e4a9a58   (fal request_id)
```

Cost: fal bills FLUX.1 [schnell] at $0.003 per megapixel, rounded up. The
image is 1024×576 = 0.59 MP, so one megapixel was billed: **$0.003**.

## The chain, link by link

| Link | Evidence |
|---|---|
| Generation creation | `create_generation_tx` returned `created`, row committed before anything else |
| Router | `metadata.routing.selectionReason = static_priority_100`, `providerId = fal`, resolved from the LIVE `model_routes` table |
| Temporal ownership | `temporal_workflow_id = gen:5950ae06…`; `resolveGenerationOwner()` answered `temporal`, no fallback owner exists |
| Adapter | `metadata.orchestration.provider = fal`, `isMock = false` |
| `queue.submit` | `attempt.submitted_at = 18:48:22.981Z`, 1.5 s after `started_at` — enqueue-and-return, not a wait |
| Real request id | `019ffc74-3460-7e01-b87a-85ef5e4a9a58`, a fal-issued UUIDv7 |
| Durable provider_job_id | persisted on the attempt row AND in `metadata.orchestration.providerJob.id`, before any wait |
| Endpoint durability | `providerJob.resume.endpointId = fal-ai/flux/schnell` — the pair `(endpointId, requestId)` that status/result/cancel need is durable, not process-local |
| Polling | `providerJob.lastCheckSource = "poll"`, `checkCount = 1`, `lastCheckedAt = 18:48:33.711Z` — Temporal observed, the adapter did not block |
| `queue.result` | `providerJob.state = completed` |
| Normalization | real bytes reached the shared output path; nothing synthesized |
| Cinefield storage | `generation-outputs/user_3HSYp4w…/f9d469e6…/5950ae06…/…png`, downloaded back and verified: PNG magic `89 50 4e 47`, **308 258 bytes, 1024×576** — exactly the dimensions `landscape_16_9` implies |
| Finalization | `finalizeClaimedAt = 18:48:33.769Z`, generation `completed` at `18:48:34.588Z`, `output_url` set |

Wall clock, request to finalized: **16.6 seconds**.

## Exactly-once

```
generations rows created   1
generation_attempts rows   1
provider submissions       1
```

One logical request, one generation id, one attempt, one fal job. No
resubmission, no failover, no ambiguous outcome to reconcile.

An earlier attempt at this same validation aborted inside
`resolveHealthyRoute` on a malformed `REDIS_URL`, before `create_generation_tx`
ran. It created no row and contacted no provider, so it cost nothing — which
is the behaviour the fail-closed design is supposed to produce.

## A naming artifact, so nobody misreads the evidence

The stored object is called `mock-output-01-…png`. That prefix is hardcoded
for **every** output in `buildOrchestrationOutputPath`
(`src/lib/orchestration/output-storage.ts:41`) and says nothing about which
provider produced the bytes. The provider is recorded in
`metadata.orchestration.provider = fal` with `isMock = false`, and the file
itself is a 308 KB 1024×576 photographic PNG. The mock provider emits a
small synthetic image and would never produce this.

## What this does NOT prove

- **Live cancel** — `queue.cancel` was never called against a real job.
- **Live reconciliation** — the submission was never ambiguous, so
  `reconcileSubmission` never ran against fal.
- **Live crash recovery** — no worker was killed mid-flight. Restart safety
  is proven in tests with doubles across separate client instances; it has
  not been proven in the field.
- **Webhook authenticity** — no ingress exists and fal ships no verifiable
  signing scheme this repository can check. Polling is the supported path.
- **Settlement** — Phase 10. `model_pricing` holds no fal row, no credit was
  reserved or debited, and this test did not require one.

## Durability classification — unchanged, deliberately

`productionExecutionDurability` stays `implemented_not_live_validated`.

This run does validate the provider behaviour the restart-safe design
assumes: fal named the request in the submit response, and the same
`(endpointId, requestId)` pair later answered a status check made by a
separate poll — so the addressing scheme the recovery path depends on is
real, not inferred from a type definition.

But `restart_safe` claims recovery works after the submitting process dies,
and nothing here killed a process. One success-path call is not that proof.
The honest upgrade path is a deliberate mid-flight kill test, which costs
another billable generation and was not authorized.

## Open items

```
FAL LIVE CANCEL            NOT_TESTED
FAL LIVE RECONCILIATION    NOT_TESTED
FAL LIVE CRASH RECOVERY    NOT_TESTED
FAL WEBHOOK AUTH           EXTERNAL_PENDING
FAL SETTLEMENT             DEFERRED_TO_PHASE_10
```
