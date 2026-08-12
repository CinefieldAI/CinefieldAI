# Model Routing and Capabilities — Phase 7 (7-A / 7-F / 7-B / 7-C / 7-D / 7-E)

Status: implemented. Scope is deliberately narrow — read "What this is NOT"
before extending anything here.

## The two questions, kept apart

Cinefield answers two different questions about a model, and this phase exists
largely to stop them being answered by the same code.

| Question | Owner | Source of truth |
| --- | --- | --- |
| What can this model do? | Capability Registry | `src/lib/orchestration/model-registry.ts` — the LIVE authoritative contract |
| Where will this generation run? | Production Model Router | `src/lib/routing/` + the `model_routes` table |
| What could this model do when that attempt ran? | DB capability snapshot | `model_versions.capabilities` — audit/correlation only, **never** authority |

### The client contract

A client sends a **Cinefield model id** and generation parameters. It does not
send, and has no field for, a provider, a provider endpoint, a route, a health
policy or a failover policy. This is enforced by the types (`RouteRequest` and
`GenerationCreateRequest` have no provider field) and, since the 7-F closure,
by the browser bundle itself, which contains no provider identity at all.

### Two different things both called "pricing"

`model_pricing` is **provider routing cost metadata** — what a provider charges
Cinefield per unit. Phase 10 pricing is **customer credit truth** — what a user
is charged. They are separate systems and must not be merged; this phase
deliberately did not recreate or extend `model_pricing`.

Mixing them is how "this model supports 4K" quietly becomes "this model
supports 4K on whichever provider happened to be healthy" — which is not a
property of the model at all. Nothing in the capability registry knows a
provider's health, cost or priority; nothing in the router describes a
capability.

## 7-A — the data model

`supabase/migrations/20260817000000_model_routing.sql`

```
providers          id (text PK), label, enabled
models             id (text PK = Cinefield model id), generation_type, lifecycle
model_versions     model_id + version (unique), status, capabilities snapshot
provider_models    (provider_id, provider_model_id) unique, enabled
model_routes       model_id, model_version_id, provider_model_id,
                   enabled, priority 0..10000, status
```

Facts worth stating because they are easy to get wrong later:

- **`lifecycle` is not a boolean.** `preview` and `deprecated` are both usable
  states an `enabled` flag cannot express, and collapsing "deprecated but
  running" into "disabled" switches a model off by accident.
- **One active version per model**, enforced by a partial unique index. Two
  active versions makes "the current version" a question with two answers.
- **`generation_attempts` gained `model_version_id` and `model_route_id`,
  both nullable, both `ON DELETE SET NULL`.** Attempts are billing and audit
  evidence: deleting a route must never delete the record of what ran.
- **RLS is enabled with no permissive policy.** `anon` and `authenticated` are
  revoked; only the service role reads these tables. A browser cannot see the
  route table at all.
- **`model_pricing` was NOT recreated.** It already exists
  (`20260812000000_model_pricing.sql`) and already separates provider unit
  cost from credit price. A second pricing table would be a second source of
  truth for money.

The seed is derived from the code registry — same 16 models, same provider
model ids, every route enabled at priority 100.

## 7-F — the capability registry as one source of truth

`src/lib/orchestration/capability-projection.ts` projects each registry entry
into a public-safe descriptor, served by `GET /api/models` (authenticated).

```
model-registry.ts   (live authoritative contract, server-only)
      |
      +--> capability-validator.ts        server-side validation (AUTHORITY)
      |
      +--> capability-projection.ts       public-safe descriptor
                |
                +--> GET /api/models                       (runtime, server)
                +--> public-model-catalog.ts  (generated)   (build, browser)
                          |
                          +--> orchestration-models.ts
                          +--> imageModelCapabilities.getCapabilities()
                                    |
                                    +--> /generate image cards
```

**Why a generated file and not a direct import.** The projection is derived
from the registry, which also holds `providerId` and `providerModelId`.
Importing the projection from a client component evaluates the registry in the
browser and ships `fal-ai/flux/schnell` and friends in the bundle. So the
projection runs at build time (`npm run catalog:generate`) and only its output
is committed. `public-model-catalog.ts` is a **build artifact, not a second
source of truth**: a test regenerates it in memory and fails if the committed
file differs, so a registry change that was not regenerated breaks the suite
instead of drifting quietly. Verified after `npm run build` — zero occurrences
of `fal-ai/flux` under `.next/static`, twelve under `.next/server`.

The projection builds its output **field by field** rather than spreading the
registry entry, so a field added to the registry is never exposed by accident.
Not projected: `providerId`, `providerModelId`, route priority, cost, health,
adapter hints.

`isMock` **is** projected, and deliberately so. It names no provider, endpoint,
cost or route — only "this model never reaches a real provider", which the
browser already tells the user after a mock run. Keeping it out would have
forced the client to re-derive it from a hand-maintained list, which is exactly
the duplication this projection exists to end.

### The UI is bound to the same contract (7-F closure)

Two surfaces render model controls, and both are bound.

**`PromptBar.tsx`** is what /generate actually renders in image mode. It looks
up `getPublicModel(model)`; when that returns a descriptor the aspect-ratio and
resolution lists come from it, and an effect **coerces the current selection**
into the contract. Offering the right options is not enough on its own — the
old bar showed Nano Banana Pro a fixed "2K" chip while the shared resolution
state still held `1080p`, so the chip was describing a value the request did
not carry.

**`getCapabilities(modelName, modelId)`** in
`src/components/landing/createImage/imageModelCapabilities.ts` is the
chokepoint for the card-driven panels (`CinemaStudioImagePanel`, `ImageForm`).
Same rule: executable fields replaced by canonical values, presentation
untouched.

What this fixed, concretely — each of these produced a real
`CAPABILITY_NOT_SUPPORTED` refusal from the server:

- Nano Banana Pro sent `resolution: "1080p"`, which the model does not accept,
  because the "2K" chip never wrote to the state the request read.
- Its batch stepper defaulted to **4 of 10**; the registry allows **1**.
- Nano Banana 2 Lite offered 1K/2K/4K; the registry accepts **1K only**.
- Every bound control offered an **"Auto"** aspect ratio no model declares.

Observed live at `/generate` after the change: Nano Banana Pro's row reads
`16:9 | 2K | 1/1`, its ratio panel no longer lists Auto, and its resolution
panel lists 1K/2K/4K. Video mode is byte-for-byte unchanged
(`Cinema Studio 3.5 | 16:9 | 1080p | 8s`).

One nuance worth recording: `AspectRatioDropdown` renders only ratios it has
preview shapes for, so the registry's `2:3`, `3:2`, `4:5` and `5:4` are not
shown. That is a **subset** of what the model supports — every option offered
is accepted — not a superset, which is the direction that breaks.

Cards with no server-side model — most of the /generate catalog, including
every video model — are untouched. They cannot execute, so there is no contract
for them to drift from; binding them to a registry entry they do not have would
be the bug, not the fix.

`src/lib/orchestration/orchestration-models.ts` was a hand-maintained map of
sixteen models repeating each one's generation type **and provider**, under a
comment asking whoever edited it to keep the ids in sync. It is now derived
from the generated catalog, and `getOrchestrationProvider()` is deleted — the
browser has no way to name a provider.

`src/lib/orchestration/generation-settings-mapper.ts` was extracted so the
creation boundary and the orchestrator read `aspect_ratio`, `resolution` and
the `image_count` fraction through **one** mapping. Copying it would have been
the mistake: two readings of `image_count` that disagree by one produce a
request creation accepts and execution refuses.

Capability validation now runs in `createGeneration`, before the row exists,
before the workflow starts, before any provider is contacted.

## 7-B — the router

`src/lib/routing/model-router.ts`

Static priority, highest wins. Ties break by provider model id, then route id
— arbitrary but **stable and total**, which is the only property a tie-break
needs. `selectRoute()` is pure; `resolveRoute()` adds the database read.

Eligibility is a conjunction: route enabled → route status active → model not
disabled → version not disabled/deprecated → provider enabled → provider model
enabled → **the provider has a registered adapter in this deployment**. That
last check is not redundant: operators edit the database, adapters ship with a
deploy, and the two move at different speeds.

When nothing is eligible the caller gets a reason per candidate
(`route_disabled`, `provider_disabled`, `provider_not_registered`, …), because
the operational question is never "did it fail" but "which switch is off".

**The router refuses; it never guesses.** No eligible route produces the typed
`NO_ELIGIBLE_ROUTE` error (503, not retryable) **before** the generation row is
created. No provider is called, and no durable generation exists that nothing
can ever run.

### Where the decision lives

`createGeneration` persists the selection into `generations.metadata.routing`
(routeId, modelVersionId, modelVersion, providerId, providerModelId,
selectionReason, selectedAt). `describeGeneration` reads it back, so the
provider that **executes** is the one the router chose — not whatever the
registry would resolve to at execution time. A generation created before
routing existed carries no `routing` key and falls back to the registry, which
is exactly the previous behaviour.

The attempt row records `model_version_id` and `model_route_id` for
correlation only. Nothing downstream reads them to decide behaviour.

### A client cannot name a provider

`RouteRequest` has no provider field, and neither does
`GenerationCreateRequest`. This is enforced by the type, not by a filter, and
asserted in the test suite.

## Route administration

`src/lib/routing/admin-route-service.ts` — three operations: list, enable /
disable, set priority.

**The authorization boundary fails closed.** This repository has no admin role,
no admin claim, and no admin UI. Rather than invent a role system as a side
effect of a routing phase, or ship mutations with no boundary at all, every
operation is gated on an explicit allowlist:

```
ROUTE_ADMIN_CLERK_USER_IDS=user_xxx,user_yyy
```

Unset — its state today — means **nobody** is an admin and every mutation
throws `FORBIDDEN`. The value is read, never logged.

**This is a TEMPORARY, INTERNAL Phase 7 authorization boundary.** It is not the
admin model this platform will end up with; a Clerk organization role almost
certainly is. Final admin governance — a real role source, an Admin Operations
Center, an audit trail — belongs to the later Admin/Security phase (Phase 16)
and is deliberately not started here. The allowlist exists so route mutations
are not shipped with no boundary at all while that decision is unmade.

## 7-C — health-aware routing, circuit breaker, safe failover

### The pipeline

```
Hard Eligibility  (7-B, unchanged)   route/model/version/provider enabled,
        |                            adapter registered — a conjunction
        v
Health Evaluation (Redis A)          breaker state, rolling error rate,
        |                            rolling latency, freshness
        v
Circuit Breaker                      OPEN excludes; HALF_OPEN admits a
        |                            bounded number of REAL requests
        v
Health Score                         priority 1.0, error 0.35, latency 0.15,
        |                            × confidence factor
        v
Deterministic Selection              highest score, ties -> the 7-B comparator
```

**Health can only subtract.** It reorders and it excludes. It can never admit
a route hard eligibility rejected — `rejectionFor()` from the static router is
called first, unchanged, and a disabled provider stays disabled no matter how
good its telemetry looks.

**With no health data, 7-C IS 7-B.** Proven by a test that runs both routers
over the same candidates and asserts the same winner. This is what makes a
Redis outage a degradation rather than an incident.

### Active factors, and what is absent

Active: static priority, rolling error rate, rolling latency, breaker state.

**Cost and quality are absent, not zero-weighted.** There is no cost term and
no quality term in `scoreRoute()` — asserted by a test that reads the function
body. Adding them is Phase 7-D, and the per-axis breakdown is what makes that
a widening rather than a rewrite.

**Deterministic.** Same candidates + same health + same exclusions = same
route. No randomness, no round-robin, no weighted sampling. Ties fall through
to the Phase 7-B comparator, which is a total order.

### Redis A health state

| Key | TTL | Holds |
| --- | --- | --- |
| `cinefield:v1:circuit-breaker:<provider>:<encodedProviderModel>` | 1800s | breaker record |
| `cinefield:v1:provider-error-rate:<provider>` | 300s | rolling success/failure counts |
| `cinefield:v1:provider-latency:<provider>` | 120s | rolling latency aggregate |

Breakers are scoped to the provider **model**, not the provider: one endpoint
failing is the common case, and tripping every route through that provider
would turn a narrow outage into a total one. `providerModelId` is hex-encoded
into the key alphabet, so `a/b` and `a.b` cannot collide.

The breaker TTL is deliberately longer than the signals it derives from: an
expired breaker key reads as CLOSED, so a TTL shorter than the cooldown would
silently reopen a provider Cinefield had just decided to stop using.

**Nothing durable, nothing sensitive.** No generation, no attempt, no billing
fact, no credential, no prompt, no media, no provider payload. Losing the
whole keyspace costs a fresh start at CLOSED. A test asserts the serialized
breaker record contains only its eight declared fields.

### When telemetry is unavailable or stale

- Missing data becomes **UNKNOWN** — never a fabricated healthy or unhealthy
  state, and never a fabricated breaker.
- UNKNOWN scores **neutral** on each axis (an unmeasured route has not been
  slow; it has been unmeasured) and takes a small confidence penalty, so
  known-good beats unmeasured and unmeasured beats known-bad.
- An unmeasured route stays **selectable**. A cold Redis must not take the
  platform offline.
- A breaker record older than 900s stops being authoritative — a stale OPEN
  from an incident that ended must not become a permanent capacity loss.
- Corrupted breaker JSON is read as **absent**, never as OPEN: one bad write
  must not take a provider out of rotation with no failure behind it.

### Circuit breaker

| State | Behaviour |
| --- | --- |
| `CLOSED` | routing allowed; 3 consecutive qualifying failures open it |
| `OPEN` | excluded from selection for a 60s cooldown |
| `HALF_OPEN` | ONE trial at a time, enforced by an atomic Redis lease; 2 successes close it, 1 failure reopens it and restarts the cooldown |

**The single-flight bound is a lease, not a counter.** The first implementation
kept an in-flight counter inside the breaker record and updated it
read-modify-write, so two workers reaching a cooled-down breaker both read zero
and both proceeded — and the counter was never incremented from the routing
path at all, so HALF_OPEN in fact admitted the entire backlog. A counter cannot
fix this: any read-then-write across a network round trip has a window. The
admission decision must BE the atomic operation.

`half-open-probe.ts` claims `cinefield:v1:lock:breaker-probe:<provider>-<model>`
with `SET NX EX` through the existing `distributed-lock` primitive. Exactly one
caller can create the key. The rest re-select with that route excluded and go
somewhere healthy. The lease is NOT released at the end of selection — it
expires on a 30s TTL, which makes it a rate limit on trials rather than a mutex
around one function call, and a worker that dies mid-probe costs one interval
rather than a deadlock. Unreachable Redis denies the probe (fail-closed);
that path is only reached after a breaker was successfully read, so it means
"cannot coordinate", and uncoordinated trial traffic is the thing being
prevented.

OPEN becomes HALF_OPEN by the passage of time, computed on read — so a breaker
recovers even if nothing ever writes to it again, instead of staying open
forever because the thing that would have reset it was the traffic it blocked.

**No synthetic probes.** Recovery evidence is ordinary user traffic that was
going to be sent anyway. A probe would be a billable request Cinefield
invented, which is a way to spend real money on an outage. Asserted by a test
that the breaker modules never resolve an adapter, submit, or fetch.

### Failure classification

Only these count against a provider: `provider_rate_limit`,
`provider_server_error`, `provider_unavailable`, `transport_timeout`,
`provider_execution_failure`.

These never do:

- **local validation** — an unsupported ratio is not the provider's fault
- **user cancellation** — a person pressing cancel must not take a provider down
- **internal failure** — Cinefield's storage or database breaking
- **provider rejection** (auth, quota) — real problems, but they do not heal
  after a cooldown, so a breaker would flap forever while the fix is an
  operator updating a credential
- **unknown** — an unclassified failure is far more often a Cinefield bug than
  a provider outage; letting unknowns open breakers means the first unhandled
  error type takes routing down with it

### Safe failover

A failover is a **second provider execution**. It is permitted only when
Cinefield can prove the first one never started. `decideFailover()` evaluates,
strictly in this order:

1. `provider_job_id` present → **reconciliation_required**
2. `submission_evidence = "job"` → **reconciliation_required**
3. `submission_evidence = "ambiguous"` → **reconciliation_required**
4. error code does not prove no job was created → **reconciliation_required**
5. local failure → **no_failover_local_failure** (another provider fixes nothing)
6. attempt or route bounds reached → **failover_exhausted**
7. otherwise → **safe_to_failover**

The order is itself the safety property. Evidence is examined before attempt
counts and route availability, so a system with retries to spare can never
reach a retry decision for an ambiguous submission.

When failover proceeds: **the `generation_id` never changes**. A new attempt
row is created under the existing 6R rules, the failed attempt keeps its own
row, evidence and error code, the new route is written to
`generations.metadata.routing` (so execution actually goes elsewhere), and the
already-tried route is excluded — read from attempt history, not tracked in
the workflow, so a replay cannot re-select a burned route.

Bounded at **one** failover per generation (`MAX_FAILOVER_ATTEMPTS = 1`).

### AMBIGUOUS != SAFE TO RETRY

This is the rule the phase exists to enforce. If a submission may have reached
a provider but the acknowledgement is uncertain, Cinefield does **not** fail
over, does **not** create a second logical generation, and does **not** start a
second provider execution. The generation keeps its id and its attempt
correlation and enters reconciliation instead. Ambiguity is also not breaker
evidence — the work may have succeeded and only the acknowledgement was lost.

Global invariant, preserved and re-proven against real PostgreSQL:

```
1 logical request = 1 generation_id = max 1 billable settlement
1 generation_id  -> N provider attempts   (allowed)
1 logical request -> N generations         (never)
```

### Ownership, unchanged

| Concern | Owner |
| --- | --- |
| generation lifecycle, retry, cancellation, finalization | **Temporal** |
| critical command transport | **AWS SQS + DLQ** |
| provider execution | **Provider Worker** |
| durable truth (generations, attempts, routes, audit) | **PostgreSQL** |
| ephemeral health state | **Redis A** |
| BullMQ | **Redis B** — untouched by 7-C |

The router decides **where**. It is not a workflow engine: a test asserts the
routing modules import no Temporal, no SQS, and no provider adapter.

## 7-D — cost-aware and quality-aware routing

### The full pipeline

```
Hard Eligibility  (7-B)      route/model/version/provider enabled, adapter present
        |
        v
Circuit Breaker   (7-C)      OPEN excludes; HALF_OPEN needs the atomic probe lease
        |
        v
Health            (7-C)      error rate, latency, confidence
        |
        v
Cost              (7-D)      provider execution cost for THIS request
        |
        v
Quality           (7-D)      trusted evaluation signal — inert today
        |
        v
Deterministic Tie-Break      score, then the 7-B comparator
```

**Safety precedes optimization, and the ordering is structural rather than a
matter of weights.** Eligibility and the breaker run before scoring and can
veto; nothing in the scorer can revive what they rejected. A cheaper or
better-rated route that is disabled, incompatible, or behind an open breaker
never reaches the scoring function at all. Tests assert this for both axes.

### Two things called "cost", and they are not the same system

| | Phase 7-D | Phase 10 |
| --- | --- | --- |
| Column | `model_pricing.provider_unit_cost` | `model_pricing.credit_price_per_unit` |
| Question | where should this run? | what does the user pay? |
| Owner | the router | the credit/wallet system |

The routing modules read **only** the provider side. `creditPricePerUnit`
appears nowhere in `routing-cost.ts` or `route-scoring.ts`, the router imports
nothing matching credit/wallet/ledger/stripe, and a test enforces both. Changing
a routing price can change the selected route; it cannot move a balance.

### Cost normalization

Source: the existing `model_pricing` table — server-only under RLS, versioned,
one active row per model, already separating provider cost from credit price.
**No second pricing table was created.** Routing reads it by
`(provider, provider_model_id)` rather than by `platform_model_id`, because two
routes for the same model may run on different providers.

| State | Meaning |
| --- | --- |
| `known` | verified, active, fresh, comparable currency |
| `stale` | verified more than 180 days ago — reported, but discounted |
| `unknown` | no active row, unusable currency, corrupt value, or uncomputable units |

**UNKNOWN COST != ZERO COST.** An unpriced route is not free; it is unpriced.
It scores *neutral* on the cost axis and takes a confidence discount, so a
verified-free route beats an unpriced one while an unpriced route stays
selectable. Scoring it zero would be worse than useless today — `model_pricing`
contains four rows, all mock models at a verified zero, so **every real provider
route is currently UNKNOWN** and excluding unpriced routes would disable
production routing entirely.

A price in a currency the policy cannot compare is UNKNOWN rather than
converted: conversion needs an exchange rate nobody has set, and inventing one
to make a comparison work is the fabrication this phase forbids.

### Quality — CONTRACT_READY_BUT_NO_TRUSTED_SIGNAL

The router can consume a trusted quality signal. It does not produce one, and
today it receives none.

`NO_TRUSTED_QUALITY_SOURCE` returns `null` for every model. That is not a stub
awaiting a plausible number — it is the correct implementation for a platform
with no evaluation system, and a test asserts it stays that way. Producing and
governing scores is **Phase 22**.

Provenance is checked first and hardest: `trustedEvaluators` is **empty**, so a
signal from an unnamed or unlisted evaluator is discarded as UNKNOWN rather than
downgraded — "we do not trust this source" is a different statement from "this
source is unsure". Thin (< 20 samples), unconfident (< 0.7) or stale (> 90 days)
signals become `low_confidence`.

**UNKNOWN QUALITY != LOW QUALITY.** Both `unknown` and `low_confidence` score
*neutral*. An unevaluated model has not scored badly; it has not been scored, so
it competes on its other merits and gains no fabricated advantage.

### One policy, no scattered constants

`src/lib/routing/routing-policy.ts` holds every weight and threshold.

| Weight | Value | Why |
| --- | --- | --- |
| staticPriority | 1.0 | the operator's explicit instruction; optimization does not overturn it |
| errorRate | 0.35 | a route that fails is worse than one that is slow, and costs a retry too |
| latency | 0.15 | |
| cost | 0.2 | a cheaper provider that fails more is not a saving |
| quality | 0.25 | declared for Phase 22; multiplies a neutral 1.0 today |

`staticPriority > cost + quality` is asserted by a test. The policy is static
and server-managed: no environment reads, no flag client, no runtime override —
that is Phase 7-E / Phase 21.

### Explainability

`RouteEvaluation` records eligibility, rejection reason, health, breaker state,
cost (state + estimate + pricing version), quality state, every score axis, and
the tie-break reason. There is no single opaque number, because the question
asked during an incident is never "what was the score" but "why that one".

Provider economics stay server-side: the browser catalog carries no cost, price,
credit or quality field, and the routing modules are `server-only`.

## 7-E — runtime routing controls and the emergency stop

### Seven questions, seven owners

| Layer | Question | Source |
| --- | --- | --- |
| Capability Registry | what can this model do? | `model-registry.ts` |
| Durable Route Config | is this route configured to be available? | PostgreSQL `model_routes` etc. |
| Runtime Route Flag | has an operator temporarily turned this off? | Redis A `routing-control` |
| Circuit Breaker | has this route been failing? | Redis A `circuit-breaker` |
| Health | how is it performing? | Redis A error rate / latency |
| Cost | what does it cost to run? | `model_pricing`, provider side |
| Quality | how good are its results? | Phase 22, not yet produced |

### Final evaluation order

```
Model Capability
   -> Durable Eligibility        (PostgreSQL: enabled, status, lifecycle, adapter)
   -> Runtime Flags / Kill       (operator override — structural exclusion)
   -> Circuit Breaker            (OPEN excludes; HALF_OPEN needs the probe lease)
   -> Health                     (error rate, latency, confidence)
   -> Cost                       (provider execution economics)
   -> Trusted Quality            (inert until Phase 22)
   -> Deterministic Selection    (score, then the 7-B comparator)
```

A runtime-disabled route is excluded **before anything is scored** — its
evaluation carries no score at all, asserted by a test. It cannot be rescued by
better health, lower cost, higher quality, or a higher static priority.

### Tighten only, never loosen

```
effective_availability = durable_enabled AND NOT runtime_disabled
```

A control can take a route out of rotation. It can never put one back in — the
`RuntimeControl` type has no "enable" shape, so a route disabled in PostgreSQL
stays disabled whatever any flag says. That asymmetry is the safety story: a
misconfigured, compromised or simply unavailable flag layer can only ever
*reduce* what production can reach.

### Flag targets and hierarchy

`model:<id>` · `provider:<id>` · `provider-model:<id>` · `route:<id>`

A control on a provider excludes every route through it — "stop sending
anything to fal" is one action, not an operator editing rows during an
incident. The narrowest matching level is what the decision reports.

### Source, availability and TTL

No OpenFeature or LaunchDarkly package is installed and no credentials exist,
so `RuntimeFlagSource` is an **interface** a real SDK can implement later, and
the shipped implementation reads Redis A — a real mechanism an operator can use
today rather than a fake provider that returns whatever a test wants.

Evaluation source is recorded on every decision: `database_baseline` (no
override layer), `runtime_flag`, `cached_runtime_flag`, `unavailable`.

> **Stated plainly, so it cannot be misread as a guarantee:** the runtime
> emergency kill is **NOT durable**. It holds only while the runtime-control
> source is reachable. There is no last-known-good cache and no secondary
> enforcement path. A kill that must survive a Redis outage has to be a
> **durable disable in PostgreSQL** — `model_routes.enabled = false`, or the
> provider/provider-model equivalent — which eligibility reads on every
> routing decision.

**When Redis cannot be read**, the source returns `unavailable` with no
controls and the durable PostgreSQL configuration governs alone. The trade-off
is stated rather than hidden: an emergency kill set two minutes ago stops being
enforced while Redis is down. Failing the other way — treating an unreachable
cache as "everything is killed" — would take the entire generation platform
offline whenever an optional cache blipped, and a routing override layer must
never cause a larger outage than the thing it protects against. The gap is
bounded by design: the kill is the FAST path, and the durable path is disabling
the route, provider model or provider in PostgreSQL, which survives a Redis
outage because eligibility reads it on every decision. **Anything that must
hold while Redis is down belongs in PostgreSQL.**

A partial read is discarded entirely rather than served — a partial view looks
authoritative while missing controls. Corrupt data is treated as absent, so one
bad write cannot cause an unexplained outage.

Controls carry a **1-hour TTL**. An emergency kill that outlives its incident
is a silent capacity loss nobody remembers to undo; expiry forces the decision
to be re-made or moved into PostgreSQL where it belongs permanently.

### Runtime disable != provider cancellation

A control changes which routes FUTURE decisions may choose. It does not touch a
running generation, does not signal Temporal, does not ask a provider to stop,
and does not mutate a single historical attempt. A job already accepted by a
provider stays accepted; stopping it is the cancellation path, a different
system with different safety rules.

### Runtime disable does not override AMBIGUOUS submission safety

Killing provider A while A's submission is ambiguous does **not** authorize
running provider B. `decideFailover` evaluates evidence first and returns
`reconciliation_required`; the failover policy has no flag parameter and no
flag import, so there is no path by which a kill switch could become an input
to that decision. Tested explicitly.

### Flags and the breaker stay separate

Different questions — "a person decided this must not be used" versus "this has
been failing" — kept apart in types, storage (`routing-control` vs
`circuit-breaker` keyspaces), rejection reasons (`runtime_disabled` /
`emergency_kill` vs `circuit_open`) and explanation metadata. Merging them would
make a deliberate operator decision look automatic, and an outage look like
policy.

### Who may set one

The same fail-closed `ROUTE_ADMIN_CLERK_USER_IDS` allowlist as every other route
mutation — empty today, meaning nobody. A kill switch must not have a weaker
gate than the priority slider beside it.

**There is no HTTP route and no MCP tool that can write a control**, asserted by
a test that walks every file under `src/app/api`. A kill switch reachable by an
agent is a kill switch that will eventually be pulled by one. Full flag
management UX is Phase 16/21.

## What this is NOT

Explicitly out of scope, and absent rather than stubbed:

- **Phase 22**: quality score production, Braintrust, golden datasets,
  evaluators, regression gates. The router consumes; Phase 22 produces.
- **Phase 21**: flag governance — approval workflows, expiry policy, a flag
  registry, canary percentages, SLO-driven rollback, experimentation, MCP
  writes. Phase 7-E is the router-side consumer contract and nothing else.
- **7-E / Phase 21**: LaunchDarkly, OpenFeature, canary rollout.
- **Phase 8**: real provider API calls, credentials, paid smoke tests.
- **Phase 10**: Stripe, credit wallet, ledger, pricing engine.

## Known gaps, stated rather than hidden

1. **`/image/create`'s `PromptComposer` is not bound.** It calls
   `getCapabilities(selectedModel)` with a display name and no model id, so it
   still uses presentation lists. None of its cards is executable today, and
   that page sits outside the narrow /generate unlock. Binding it is a
   one-argument change the day one of its models becomes real.
2. **`PromptBar.tsx`'s video-model constants were left in place.** Its
   per-model ratio/resolution lists for Kling, Sora, Wan, Minimax, Higgsfield
   and Gemini Omni Flash describe cards with **no server-side model**, which
   cannot reach `/api/generate` at all. They decide nothing, so rewriting them
   would be churn on a frozen page. The canonical lookup sits in front of them:
   the moment one of those models gets a registry entry, it binds through the
   same path with no further edit.
3. **No admin UI, and no real admin role source.** See above.
4. **`model_versions.capabilities` is a snapshot, not the live contract.** The
   code registry remains authoritative; the column exists for audit and for
   reasoning about an attempt that ran months ago. Nothing reads it to make a
   capability decision — the router reads only `status`.

## Proofs

- `src/test/e2e/phase-7-routing.e2e.test.ts` — 21 tests: registry↔seed drift,
  determinism over 200 runs, tie-break stability under shuffled input, every
  rejection reason, refusal before row creation, projection safety, admin
  fail-closed, and three end-to-end runs through the real repository and
  create service.
- `src/test/e2e/phase-7-capability-contract.e2e.test.ts` — 9 tests: the
  generated catalog matches the registry, the browser catalog names no
  provider, every option a bound card offers is accepted by the real
  validator, a manipulated request is still refused, unbound cards are
  returned untouched.
- `src/test/e2e/phase-7e-runtime-flags.e2e.test.ts` — 30 tests: the four
  durable×runtime combinations, the provider/provider-model/model/route
  hierarchy, optimization never bypassing a flag, flags and the breaker staying
  separate, ambiguous-submission safety under a kill, source unavailable /
  partial / corrupt behaviour, and the security boundary.
- `src/test/e2e/phase-7d-cost-quality-routing.e2e.test.ts` — 38 tests: cost
  normalization and every unknown/stale/invalid path, cost-aware selection,
  cost and quality both losing to a breaker and to eligibility, the empty
  trusted-evaluator allowlist, unknown-is-not-low, determinism, the billing
  separation, and "no fabricated price or quality was seeded".
- `src/test/e2e/phase-7c-half-open-concurrency.e2e.test.ts` — 10 tests: 20
  simultaneous probe claims yield exactly one grant, repeated over 50 rounds;
  per-provider-model isolation; stale-owner protection; fail-closed on an
  unreachable Redis.
- `src/test/e2e/phase-7c-health-routing.e2e.test.ts` — 49 tests: static
  compatibility, determinism over 100 runs and 4 shuffles, health/latency/error
  influence, eligibility supremacy, every breaker transition, freshness,
  failure classification, the full failover decision table including the
  ordering property, Redis A round-trip and corruption handling, and the
  security boundary.
- `supabase/tests/test_model_routing.sql` — 8 proofs against a throwaway
  PostgreSQL: one-active-version, unique version numbers, unique provider
  endpoints, unique routes, bounded priority/status, additive attempt
  correlation surviving route deletion, RLS closed, and Phase 6R attempt
  semantics intact (unique indexes, the single `generations` foreign key,
  `generation_id NOT NULL`, exactly one attempt table).
  Run with `bash supabase/tests/run_pg_tests.sh`.
