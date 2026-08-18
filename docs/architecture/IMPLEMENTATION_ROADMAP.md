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
log) is **partial** — the new `deployment.production.apply` registry
entry and `src/lib/deployment/deployment-policy-gate.ts` wire the
deployment gate additively (Phase 14-D's `deployment-guard.ts` itself
untouched), and the decision log requirement is met by reusing the
existing `security_events` RPC chain (no new table); the AI
remediation/provider-disable/admin-sensitive-action points named in 19-C
already call `requirePolicy()` from earlier phases (14-B/16), and were
not modified further this batch. 19-D (fail-safe, TTL/reversible/
idempotent bounds, policy-change PR governance) is **code-complete** for
the fail-safe and CI-required-check halves; TTL/reversible/idempotent
runbook bounds on high-risk automation remain the existing Phase 14/15
mechanisms, not duplicated here. A live OPA sidecar/service (the literal
text of 19-A) was deliberately **not** stood up — `PolicyDecision.engine`
stays `"embedded"` in every production path; the WASM build is CI-proof
only. Full detail, evidence, and file-by-file citations: see
`security-gates.md`'s "Phase 19 — Policy-as-Code & Automated Action
Guardrails" section.

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
