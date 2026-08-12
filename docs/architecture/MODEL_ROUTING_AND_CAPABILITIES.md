# Model Routing and Capabilities — Phase 7 Foundation (7-A / 7-F / 7-B)

Status: implemented. Scope is deliberately narrow — read "What this is NOT"
before extending anything here.

## The two questions, kept apart

Cinefield answers two different questions about a model, and this phase exists
largely to stop them being answered by the same code.

| Question | Owner | Source of truth |
| --- | --- | --- |
| What can this model do? | Capability Registry | `src/lib/orchestration/model-registry.ts` |
| Where will this generation run? | Production Model Router | `src/lib/routing/` + the `model_routes` table |

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

The projection builds its output **field by field** rather than spreading the
registry entry, so a field added to the registry is never exposed by accident.
Not projected: `providerId`, `providerModelId`, route priority, cost, health,
adapter hints, `isMock`.

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
throws `FORBIDDEN`. An allowlist is not the admin model this platform will end
up with (a Clerk organization role almost certainly is); it is the honest
placeholder while that decision is unmade. **Phase 16's Admin Operations
Center is not built here.**

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

1. **The frozen `/generate` UI still hardcodes capabilities.**
   `src/components/cinema-studio/CinemaStudioWorkspace.tsx` and `PromptBar.tsx`
   carry their own aspect-ratio and resolution lists. `GET /api/models` exists
   and is correct, but AGENTS.md freezes that page absent an explicit unlock,
   which this phase does not grant. Until it is consumed, the UI and the server
   can still drift — the server simply refuses what the UI wrongly offered.
2. **No admin UI, and no real admin role source.** See above.
3. **`model_versions.capabilities` is a snapshot, not the live contract.** The
   code registry remains authoritative; the column exists for audit and for
   reasoning about an attempt that ran months ago.

## Proofs

- `src/test/e2e/phase-7-routing.e2e.test.ts` — 21 tests: registry↔seed drift,
  determinism over 200 runs, tie-break stability under shuffled input, every
  rejection reason, refusal before row creation, projection safety, admin
  fail-closed, and three end-to-end runs through the real repository and
  create service.
- `supabase/tests/test_model_routing.sql` — 7 proofs against a throwaway
  PostgreSQL: one-active-version, unique version numbers, unique provider
  endpoints, unique routes, bounded priority/status, additive attempt
  correlation surviving route deletion, RLS closed.
  Run with `bash supabase/tests/run_pg_tests.sh`.
