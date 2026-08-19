# Cinefield Implementation Roadmap

Companion document to [`CINEFIELD_ARCHITECTURE_CONTRACT.md`](./CINEFIELD_ARCHITECTURE_CONTRACT.md). That file defines *what* the architecture should look like; this file tracks *what has actually been built* and *what order remaining work is planned in*.

**Everything under "Future Phases" below is target architecture.** No table, route, folder, or feature listed there exists in the repository today unless a completed checkpoint above it says otherwise. Do not build against a future phase's structure until that phase is actually reached and reviewed.

---

## Post-checkpoint status note

**This file's own checkpoint table below stops at commit `2c4e3db` and its
"Future Phase Order" table stops at Phase 13 — both are frozen at an early
point in this project and have not been kept current.** Substantially more
has since been built (Phases 6R, 7 through 16 in full, and Phase 17 in
part), tracked package-by-package as it lands in
[`../security-gates.md`](../security-gates.md) and in the phase-numbered
bullets of `CINEFIELD_ARCHITECTURE_CONTRACT.md`'s "CURRENT CINEFIELD
IMPLEMENTATION OVERRIDES" section — those two documents, not this one, are
current. This note exists only so Phase 17 is not silently absent from this
file, per an explicit instruction to keep this roadmap from misrepresenting
current reality; it is not a rewrite of the table below, which remains a
historical record of the project's early ordering and is out of scope to
correct here.

**Phase 17 — Cinefield Product Intelligence, official packages 17-A
through 17-E (authoritative master roadmap v1.9.1 TEMIZ MASTER EK F,
external to this repository):** 17-A (AI Director / model-specific Prompt
Compiler / multilingual intelligence / Workflow-Skill Engine / real
generation-admission integration) is **complete**. 17-B (Cinema Studio +
Marketing Studio + Soul/Character + Product workflows on one shared
generation core) is **partial** — the shared core is real where product
flows actually reach it, but not every named flow independently does. 17-C
(Virality analysis + Cinefield Supercomputer plan/approve/execute) is
**deferred** — neither virality analysis nor a real plan/approval/execution
flow exists yet. 17-D (MCP + Apps/Websites/Games Builders) is **deferred /
not applicable** — none of the four exist in this repository under any
name. 17-E (model/prompt promotion gated by a Phase 22 eval regression gate
+ Braintrust) is **deferred to Phase 22**, which does not exist yet. Full
detail, evidence, and file-by-file citations for every package: see
`security-gates.md`'s "Phase 17 Roadmap Reconciliation" section.

**Phase 18 — Infrastructure as Code & Drift Management, official packages
18-A through 18-D (authoritative master roadmap v1.9.2
PHASE15_UZLASTIRILMIS_MASTER, external to this repository):** an earlier
audit of this phase (preserved in git history) worked from this
repository's own pre-existing gate-table evidence alone, before the
authoritative roadmap was supplied, and correctly closed a stale `NOT_
STARTED` label (SQS IAM/worker message distrust, already done under
6R-C/12-D) — but that was an incomplete picture of what Phase 18 actually
is. 18-A (infra/ structure, Terraform as the canonical IaC engine, remote
state + locking, dev/staging/prod separation) is **code-complete** —
`infra/bootstrap/` now declares the S3 state bucket + DynamoDB lock table,
both environments declare a partial `backend "s3"` block — with the actual
bucket/table creation **live-external-required** (needs a real AWS
account). 18-B (controlled import of the hand-created production
resources) is **code-complete for the declarations**, with the import
itself correctly left undone — importing live production infrastructure
without a state backend and real credentials was explicitly out of this
batch's authorization. 18-C (CI fmt/validate/plan, human-approved
protected production apply) is **code-complete**: this repository's first-
ever `.github/workflows/` — `infra-ci.yml`, `infra-apply.yml`,
`infra-drift.yml` — with the GitHub environment-protection reviewer gate
itself live-external-required (a one-time repository Settings action).
18-D (drift detection + Alert Router integration + emergency runbook) is
**code-complete**: a real `terraform plan -detailed-exitcode` drift check,
a narrow ingestion route into the existing Phase 13-D alert system (never
a second alert channel), and `docs/operations/INFRA_EMERGENCY_RUNBOOK.md`
— with live drift-checking itself waiting on the same AWS account 18-A/
18-B need. Full detail, evidence, and file-by-file citations for every
package: see `security-gates.md`'s "Phase 18 — Infrastructure as Code &
Drift Management" section.

**Phase 19 — Policy-as-Code & Automated Action Guardrails, official
packages 19-A through 19-D (authoritative master roadmap v1.9.1 TEMIZ
MASTER EK F, the same version already used for Phase 17):** this batch
found and fixed a real, previously-undetected defect — the normative
`policies/cinefield/policy.rego` referenced a data path real OPA never
resolved, meaning the Rego suite had never actually passed under `opa
test` since Phase 12-E. 19-A/19-B (real OPA tooling, Rego test suite,
deterministic decisions, CI-required) are **code-complete**: OPA 1.19.1
installed and run for real, `opa test` 13/13, `opa build -t wasm` compiles
a real bundle, and `scripts/policy-wasm-parity.ts` proves the compiled
WASM and the embedded TypeScript evaluator agree on all 49 conformance
cases — this repository's second-ever `.github/workflows/`
(`policy-ci.yml`) enforces all of it on every `policies/**` change. 19-C
(wire deployment gate + admin/AI action points to policy, add decision
log) is **partial** — a closure audit found the first pass overstated
how much was actually wired (`routing.control.set/clear` were
policy-gated but unreachable from any real admin route; the REAL
provider/route-disable, DLQ-redrive and Temporal-cancel paths went
through Tier-0 only, never through policy). A closure-fix batch corrected
this: `requirePolicy()` is now the real, unconditional first gate in
`router-admin-service.ts`, `dlq-admin-service.ts`, and
`temporal-admin-service.ts`, and all three actions are now catalogued
two-person per the roadmap's own list — which also surfaced and fixed the
missing SECOND HALF of Phase 16-E's own dual-control mechanism (a real
caller for the `record_admin_privileged_action_approval` RPC never
existed; `decidePrivilegedAction` + `POST
/api/admin/privileged-actions/decide` are that caller now). The
`deployment.production.apply` registry entry and
`src/lib/deployment/deployment-policy-gate.ts` still wire the deployment
gate additively (Phase 14-D's `deployment-guard.ts` itself untouched) and
are now also correctly marked two-person in the registry, with real
enforcement ownership documented as CI/platform-external since no
application-level deploy-execution path exists in this repo to gate; the
decision log requirement is met by reusing the existing `security_events`
RPC chain (no new table, no migration anywhere in this batch either).
19-D (fail-safe, TTL/reversible/idempotent bounds, policy-change PR
governance) is **code-complete** for the fail-safe and CI-required-check
halves; TTL/reversible/idempotent runbook bounds on high-risk automation
remain the existing Phase 14/15 mechanisms, not duplicated here. A live
OPA sidecar/service (the literal text of 19-A) was deliberately **not**
stood up — `PolicyDecision.engine` stays `"embedded"` in every production
path; the WASM build is CI-proof only. Full detail, evidence, and
file-by-file citations: see `security-gates.md`'s "Phase 19 —
Policy-as-Code & Automated Action Guardrails" and "Phase 19 Closure Fix"
sections.

**Phase 20 — API & Event Contract / Schema Governance, official packages
20-A through 20-D (authoritative master roadmap v1.9.1 TEMIZ MASTER EK F,
the same version already used for Phases 17/19):** the reality audit found
20-A and 20-B **already essentially complete** from Phase 6R.15, predating
this batch — the event envelope standard, a 13-schema domain registry,
real producer validation, real consumer SerDe/compatibility checking, and
an honestly-disabled Glue stub, all exhaustively tested already. This
batch verified that (making one file's existing constant importable,
nothing else) and built what was genuinely missing. 20-C (OpenAPI
source-of-truth + generated TypeScript types) is **code-complete for an
honestly-scoped subset**: `openapi/cinefield.json` derives its 14 event
schemas directly from the real registry (never a hand-written duplicate)
plus 2 field-verified real HTTP routes (of ~40 total — coverage is
disclosed as partial, not fabricated as complete), and
`src/lib/contracts/generated/api-types.ts` is real, generated output
(via `openapi-typescript`, MIT-licensed, no paid service) proven
deterministic by re-running and diffing. 20-D (breaking-change CI gate) is
**code-complete**: `scripts/check-contract-compatibility.ts` reuses the
existing `classifyCompatibility()` (no second compatibility rule) to
catch an already-published event schema version mutated incompatibly in
place, proven by actually injecting and detecting a real breaking change
during this batch; `contract-ci.yml` (this repository's third contract/
governance CI workflow) wires that check plus a generated-artifact drift
check plus the real Phase 6R.15/11-A contract test suite as a required PR
gate. Live AWS Glue Schema Registry / MSK provisioning remains
deliberately deferred — Kafka/MSK is "activation-ready... not provisioned
before a scale signal arrives" per the roadmap's own words, the same
reasoning already established for Phase 18's infrastructure and Phase
19's OPA sidecar. Full detail, evidence, and file-by-file citations: see
`security-gates.md`'s "Phase 20 — API & Event Contract / Schema
Governance" section.

**Phase 20 corrective batch — event tenant context + HTTP breaking-change
detection:** closed the two real gaps the closure audit found. The
envelope gained an optional `tenantId` (chosen over `workspaceId` on a
codebase-wide terminology audit), threaded through the REAL producer
path — `outbox_events.tenant_id` (captured at write time, already
existing from this phase's own earlier migration) was never SELECTed by
`claim_outbox_events()`; a new migration
(`20260830000000_outbox_claim_tenant_id.sql`, `DROP`+`CREATE` since
Postgres refuses `REPLACE` across a changed `RETURNS TABLE` set) closes
that, and it now reaches the Kafka message as a `tenant-id` header,
exactly where `traceId` already travels. Bounded routing/correlation
evidence only — never auth, billing, or ownership authority. 20-D was
extended from Kafka-only to HTTP:
`scripts/check-openapi-compatibility.ts`, a narrow structural checker
(reusing the same `classifyCompatibility()` and the same
`CONTRACT_BASE_REF` baseline model already established) proven, by real
injected-and-reverted defects against the committed OpenAPI document, to
catch path removal, method removal, request narrowing, and response
narrowing, and proven separately to accept a new path, a new optional
request field, and a new optional response field as compatible. Wired
into `contract-ci.yml` as a fifth required step. Full detail: see
`security-gates.md`'s "Phase 20 corrective batch" subsection.

**Phase 21 — Runtime Feature Flags, Kill Switches & Safe Rollout, official
packages 21-A through 21-D (same master roadmap version):** generalizes,
never re-implements, the narrower flag mechanisms Phase 7-C/7-E (circuit
breaker, `RuntimeControl`) and Phase 14-F (the auto-remediation kill
switch) already pioneered — a repository-wide audit confirmed none of the
three was touched by this batch. 21-A is code-complete: a vendor-neutral
`FlagProvider` interface (`src/lib/feature-flags/flag-contract.ts`)
mirrors OpenFeature's own shape as Cinefield's OWN types, deliberately
without installing `@openfeature/server-sdk` or any `launchdarkly`
package — an existing Phase 7-E test already asserted `package.json`
should contain neither string, "the contract is an interface a real one
can implement." 21-B is code-complete: four new flags
(`maintenance_mode`, `feature.video.enabled`, `uploads.enabled`,
`release_stage`), admin-mutable at `/admin/feature-flags`, composed
through the SAME `requirePolicy()` → `authorizeTier0Action()` chain
`router-admin-service.ts` already established for `route.disable` — three
new actions registered in lockstep across `policies/data/actions.json`
and `tier0-action-catalogue.ts`, proven by `opa test` (13/13). Moving
`release_stage` to `"public"` specifically requires its own dedicated,
two-person-gated policy action, matching the roadmap's own "gerçek para
eşiği" framing for that one transition. 21-C is code-complete: a new
migration (`20260901000000_feature_flags.sql`) gives every flag change an
append-only audit row with actor/reason/ticket/expiry/rollback-value,
written atomically with the current-value update via one SECURITY
DEFINER function — expiry is lazy (read-time reversion to
`rollback_value`), never a scheduled writer, since no `schedules.task()`
exists anywhere in this repository. 21-D is **honestly partial**: the
canary-guardrail decision function
(`src/lib/feature-flags/canary-guardrail.ts`) is real and tested, reusing
Phase 15-A's own error-budget type — but its automatic, unattended
trigger is `LIVE_DEFERRED` (would require standing up a live Trigger.dev
schedule, new infrastructure this batch is not authorized to provision),
and no percentage-rollout flag type was added since no gradual-rollout
product surface exists yet to justify one. LaunchDarkly itself remains
`BUSINESS_DECISION_REQUIRED` — the same deferred-paid-backend pattern
already established for AWS Glue (Phase 20) and a live OPA sidecar
(Phase 19). Full detail, evidence, and file-by-file citations: see
`security-gates.md`'s "Phase 21 — Runtime Feature Flags, Kill Switches &
Safe Rollout" section.

**Phase 22 — AI Model Evaluation & Quality Governance, official packages
22-A through 22-D (same master roadmap version):** deepens Phase 7's
Router with real output-quality evidence rather than replacing any of its
scoring logic — a reality audit found Phase 7-D had already shipped the
entire consumption side of this signal (`resolveHealthyRoute()`'s own
`QualitySignalProvider` parameter, `scoreRouteComposite()`'s already-wired
`quality: 0.25` weight, `route-quality.ts`'s full contract, permanently
returning null with its own header naming Phase 22 as the implementer).
22-A/B are code-complete: a new migration
(`20260908000000_model_eval.sql`, `model_eval_runs` + append-only
`model_eval_results`) gives every evaluation run immutable identity and
durable, immutable per-case scores; the golden dataset itself is
deliberately source-controlled TypeScript
(`src/lib/eval/golden-dataset.ts`), not a database table, so a case change
stays a reviewable PR diff; seven scorer dimensions exist, four fully real
today (failure/latency/cost/safety, reusing Phase 15-B's `CostObservation`
and Phase 9-E's `ModerationResult` verbatim) and three judgment-requiring
ones (adherence/quality/consistency) behind a new, honestly-unfilled
`AiJudgeProvider` seam mirroring `QualitySignalProvider`'s own shape. 22-C
is code-complete and proven fail-closed live against this repository's own
Supabase connection: `scripts/check-model-eval-regression.ts` returns
`NOT_CONFIGURED`/exit 2 for missing config (including a required, never
defaulted, regression-threshold business value) and `NO_EVIDENCE`/exit 1
for an unmeasured candidate; `.github/workflows/eval-ci.yml` runs it on
`workflow_dispatch`, an explicitly disclosed gap from a fully-automatic PR
gate since no automated "which route changed" extraction exists yet. 22-D
is code-complete and genuinely live in production, safely: the real
`DurableEvalQualityProvider` now replaces the implicit
`NO_TRUSTED_QUALITY_SOURCE` default at `generation-create-service.ts`'s
real `resolveHealthyRoute()` call site — but `DEFAULT_QUALITY_POLICY
.trustedEvaluators` stays `[]` (an existing Phase 7-D test hard-asserts
this), so net production routing behavior is proven unchanged today
(173/175 of the full Phase 7/8 regression suite, the 2 failures pre-existing
and unrelated) while a real signal becomes readable the moment a human
deliberately trusts it — a disclosed, unmade business decision, not a
silent one. `/admin/model-quality` (read-only, no mutation surface) and a
pure, tested production-sampling function complete 22-D; Braintrust, a
live AI judge, the trust decision itself, and a live scheduled sampler all
remain deliberately deferred, each classified explicitly rather than
faked. Full detail, evidence, and file-by-file citations: see
`security-gates.md`'s "Phase 22 — AI Model Evaluation & Quality Governance"
section.

**Phase 22 corrective batch (post-closure-audit):** four real gaps found by
the Master Closure Audit, narrowly fixed. Manifest/compiler version now
travels from `GenerationManifest` into `generations.metadata.semanticVersion`
(no migration — the existing `routing`-metadata-key precedent) and from
there into a completed eval run's own metadata — real for
`POST /api/product-intelligence/execute`, still honestly absent for the
primary `POST /api/generate` path, which never compiles a manifest.
`SCORE_PASS_THRESHOLD`'s hardcoded `0.7` (found to have no roadmap source)
is gone; the per-case pass/fail cutoff is now a required, validated
`MODEL_EVAL_SCORE_PASS_THRESHOLD` env var, kept strictly separate from the
pre-existing `MODEL_EVAL_REGRESSION_THRESHOLD`, and a missing/malformed
threshold fails closed to `inconclusive`, never a fabricated pass. The Admin
Model Quality dashboard's `meanLatencyScore: null` stub and missing cost
field are gone — real mean-latency and currency-safe cost aggregates now
back the panel's own "quality/latency/cost" claim, and the panel now states
honestly whether its evidence is CI-scale or large enough for Phase 7's own
production-routing-confidence bar (today: CI-scale — 7 golden cases against
a real `minSamples` of 20, undisclosed no more, `minSamples` not weakened to
hide it). A new automatic PR gate
(`scripts/check-new-route-eval-evidence.ts`,
`.github/workflows/eval-ci.yml`'s new `pull_request`-triggered job) now
requires existing eval evidence before any new `(provider, provider model)`
pair can enter `model_routes` — audited directly against
`admin-route-service.ts` to confirm that migration file is genuinely the
only way a new pair can ever become routable, closing the "unmeasured
upgrade reaches production" gap the closure audit flagged; the
candidate-vs-baseline regression comparison itself stays a deliberate,
manual `workflow_dispatch` action, and marking the new gate a required
GitHub branch-protection check remains an external, human step.

**Phase 23 — Privacy, GDPR & Data Lifecycle Architecture, official packages
23-A through 23-D:** completes Phase 9's storage foundation with real data
subject rights — a reality audit found `media_assets` already carried four
unfilled Phase 23 hook columns (`data_class`/`retention_policy`/
`legal_hold`/`tombstoned_at`) and `policies/data/actions.json` already
registered `data.export`/`data.delete`/`retention.override`/
`legal_hold.set`/`legal_hold.clear` as `implemented: false, owner:
"phase-23"`, so this phase's job was building real handlers against an
already-reviewed policy contract, not inventing one. 23-A is
source-controlled TypeScript (`data-classification.ts`,
`processor-inventory.ts`), the same golden-dataset-as-code precedent
Phase 22 established. 23-B's `privacy_requests` + DSAR export is real
end-to-end (self-service request creation reads only the caller's own
verified Clerk identity; export bundles are bounded, delivered through the
existing `createPresignedDownload` signing path, and the raw export
object key is never selected by any read function — a real sensitive-data
defect this batch's own regression caught and fixed). 23-C's
`AccountDeletionWorkflow` anonymizes `profiles` without deleting the row
(every other table FKs to it; the credit ledger is deliberately untouched,
retained per its own immutable-record policy), tombstones/deletes
non-legal-hold media (a new `deleteAssetObject` R2 capability, separate
from the DR client which has no delete permission at all), and calls
Clerk through a dependency-injected seam never invoked live by this
repository's own tests; `restore-redelete-guard.ts` is the roadmap's own
named "restore re-delete control", real and tested with zero production
callers today (`LIVE_DEFERRED` — no live restore-execution path exists yet
to hook into, the same class of gap Phase 22's `production-sample.ts`
already disclosed). 23-D wires `data.export`/`data.delete` into BOTH the
OPA-mirrored policy gate and Tier-0 dual control — the one action pair in
this registry needing both `requiresHumanApproval` and `requiresTwoPerson`
simultaneously, resolved by running Tier-0 first (it is the real owner of
the approval evidence policy needs) and policy second, unconditionally,
immediately before real work — a deliberate, narrow, documented deviation
from the established "policy first" convention, not a bypass of either
gate. A narrow corrective batch closed the one real gap the Master
Closure Audit found — no retention-expiry cleanup mechanism existed —
by adding `retention-policy-resolver.ts` (pure class/row eligibility
logic, never inventing a duration) and `retention-cleanup-executor.ts`
(a real, `MANUAL_OPERATOR_CALLER`-only dry-run/execute mechanism,
registered today only for `media_assets`, reusing
`AccountDeletionWorkflow`'s own R2/tombstone seam). It ships fully inert:
every real `DATA_CLASSIFICATION_MATRIX` entry still has no
`retentionDurationDays` set, so no real row is deleted or anonymized by
it as shipped — activating it for any table is one reviewed data change,
not new code. The same batch corrected four tables' retention labels
(`security_events`, `admin_privileged_action_events`,
`feature_flag_audit`, `deletion_tombstones`) from "pending an audit-window
decision" to `retain_immutable`, having found each already carries a real
append-only trigger in its own migration. Full detail, evidence, and
file-by-file citations: see `security-gates.md`'s "Phase 23 — Privacy,
GDPR & Data Lifecycle Architecture" section.

**Phase 24 — Software Supply Chain Security & Build Provenance, official
packages 24-A through 24-D:** confirmed by direct roadmap search that
C2PA/content credentials belong exclusively to Phase 27 and that SLSA/
Sigstore/cosign are named nowhere in the roadmap — "GitHub Artifact
Attestations" is the one officially named tool, used here keyless (GitHub
OIDC + Sigstore under the hood, no signing key in this repository). 24-A
adds `scripts/generate-sbom.ts` (a real CycloneDX SBOM via
`@cyclonedx/cyclonedx-npm` + `npm audit` dependency scan, directly tested
against this repository's own lockfile) and a Trivy container scan of the
locally-built (never pushed) `Dockerfile.provider-worker` image in
`.github/workflows/supply-chain-ci.yml`; it reports risk and blocks only
on the scan tooling itself failing, never on the vulnerability count — a
real first run found 8 pre-existing, unrelated high-severity production-
dependency vulnerabilities, disclosed rather than silently gated on or
fixed (out of this batch's scope). 24-B issues a real, verified GitHub
Artifact Attestation for the SBOM on every push to `main`
(`actions/attest-build-provenance` + `gh attestation verify` in the same
job) and writes bounded release metadata (commit SHA, workflow run,
digest, attestation URL — never a secret or signed URL);
`src/lib/deployment/release-provenance.ts` is the code-owned, pure
verifier half, reusing `artifact-verification.ts`'s (14-E) own
`DIGEST_PATTERN`/`COMMIT_SHA_PATTERN` rather than duplicating them — 14-E's
own header had already reserved its `provenanceRef` field for exactly
this. 24-C is honestly scoped to merge-to-`main` (the `supply_chain_scan`
required check) rather than a fabricated separate production-deploy gate,
since this repository has no application-level deploy-execution path
(Vercel deploys externally — `deployment-policy-gate.ts`'s own documented
state, unchanged). 24-D required no new AI-specific code at all:
`required-checks.ts`'s `BASELINE` gained `supply_chain_scan`, and because
`ai-pr-authority.ts` already resolves required checks through that same
shared function, AI-authored PRs are subject to it identically to human
ones by construction — proven directly in
`phase-24-supply-chain.e2e.test.ts`. Release-provenance visibility extends
Phase 16-D's existing Deploy/Restore Health admin card (one new field, not
a second Operations Center), honestly `PROVENANCE_EVIDENCE_UNAVAILABLE` at
runtime since no live GitHub Actions run-history read-back exists yet —
CI-side generation is real; the admin-panel read-back is a distinct,
deferred integration decision. Full detail, evidence, and file-by-file
citations: see `security-gates.md`'s "Phase 24 — Software Supply Chain
Security & Build Provenance" section.

---

## Completed Implementation Checkpoints

Verified against `git log` on branch `main` as of this phase (HEAD `2c4e3db`):

| Commit | Summary | What it actually verified |
|---|---|---|
| `2a685b6` | Build Cinefield orchestration core with mock provider | The full `src/lib/orchestration/` chain (claim → normalize → route → validate → submit → normalize output → upload → complete) proven end-to-end using the offline mock provider — no external API calls, zero cost. |
| `44d50b3` | Add fal.ai provider integration | First real, paid-provider integration (`fal-flux-schnell`, FLUX.1 [schnell]) through the same generic orchestrator and `ProviderAdapter` interface the mock provider already used — no orchestrator changes required to add a real provider. |
| `0dd7aaa` | Add Trigger.dev background generation jobs | One generic Trigger.dev task (`cinefield-generation`) wrapping the same `executeGeneration()`; explicit `direct`/`trigger` execution-mode switch defaulting to `direct`; idempotency (Trigger.dev `idempotencyKey` + existing DB-level `claimGeneration` compare-and-set); retry classification reusing the existing `isRetryable()` error taxonomy; client-side polling added to the UI so async completion is reflected correctly. |
| `2c4e3db` | Add audio and text-to-speech orchestration | `generation_type = "audio"` and `workflow = "text-to-speech"` proven through the same orchestrator, the same Trigger.dev task, and the same private Storage flow — zero changes needed to the orchestrator core, Trigger.dev task, API route, or output storage/normalization layers to support a new generation type. Added a dependency-free mock WAV encoder (`mock-tts`) and result-type-aware UI rendering (`<audio controls>` vs `<img>`) so a non-image result renders correctly instead of as a broken image. Turkish/German Unicode text verified byte-for-byte preserved end-to-end. |

**What this proves, concretely, for planning future phases:** the model-registry + provider-adapter pattern established in `2a685b6` has now absorbed a second real provider shape (fal.ai) and a second generation type (audio) without requiring changes to the orchestrator, the Trigger.dev task, the API route, or the storage layer. Future phases (Cloudflare, Runway, additional models) should be expected to follow the same shape: a registry entry plus one adapter file, not a rewrite.

---

## Operational Infrastructure Status (Phase 6R)

The AWS SQS + ECS provider runtime, its dead-letter queue, CloudWatch
alarms, an IAM least-privilege review, and production mock-provider
validation are complete and verified. See
[`../operations/AWS_PROVIDER_RUNTIME.md`](../operations/AWS_PROVIDER_RUNTIME.md)
for the full resource inventory and test record.

---

## Future Phase Order (Updated)

This order **supersedes** the source contract's original "Faz 1–10" sequence (contract section 45) for everything after what's already built. Faz 1–3 of the source are effectively complete, in the shape described by the Completed Checkpoints above (not identical file-for-file to the source's illustrative structure, but satisfying the same principles — see the override section of the contract). Faz 4 (Runway, the source's "second independent provider") has been deliberately **reordered later** (now Phase 8) in favor of building out the Cloudflare AI layer and audio/multilingual capability first. Audio/TTS, which the source contract did not assign an explicit phase number to, has already been completed ahead of Cloudflare (checkpoint `2c4e3db`) and continues to expand within Phase 6.

| Phase | Name | Scope (target, not yet built unless noted) |
|---|---|---|
| **5A** | Cloudflare Foundation | Connect Cloudflare account/project; establish AI Gateway as a **gateway/control layer only** (contract section 24) — no provider logic lives here. No generation behavior changes in this phase. |
| **5B** | First real Cloudflare Workers AI model | One real Workers AI model (likely a second TTS provider, extending the audio workflow established in `2c4e3db`) wired through the existing model registry + a new provider adapter — following the exact pattern `fal-flux-schnell` already proved. Recorded as `provider = "cloudflare-workers-ai"` (or similar), distinct from any Cloudflare AI Gateway usage per the contract override. |
| **5C** | Cloudflare prompt enhancement and task classification | Short AI-assisted tasks routed through Cloudflare AI Gateway (contract section 24's intended use: prompt enhancement, classification, moderation) — explicitly not a video/audio generation path. |
| **6** | Multilingual Prompt Intelligence | A dedicated, reviewed phase for prompt language detection/normalization — deliberately **not** built during Phase 4, per that phase's explicit instruction to preserve raw Unicode text unmodified. Must not silently start translating or rewriting user text as a side effect of any other phase. |
| **7** | Model Registry Unification | Revisit whether `model-registry.ts` (code) should gain a database-backed counterpart (contract section 26's `model_registry` table) now that multiple real providers exist — a deliberate architectural decision, not an assumption. |
| **8** | Runway Video Provider | Second real, independent video provider adapter (contract section 6 + section 44: "Runway must not be added inside fal.ai's code"). Own API client, own schema, own error mapping — parallel to, never merged with, `fal-provider.ts`. |
| **9** | Usage and Credit Ledger | Contract section 10: `credit_wallets`, `credit_ledger`, `subscriptions`, `model_pricing`, `provider_cost_records` — currently **none of these tables exist**. This phase would introduce them for the first time. |
| **10** | Stripe Test Mode | Contract section 28: checkout → verified webhook → subscription/ledger update. No Stripe integration exists today. Test mode before any live mode. |
| **11** | Vercel Staging | Contract section 40: a real staging environment distinct from local development, with its own Supabase/Clerk/Trigger.dev configuration. Local development is the only environment verified so far. |
| **12** | Cloudflare R2 Migration | Contract section 20's R2 folder structure, **only** as a reviewed migration away from the currently-verified Supabase Storage — not a default or an assumption. Supabase Storage remains authoritative until this phase explicitly completes. |
| **13** | Additional providers and models | Google Veo, Kling, Replicate, and further models — each following the same registry-entry-plus-adapter pattern already proven twice (fal.ai, and implicitly Cloudflare Workers AI in 5B). |

### Explicitly out of scope for all of the above until their own phase

The following are named directly in the source contract as target architecture and must **not** be introduced as a side effect of any phase above:

- **Database tables:** `workspaces`, `workspace_members`, `sequences`, `scenes`, `shots`, `assets` (as a distinct table from generation rows), `characters`, `character_versions`, `character_reference_assets`, `character_embeddings`, `character_usage`, `locations`, `props`, `styles`, `credit_wallets`, `credit_ledger`, `subscriptions`, `model_pricing`, `provider_cost_records`, `provider_jobs`, `webhook_events`, `notifications`, `community_posts`, `comments`, `likes`.
- **Advanced generation status values:** `draft`, `validating`, `submitted`, `post_processing`, `uploading` as new `generations.status` enum values (today's finer-grained progress already lives in `metadata.orchestration.stage`, which should continue to be used instead of expanding the `status` column).
- **R2 folder structures** (contract section 20) — Supabase Storage is current and verified; R2 is Phase 12 only.
- **Workspaces, scenes, shots, characters** as a project hierarchy (contract section 17) — the current hierarchy is flat (`Project → Generation`).
- **Community features** (contract section 29) — publishing, remix, comments, likes.
- **MCP server** (contract sections 31–32) — no MCP server exists in this repository.

None of the above are currently implemented facts. They are recorded here so a future phase can be scoped against this list deliberately, rather than an agent assuming any of them already exist.
