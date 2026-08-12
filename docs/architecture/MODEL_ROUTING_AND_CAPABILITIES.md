# Model Routing and Capabilities — Phase 7 Foundation (7-A / 7-F / 7-B)

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

## What this is NOT

Explicitly out of scope, and absent rather than stubbed:

- **7-C**: dynamic scoring, health/latency/cost input, circuit breakers,
  automatic failover, load balancing. The router is deterministic on purpose —
  a router that picks differently on two identical requests makes every
  downstream bug irreproducible.
- **7-D / Phase 22**: quality scoring, Braintrust, evals.
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
- `supabase/tests/test_model_routing.sql` — 8 proofs against a throwaway
  PostgreSQL: one-active-version, unique version numbers, unique provider
  endpoints, unique routes, bounded priority/status, additive attempt
  correlation surviving route deletion, RLS closed, and Phase 6R attempt
  semantics intact (unique indexes, the single `generations` foreign key,
  `generation_id NOT NULL`, exactly one attempt table).
  Run with `bash supabase/tests/run_pg_tests.sh`.
