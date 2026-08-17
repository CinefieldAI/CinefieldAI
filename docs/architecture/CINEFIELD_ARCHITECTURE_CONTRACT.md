# Cinefield Architecture Contract

**Source of truth (original, unmodified, do not edit):** `CINEFIELD_ARCHITECTURE_CONTRACT_SOURCE.txt` (project root)
**Original title:** "HIGGSFIELD BENZERİ AI PLATFORMU — ANA MİMARİ SÖZLEŞMESİ" ("Higgsfield-like AI Platform — Master Architecture Contract")
**Original language:** Turkish. This document is a faithful English rendering of the source's architectural principles, reorganized around the same 47 numbered sections, for use by contributors and coding agents who need it in English. **If this document and the source `.txt` file ever disagree, the source `.txt` file is authoritative** — this file should be corrected to match it, not the other way around.
**Status:** This is the top-level technical architecture instruction for the project. Before adding a feature, connecting a provider, changing a database table, or refactoring existing code, the rules below should be consulted.

The goal is a Higgsfield-like, multi-model AI image/video platform — built independently, based only on observable product behavior, never by imitating another company's proprietary code, trade secrets, or unknown internals.

---

## CURRENT CINEFIELD IMPLEMENTATION OVERRIDES

**Read this section first.** The source contract (below) describes the intended long-term target architecture. Cinefield's actual implementation, as verified in the repository at commit `2c4e3db` (branch `main`), already exists and works for a real subset of that architecture. Where the source contract's abstractions and folder names differ from what is actually built and proven, **the current implementation wins** until a separate, reviewed migration phase says otherwise. Specifically:

- **Preserve the existing architecture under `src/lib/orchestration/`.** This is Cinefield's real, working implementation of the source contract's "Provider adapter" + "Model registry" + "Generation worker" layers (sections 4–8). It is not a placeholder to be replaced.
- **Do not create a second orchestration/provider system under `src/providers/`.** The source contract's example folder layout (`providers/fal/`, `providers/runway/`, …, section 6) is illustrative, not a literal instruction to add a second, competing directory. Cinefield's provider adapters already live under `src/lib/orchestration/providers/`.
- **Preserve the existing generic `ProviderAdapter`** (`src/lib/orchestration/providers/provider-adapter.ts`). It already matches the shape the source contract asks for in section 6 (`submit`/`getStatus`/`getResult`/`cancel`, i.e. the same intent as `createJob`/`getJobStatus`/`cancelJob`/`normalizeResult`). Do not replace it with a narrower, video-only, or single-provider-shaped adapter.
- **Use one reusable adapter per provider, not one adapter per model.** This already matches source section 6 exactly — `fal-provider.ts` serves every fal.ai model through the model registry, not one file per model.
- **Individual models must be mapped through the existing model registry** (`src/lib/orchestration/model-registry.ts`), matching source section 5's "model registry as single source of truth" principle. No parallel, hand-written model list may be introduced elsewhere.
- **Cloudflare AI Gateway is a gateway/control layer**, matching source section 24 exactly (prompt enhancement, vision analysis, moderation, rate limiting — never a video orchestrator).
- **Cloudflare Workers AI may be an actual provider** — a real inference backend, distinct from the AI Gateway that may sit in front of it. This is a refinement of source section 24 for planning purposes: "Cloudflare" is not one undifferentiated concept.
- **Record actual provider and optional gateway as separate concepts.** A generation's `provider` field (already: `"mock"`, `"fal"`) identifies who actually generated the output. A gateway (Cloudflare AI Gateway or otherwise) is routing/observability plumbing in front of a call, not the provider of record.
- **Never route Runway through the fal adapter. Never route fal.ai models through the Runway adapter.** Directly restates source section 44's "do not treat fal.ai and Runway as the same provider" and section 45 Faz 4's "Runway must not be added inside the fal.ai code." No Runway adapter exists yet (see Phase 8 in the roadmap) — this rule pre-commits to keeping it separate when it is built.
- **Cloudflare R2 is the hot/live production media store, from Phase 9-A.** The private `cinefield-media` bucket holds every canonical original — provider output and browser uploads alike — under server-generated keys, recorded in `media_assets`. S3 is DR/backup only and belongs to Phase 9-D; it must never appear in a user delivery path. (An earlier revision of this file said R2 was "Phase 12". The authoritative v1.6 roadmap assigns R2 hot storage to 9-A and R2→S3 DR to 9-D; the Phase 12 claim was stale and is corrected here.)
- **Supabase Storage remains as a TIME-BOXED compatibility layer, not a second truth.** `generation-outputs` is still written by `uploadOutputs` and still backs `generations.output_url`, so existing delivery keeps working while R2 takes over. Removal condition: once a read path serves media from `media_assets` (Phase 9-C delivery, or the generations gallery), the Supabase write and the `output_url` dependency go with it. Until then the R2 object is canonical and the Supabase copy is a mirror — do not add a third store, and do not build new features against `output_url`.
- **A stored object is not verified media, and one gate decides.** Phase 9-A stores opaque bytes and records what the provider or the browser DECLARED. Phase 9-B added the single ingest gate every source passes through — browser upload and provider output alike, same contract, different provenance. It derives `verified_mime` FROM THE BYTES (never from a header, a Content-Type or a filename), computes `checksum_sha256` over the real content, records owner-scoped duplicates as evidence, and decides whether the asset may leave quarantine. Executables, scripts, archives, PDFs, Office documents, HTML and **SVG** are refused; SVG because it is active content, not because it is unsupported.
- **The gate runs in a sandbox, and the sandbox is the point.** Bytes are identified and hashed in a disposable child process spawned with an ALLOWLISTED environment of exactly `PATH` and `NODE_ENV` — no provider key, no Supabase service role, no R2 credential, no Clerk or Temporal secret, because the environment is built from nothing rather than scrubbed. It imports `node:crypto` and a pure detector and nothing else. This is process isolation: there is no read-only root, no cgroup limit and no network namespace, and those remain production infrastructure work. When 9-C introduces FFmpeg the network namespace stops being optional, because FFmpeg resolves URLs in playlists and protocol handlers.
- **Moderation is fail-closed and honest about it.** No image, video or audio moderation engine exists — the repository's only classifier is text-only, behind a disabled flag, never called by the pipeline. `moderation_status` therefore stays `not_evaluated`, and the database refuses `quarantine_status = released` without a `passed` verdict. Every asset stays quarantined. That is the correct private-beta posture; it is not a default that reads like approval.

- **Quarantine has exactly one exit, and it needs two people (Phase 9-E).** `approve_media_release`, `request_media_release` and `reject_media_asset` are the only code that moves `quarantine_status`; they are `service_role`-only, no HTTP route reaches them, and the transitions live in SQL so the state change and its outbox event share one transaction. Release requires a SECOND administrator — the roadmap lists quarantine release among the actions that "tek admin onayıyla çalıştırılamaz", and the primary key on `(asset_id, approver_clerk_user_id)` is the mechanism: one human approving twice writes the same row. Rejection is deliberately single-admin, because the two-person rule exists to make releasing media harder, not refusing it. Rejection is terminal for the normal lane; there is no appeal or reopen flow, and pulling released media back is a takedown (Phase 23), not a moderation reject.

- **Administrative authority releases a cleared asset; it never clears one.** Two approvals of an unmoderated asset fail with `moderation_not_passed` and bank no approval at all. There is no override flag, no environment escape and no dev-only shortcut — the roadmap authorises releasing media moderation has passed, and authorises no human substitute for the verdict. Because no engine is registered, the honest consequence is that nothing can currently be released, and the delivery gate mints no signed URL for generated media.

- **The delivery gate is inside the minting function, not at its call sites.** `attachSignedUrls` asks the database whether this generation's canonical original is `released`, `verified` and `finalized` immediately before creating a URL, and returns nulls otherwise. Placing it at the call sites would make it forgettable; caching the answer would let a URL be minted for media rejected a second earlier. A caller that names no generation to check gets no URLs — uncheckable is not safe.

- **The safety trail is append-only.** `media_safety_audit` records actor, action, prior and resulting status, and a short reason code matching `^[a-z][a-z0-9_]{1,64}$`. A `BEFORE UPDATE OR DELETE` trigger refuses every role including the one that writes it. No free text, no URLs, no payloads — an audit an operator can edit is not evidence.
- **S3 is disaster recovery and nothing else (Phase 9-D).** Every finalized, ingest-verified asset is copied from R2 into the private `cinefield-media-dr-dev` bucket (`eu-central-1`, SSE-S3, versioning on) under a deterministic `dr/<canonical key>`. The direction is fixed — R2 canonical → read → S3 copy → verify → record. Never provider→S3, never browser→S3. **No application read path consults `backup_key`**, and there is deliberately no R2-unavailable fallback: a "helpful" fallback read is how a DR copy quietly becomes a second production store nobody maintains. Restore is a separate controlled operation (contract below), not an automatic behaviour.
- **DR is asynchronous, and a DR failure is a durability problem.** Generation completion requires R2 plus a verified ingest; it does not wait for a backup, because blocking it would hand an unrelated AWS outage the power to stop generation. A failed backup returns the asset to `failed`, which the claim picks up again — backup debt is visible in `backup_status` and retried, never silently dropped. An S3 outage never fails a generation, never implicates a provider, never trips a circuit breaker, and cannot alter the canonical object.
- **The backup worker cannot delete anything.** The DR client imports `PutObjectCommand` and `HeadObjectCommand` only; the IAM identity has no `s3:DeleteObject`. Removing a DR copy belongs to the Phase 23 retention engine — a worker that can delete backups can, on a bad day, delete the thing the backup existed for. Deleting an R2 asset therefore does NOT cascade to its DR history.
- **Realtime has one canonical path, and 11-B built its middle (Phase 11).** `Postgres Outbox → Notification Service → Redis Streams (Redis A) → SSE Gateway → Browser`. The roadmap's binding correction closed the "Pub/Sub veya Streams" option — Streams, because Pub/Sub provides neither cursor nor replay — and forbids a direct realtime publish from Worker, Media or Provider. **`src/lib/realtime/notification-stream-adapter.ts` is the only module in the repository that may `XADD`**, enforced by a structural test that scans the whole tree. Redis B is never referenced: it holds BullMQ queue state and nothing else. What remains unbuilt is resume (11-C) and connection limits (11-D).

- **Retention is two limits with two different strengths, and the difference is load-bearing.** `XADD … MAXLEN ~ 200` bounds growth cheaply but is APPROXIMATE — the `~` trims only at macro-node boundaries, verified live by writing twelve entries under `MAXLEN ~ 5` and keeping all twelve. The roadmap's fifteen-minute window is delivered by `XTRIM … MINID`, which is EXACT because stream ids are `<ms>-<seq>`. A key TTL would give neither: `EXPIRE` drops a whole stream at once, and Redis has no per-entry TTL. Both run on every publish rather than behind a scheduler nobody would enable.

- **`XADD` is not idempotent, and the design says so instead of hiding it.** An at-least-once outbox retry appends a second entry — Redis assigns a new id every time. What is guaranteed is that both entries carry the same `eventId`, the dedupe identity the event contract already defines, so no second DOMAIN event is ever created. Entry-level suppression would need a per-channel dedupe set and a Lua script; 11-C owns client dedupe and is the right place to weigh that. Stable identity is the part 11-C could not add afterwards.

- **The SSE connection ends itself, on a budget chosen against an unproven ceiling.** No `vercel.json` exists and no route sets `maxDuration`, so the deployed limit cannot be read from source. The gateway closes at ~50 s with ±10% jitter and announces it with a `reconnect` event, rather than being killed mid-frame at an unknown moment. A blocking `XREAD` runs on a DEDICATED connection: ioredis executes commands in order on one socket, so sharing the application client would stall idempotency reads, locks and rate-limit checks behind a subscriber that is deliberately idle.

- **A long-lived worker validates its configuration before it does anything, or it refuses to start (12-D).** `assertStartupConfiguration()` is the first statement of `main()` in the Temporal worker, the provider worker and the realtime dispatcher — ahead of every connection, client, poll and claim. An invalid production configuration exits non-zero having created nothing: no provider call, no Redis publish, no outbox claim, no Temporal poll. There is no flag that disables it and it never downgrades production to development, because a guard with an escape hatch is one that gets used during the incident it exists for. Structural tests assert the ordering; runtime tests spawn each worker and assert the exit code, the sanitized refusal and the absence of every post-startup log line. The shipped-but-uncalled first version of this control was found by audit as D12-D2 — the fourth instance of that pattern in this repository, and the reason the wiring now lives in one named module three entry points call.

- **One generation, one trace id, and the id is never an authority (13-A).** There is exactly one trace-id generator; two would mean two formats and a correlation that silently returns nothing. A trace arrives partly from a header, so it may not choose a tenant, select a stream, authorize a generation, serve as an idempotency key or become a billing identifier — each asserted separately, and the 12-E policy input has no trace field at all. Inbound `traceparent` is parsed strictly and, by default, NOT TRUSTED: every request today comes from a browser, and trust is a per-boundary decision to be flipped when an upstream we control exists.

- **The async scope is a convenience inside one process; the field is the contract between processes.** `AsyncLocalStorage` gives every logger call correlation without touching a call site, and it deliberately does not cross SQS, Temporal, an outbox row or a worker restart. Each durable hop carries the id explicitly — workflow history, command wire, `outbox_events.trace_id`, `security_events.trace_id` — and the receiver validates it on the way back in, because a queue message is not an authority. A workflow never mints one: a random value inside a workflow breaks deterministic replay.

- **Span names are closed and low-cardinality; identifiers are attributes.** A span name is a dimension key in every backend that will consume it, and a name carrying a generation id, a user id or a prompt would be sensitive data in the one field no sanitizer inspects. Twelve names, `startSpan` accepts nothing else, and attributes run through 13-E's sanitizer rather than a second allow-list — one guard, or the weakest of several decides what leaks.

- **A security event correlates to a request when there is one, and is never given a fake trace.** A dispatcher loop, a scheduled job and a worker startup genuinely have no request behind them; minting an id there would fabricate a correlation that never existed, so absence is an expected state rather than a gap to fill.

- **Telemetry is a second copy of production data, so it carries an allow-list and nothing else (13-E).** Roadmap ¶1753 makes the direction binding: a deny-list has to predict every field anyone will ever add and fails silently, while an allow-list fails by dropping something useful — a code review rather than an incident. 47 fields, each with a written justification a test requires, built from the keys the code actually logs rather than from guesswork. Unknown name, wrong type, failed pattern, secret shape or prose: DROPPED. A secret-looking value is dropped WHOLE and never truncated, because half a token is still a token's worth.

- **There is exactly one redaction boundary, and every future sink calls it.** Sentry, OTel, CloudWatch and Better Stack each receive an already-sanitized envelope; they never see a caller's original fields. Four SDKs doing their own filtering would mean four definitions of "safe" and the weakest one deciding what leaks, so ¶1723 is enforced once. No `raw` variant, no bypass flag, one call to the sanitizer in the whole logger — all asserted.

- **An Error never reaches telemetry as an object.** `projectError` yields at most class, code and retryable. `error.message` is deliberately excluded: a message is authored by whoever threw, which for a provider is a third party, and no length limit makes arbitrary third-party text safe. Stacks and cause chains are never serialized.

- **Telemetry failure is not business authority; guard failure is.** Nothing in the logger throws or is awaited, and a broken sink is swallowed — a logging failure must never fail a generation, retry a provider, mutate billing or drop a durable security event. The Sensitive Data Guard is the deliberate inverse: unsafe data is dropped rather than emitted, because losing observability is recoverable and a prompt in a third-party system is not.

- **The tenant field is honest about what it currently holds.** ¶1753 approves `workspace_id`; workspaces do not exist yet, so today that value IS the Clerk principal id. It is allowed as the approved pseudonymous tenant correlation id, the equivalence is written down rather than glossed, and a field named `clerkUserId` is dropped so the acting principal cannot be logged outside a tenant scope.

- **The environment is declared, never inferred, and production is checked against combinations that must not occur (12-D).** `CINEFIELD_ENV` wins over `VERCEL_ENV` because a Vercel "preview" may be a real staging deployment; an unrecognised value resolves DOWN to development, the environment with the fewest permissions, so a typo cannot grant anything. Production refuses a missing required secret, a LOCAL_ONLY variable, localhost or plaintext in a critical dependency, a test-instance identity credential, and a Temporal namespace naming another environment. Every environment refuses a generic provider credential and a Redis A/B that resolve to the same target. Development is deliberately unconstrained — a validator developers must disable protects nothing.

- **The secret inventory is executable, and a variable cannot exist outside it.** `secret-registry.ts` holds every name with a class, a production requirement and a rotation procedure; it contains no values and reads nothing. `.env.example` is generated from it, and tests assert both directions — every `process.env` read in shipped code is registered, and every registered name is documented. `getServerSecret` refuses an unregistered name, which puts the gate where someone is motivated to skip it: a new credential needs its registry entry before the first call site compiles.

- **One secret per provider, and the generic name is a build failure.** Roadmap ¶1686 makes this a Phase 8 precondition rather than later work, because the blast radius of a shared key is a whole provider network and one compromised CI log. Twelve providers, twelve names; `PROVIDER_API_KEY` and its variants are absent from the registry, rejected at runtime in every environment, and asserted missing from source by test.

- **Nothing about a secret leaves the process except its NAME.** A `ConfigFinding` has a variable name, a reason code and an environment — there is no field a value could travel in, which is the enforcement rather than a convention. A test plants a canary in four variables and asserts it appears in no finding, report, error or stack, not even as a fragment: a prefix or a length is still information.

- **One IAM role per runtime boundary, and an empty role is a legitimate answer.** The realtime dispatcher gets no AWS permission at all because it uses PostgreSQL and Redis; creating the role anyway means the day it needs an action, granting it is a reviewed change instead of something inherited by sharing. The DR worker cannot delete. The media worker holds no provider secret and no database credential (red notes ¶327/¶1458) and has no queue rights (6R.22) — enforced by the absence of a statement, not by a deny rule someone could reorder.

- **Secret manager is an interface with one implementation, on purpose.** The environment backend exists; no `AwsSecretsManagerProvider` does. Shipping an implementation nobody can exercise against a real backend is the built-but-unwired defect this repository has closed three times. Phase 25 adds one class and one wiring line, and no consumer changes — that is what the interface is for.

- **A critical action does not run without a policy result (12-E).** Six real actions — the three quarantine transitions, both runtime routing controls, and the automatic temporary block — evaluate policy before they mutate anything, and a non-ALLOW throws. Structural tests fail if a mutation can be reached before the gate or if a second ad-hoc path to one appears. Ordinary operations are deliberately NOT gated: pulling them behind a fail-closed boundary would trade real availability for no security gain, and a Rego test rejects a non-critical entry in the registry.

- **The Rego is the specification; the runtime implements it, and one table binds them.** `policies/cinefield/policy.rego` is normative and `policies/data/actions.json` is the single action registry both sides read. `policies/conformance/cases.json` is iterated by `policy_test.rego` under `opa test` AND by the TypeScript suite under `npm test`, so the two evaluators cannot drift without a run going red. OPA is not a runtime dependency: policy availability never depends on a network call, a sidecar or a paid service, because a fail-closed gate that needs a second process alive means an outage there stops quarantine handling. Phase 19 owns the OPA service (¶2272); `PolicyDecision.engine` travels in every decision so that swap is visible in the log.

- **The policy gate grants nothing — it is an additional condition, never a replacement.** An ALLOW on a two-person action returns `allowed_two_person_enforced_downstream` and the threshold remains a PRIMARY KEY inside the SQL transaction. Moderation is untouched and the word does not appear in the policy layer. Credits, providers and the generation lifecycle are unreachable; the engine imports the registry and its own contract, and nothing else.

- **AI/MCP write authority is OFF by default and cannot be reached by borrowing a role.** Roadmap ¶1856: MCP connections start READ-ONLY, and a write goes AI suggestion → policy → human approval → protected workflow, never skipped for incident urgency. The agent check runs BEFORE the role check, and the origin check runs before both — so a browser-driven agent is refused as a browser. The allowlist started empty; Phase 14-B narrowed it to exactly one entry, `code.pr.create` — an AI Fix Agent may be authorized to have a pull request opened for human review, never to merge or deploy one, and it still needs human approval evidence like every other allowlisted action. `requireAiWritePolicy` has its first real caller, `src/lib/deployment/ai-pr-authority.ts`, which composes the gate with a change-risk taxonomy and a required-CI-check registry rather than reimplementing any part of it — the guardrail still landed before the capability, since no GitHub integration exists to actually open a PR. The change-risk classifier itself treats `src/lib/policy/` and `policies/` — including the allowlist file — as `FORBIDDEN_AUTOMATION`, so an AI Fix Agent structurally cannot propose editing its own allowlist.

- **An incident can produce a fix PROPOSAL, and a proposal is not a decision (14-A).** The self-healing chain's first arrow exists in code: a 13-D `AlertEnvelope` becomes a bounded `IncidentDiagnosis`, which becomes a 14-B `PrProposalInput`, which is then classified and gated by the machinery that already existed. Diagnosis is evidence only — `IncidentDiagnosis` has no field for a risk class, a required check, an approval or a deploy flag, so a confident wrong diagnosis cannot make a change cheaper to land; a forged provider claiming high confidence over `policies/data/actions.json` still classifies FORBIDDEN_AUTOMATION. Exactly one alert type is remediation-eligible (a dispatcher loop failing, the one case with bounded code ownership in this repository); security, infrastructure, provider and backlog incidents all escalate to a human, and an uncatalogued alert returns `ANALYSIS_UNAVAILABLE` rather than a guess. Sentry Seer is absent by the roadmap's own scale-trigger rule (¶111/¶753) and the `RootCauseProvider` interface is where it will land; no GitHub SDK, token or network call exists anywhere in the seam. The 13-D router does NOT auto-invoke it: Phase 14-F owns the kill-switch and the PR-storm limit, and wiring automatic proposal generation before those exist would create the unbounded-PR failure 14-F is specified to prevent.

- **The safe-deployment chain decides; it never executes (14-F/C/E/D).** Four gates, built in that order rather than by lettering. **14-F** bounds the AI remediation loop before anything is wired to it: a kill switch that is ENGAGED by default and has no setter, no override and no route (an env var can only be changed by someone who can change the deployment; a row can be written by any service-role holder), plus 3 attempts per incident, a 1-hour cooldown, and a 5-per-hour GLOBAL ceiling — the global one being what stops a storm across twenty resources from becoming twenty proposals. Its bounded caller is the dispatcher worker, deliberately not the alert router, because wiring the router makes every alert a remediation candidate. **14-C** decides preview candidacy from supplied observations with no Vercel call, keeping PR_ELIGIBLE, PREVIEW_ELIGIBLE and PROD_CANDIDATE as three distinct questions; a check with no recorded outcome is a refusal, never a pass. **14-E** verifies the artifact by DIGEST — not filename, not PR number — and fails closed on unknown status, mismatch or missing lineage, which is what stops a stale-but-verified build riding along with a newer commit; Phase 24 still owns signing and SBOM issuance. **14-D** requires all of them at once and re-runs 14-E against the current candidate rather than trusting a cached verdict; its rollback half triggers only on Phase 13 signals and refuses to guess a target — no known verified-good previous deployment means REVIEW_REQUIRED, because rolling into an unknown state is not a recovery. Nothing in the chain calls GitHub, Sentry or Vercel, and the strongest verdicts it can reach are named ELIGIBLE_FOR_EXTERNAL_DEPLOY and ROLLBACK_REQUIRED_EXTERNAL_EXECUTION.

- **Reliability is defined and computed, never owned (15-A).** Phase 15-A declares what an indicator MEANS and what target we hold ourselves to, then does arithmetic. Each of its seven SLIs names exactly one pre-existing source owned elsewhere — Phase 13 Health for readiness, `generation_attempts` for attempt evidence, the outbox debt aggregate for delivery debt, Phase 7's store for provider health — and it computes no second opinion about any of them, because a second provider-health score would eventually disagree with the router's own. Targets are POLICY STATEMENTS: nothing here asserts production meets them, and live measurement needs an external backend that stays deferred. UNKNOWN is never HEALTHY — `sourceAvailable` is checked before any count, so a failed query is UNAVAILABLE rather than zero errors, and a perfect ratio over three samples is INSUFFICIENT_DATA rather than 100%. NaN and Infinity are impossible by construction, which matters because a NaN burn rate compares false against every threshold and would fail open on the very signal meant to report trouble; the 100%-target case (`dependency_readiness`) is handled explicitly instead of dividing by zero. It is not an alert router: breach signals go to 13-D's `raiseAlert`, severity stays in 13-D's catalogue, and INSUFFICIENT_DATA/UNAVAILABLE raise nothing and resolve nothing because "we could not measure" is neither a breach nor a recovery. Metric dimensions are limited to provider/model/dependency — no user, workspace or request label, since that is both unbounded cardinality and a path for identity into a metrics backend.

- **Cost is estimated, recommended on, and never acted on (15-B/1).** `src/lib/finops/` observes OPERATIONAL PROVIDER COST from `model_pricing.provider_unit_cost` and evaluates it against a deterministic budget registry. Every number is `ESTIMATE_BASED` and says so in its own field: `generation_attempts.cost_amount` exists but no production caller writes it, so no observed provider spend exists in this system to read. Three numbers stay separate — provider cost (15-B), customer credit price (Phase 10, and `credit_price_per_unit` is never read here, because a guard computed from margin grows less worried the more it charges), and invoice total (external, DEFERRED_EXTERNAL, never zero). Phase 10 remains the sole economic truth: no reserve, settle, release, refund, ledger or wallet write exists in the package. UNKNOWN is not free — missing, inactive, stale, malformed and unreadable pricing each resolve to a named non-numeric state, one unpriced member poisons an aggregate rather than being skipped, STALE is refused despite carrying a number, and a currency mismatch fails closed because a guessed exchange rate is a guessed spending limit. The budget registry ships empty on purpose: a limit is a business figure, and a fabricated one either throttles real traffic or sits so high it never fires while looking like protection. **The guard recommends and stops.** It names a Phase 7 target — using Phase 7's own `providerModelId`, since a composed "provider:model" is a string `findRuntimeExclusion` has never seen — and never calls `setRoutingControl`, never writes a runtime flag, never disables anything; Phase 7 owns routing control and Phase 21 owns generic flags, canaries and rollout. No automatic provider disable exists yet, because whether an automated cost signal may take a provider offline unattended is an unanswered question and wiring it would answer it by accident. When several budgets govern one request, `resolveApplicableBudgets` returns ONE verdict and the strictest wins (ALLOW < AT_RISK < BUDGET_EXHAUSTED < UNKNOWN_COST < UNAVAILABLE < INVALID) — uncertainty outranks a measured overrun, because that is the only ordering under which adding a budget can never make the system more permissive; a configured budget with no measured spend is UNAVAILABLE, never zero, while a request no budget governs is a visible POLICY GAP rather than a silent pass. `generation_attempts.cost_amount` stays NULL until real provider evidence exists and must never be populated from pricing, estimated units, projected spend or a customer price: a column named cost_amount holding an estimate is indistinguishable from one holding a bill, and writing a forecast there would permanently destroy the ability to tell forecast from fact. Breach signals go to 13-D's `raiseAlert` (`cost_budget_at_risk`, `cost_budget_exhausted`, both non-user-visible and both `remediationEligible: false` — cost pressure is not a code defect); an UNKNOWN raises nothing AND resolves nothing, since going blind is not a recovery.

- **Spend is observed from attempts, priced, and still only recommended on (15-B/2).** `estimated-spend-repository.ts` is the single database touch in the FinOps package: it counts `generation_attempts` per provider/model over a caller-supplied window, selecting three columns (`provider, provider_model, status`) and never reading `generations`, which holds the prompt. Volume is ATTEMPTS, not generations — a generation that retried twice called the provider three times, and counting generations would under-report exactly the retries most likely to blow a budget; `pending`/`claimed` are excluded because those requests never left Cinefield, while `submitting` is included because an in-flight attempt may already have been charged. `spend-guard-runner.ts` is pure, and `runEstimatedSpendGuard` — an existing operational service surfaced as a plain `task()` with NO schedule — is the real production caller, closing 15-B/1's "model exists, nothing calls it" gap. `per_request` units are a schema fact (one attempt is one request); `per_output` returns null and fails closed, because no output-count evidence exists — `generations` has no quantity column and nothing writes a `provider_output` media asset — so assuming one output per request would price real traffic WRONG rather than merely incompletely, and most image traffic is consequently unpriceable today, reported as `partial` with an `unpriceableLines` count rather than as success. A query that errored, threw, or was truncated by the scan cap sets `sourceAvailable: false` and becomes UNAVAILABLE, never an empty window; a truncated count is smaller than the truth. An unreadable window is decided BEFORE budgets are consulted, because a window with no lines matches no provider-scoped budget and would otherwise resolve to "no applicable budget" — i.e. ALLOW — which is the right answer to a different question. Basis stays ESTIMATE_BASED; nothing writes `cost_amount`, sets a routing control, spends credits, or invents a cadence.

- **A cancelled attempt is judged by evidence, not by status (15-B/3).** `markAttemptTerminal` may only close an ACTIVE attempt, and that set includes `submitted` and `processing` — so an attempt that already reached the provider can be cancelled afterwards, and the provider may already have charged. Excluding every `cancelled` row under-reported spend and made the guard more permissive than reality; counting every row would invent spend for attempts cancelled while still `pending`. `submission_evidence` decides: `none` is not counted, `ambiguous` and `job` are. AMBIGUOUS COUNTS — "ambiguous is not safe" applied to money means an attempt we cannot prove was free is treated as paid, because guessing the cheaper answer is guessing in the provider's favour with Cinefield's budget. The rule is one exported function pinned by a table that must name every status in the schema CHECK, and `cancelled` rows are fetched then judged rather than filtered out in SQL, since rows excluded by the query could never be judged at all. Routed traffic resolves through the canonical `provider_models -> model_routes -> model_id` join Phase 7 already owns, consulted only for pairs the static catalogue missed; when that join yields more than one platform model the pair stays UNRESOLVED, because two platform models can be priced differently and picking one would fabricate a price behind the appearance of a lookup.

- **A restore is validated, not merely assumed (15-C/1).** `src/lib/dr/` enforces BACKUP_EXISTS != RESTORE_SUCCEEDED and RESTORE_STARTED != RESTORE_VALIDATED: Phase 9-D's `backup_status = 'backed_up'` proves S3 answered a HeadObject, never that a PITR restore would reconstitute a working Cinefield. `VALIDATION_PASSED` is reachable in exactly one way — row-count, checksum, and referential-integrity validation all ran and all agreed — and the engine's call order makes refusal absolute: an environment declared `production` or `unknown` (never inferred from `NODE_ENV`, always a caller declaration) is refused BEFORE a single read, including the merely-informational `isRestoreReady()`. Row-count validation compares a written sixteen-table allow-list (`DURABLE_TABLES`, each with a stated reason) against the canonical database, explicitly excluding `outbox_events`/`workflow_start_outbox`/`outbox_tx_proof`/`credit_reservations` because their own migrations document rows as purgeable or historically retired — comparing their counts across a restore would flag healthy behaviour as corruption. Checksum validation reuses Phase 9-B's `checksum_sha256` as content identity rather than hashing media itself. Referential-integrity validation reads PostgreSQL's own `pg_constraint.convalidated` verdict; no relationship graph is re-encoded in TypeScript, because a hand-maintained copy would drift the moment a migration changed the real one. `RestoreEvidenceSource` is a four-method read-only interface with no adapter shipped in this batch — `deps.getRestoreEvidenceSource` defaults to `() => null`, so an unmodified deployment honestly reports NOT_CONFIGURED. A single new 13-D alert type, `dr_restore_validation_failed`, fires only on a PROVEN mismatch — NOT_CONFIGURED/UNAVAILABLE/RESTORE_NOT_READY raise nothing, matching the alert catalogue's own standing rule that a signal with no real producer is a fake alert. Phase 9-D's backup/write path, Phase 7 routing, Phase 10 ledger, and Phase 13-D/13-E ownership are all unmodified; live PostgreSQL PITR and the S3→R2 restore-back contract (defined, not implemented) remain external and deferred.

- **A restore is proven with a real pg_dump/pg_restore round trip, locally (15-C/2).** 15-C/1 validated synthetic fixtures; this closes the gap between "migration replay" (`run_pg_tests.sh` rebuilding a database FROM MIGRATIONS every run) and "backup restore" (taking a real `pg_dump` of a populated database and `pg_restore`-ing it into a SEPARATE throwaway container). `supabase/tests/run_pg_restore_proof.sh` seeds a database via real functions (`create_generation_tx`, `reserve_credits`, `record_media_backup`, …), captures EXPECTED evidence from the source before dumping, destroys the source, restores into a fresh target, and validates through `createThrowawayPostgresSource` — the first real `RestoreEvidenceSource` — feeding the SAME `runRestoreValidation` core production code calls. Expected and actual are physically separate code paths: the adapter has no field capable of holding a source-side value, and every method queries the target fresh; this was proven by mutating the restored target's checksum after restore and observing the reported digest change to match. Real, Docker-executed results: golden round trip → VALIDATION_PASSED (16/16 tables, matching manifest digests); three isolated sequential corruptions (a `NOT VALID` FK constraint, a mutated `checksum_sha256`, a deleted row) each → VALIDATION_FAILED with the exact expected `reasonCode`; an unreachable target → RESTORE_NOT_READY. Cleanup (both containers, the temp dump, the temp evidence file) was verified on success and on a deliberately injected failure. `supabase/tests/lib_pg_migrations.sh` is now the one place either harness discovers migrations — by globbing the directory, not naming files — which is also the fix for the drift that had left `20260828000000_rls_grant_hardening.sql` unapplied by the original harness. This proves `LOCAL_REAL_POSTGRES_BACKUP_RESTORE_ROUNDTRIP` only: live Supabase PITR remains DEFERRED_EXTERNAL, S3→R2 restore-back stays defined-not-implemented under Phase 9-D, and no schedule was added.

- **A DLQ redrive decides safety, not success (15-D/1).** `src/lib/aws/dlq-redrive/` answers one question for a message parked in the real, production-provisioned `cinefield-provider-dlq.fifo`: given durable Cinefield evidence, would moving it back to `cinefield-provider.fifo` be safe — never whether it would succeed. `SAFE_TO_REDRIVE` is reachable through exactly one branch (attempt `pending`, `submission_evidence = 'none'`, generation `queued`/`processing`) and every other combination — ambiguous evidence, an in-flight claim, a terminal attempt or generation, a message disagreeing with durable truth, an unreadable evidence source, or any status the closed `GenerationAttemptStatus` union does not yet name — refuses through a distinct named state rather than a generic fallback; a pinned array over the six states and a one-member `REDRIVE_PERMITTED_STATES` set are both tested directly. The evidence source is a two-method read-only interface (mirroring 15-C/1's `RestoreEvidenceSource`); the real adapter reuses `readAttempt` — the same function `provider-command-handler.ts` and `attempt-submission-service.ts` already trust — and reads the generation through `select("status")` only, narrower than any other generation read in the codebase. Safety is why: a redrive re-enters through the same worker path as any other delivery, so the SAME atomic claim (`claimAttemptForSubmission`) that already protects direct dispatch and duplicate SQS delivery protects a redriven message identically — this engine never calls a provider, never mutates `cost_amount`/credits/the ledger, never writes to the database at all (every method is a read), and never calls a real AWS redrive API, each proved by a structural scan of the package's source, not merely by inspection. It does not duplicate `CommandClassification` (a different, in-flight question `provider-command-handler.ts` answers) — a structural test cross-checks this engine's terminal/submittable literals against that file's own source so the two cannot silently diverge. `evaluateProviderDlqMessage` is real, production-shaped logic with no scheduled or automatic caller in this batch, deliberately: a redrive decision is investigation-driven, not timer-driven, and wiring a schedule with nothing yet to feed it real DLQ bodies would be the "built but never wired" defect this codebase has repeatedly removed elsewhere. No new Phase 13-D alert type was added — DLQ depth already alerts through the existing external CloudWatch/SNS path, and nothing here schedules a caller that could raise one honestly. No real AWS redrive call, no second queue, no second DLQ, no second CloudWatch alarm, no RTO/RPO number, and no region-outage runbook exist in this batch.

- **No target never becomes met (15-D/2).** `src/lib/recovery/` classifies a real recovery's evidence — pure arithmetic, no incident detection, no AWS, no provider, no money, no database write of any kind. `RTO_TARGETS`/`RPO_TARGETS` (`recovery-target-registry.ts`) ship `{}`: no business-approved recovery-time or data-loss commitment exists in this repository, and `resolveRtoTargetMs`/`resolveRpoTargetSeconds` return `null` for anything unconfigured or malformed, never a fabricated number. `RECOVERED_NO_TARGET` is its own state in the six-member `RecoveryResultState` union for exactly this reason — an empty registry can never read as "everything met its target," and `rtoMet`/`rpoMet` stay `undefined`, never `true`, absent a resolved target. `measureRecovery` takes `now` as a required parameter and never calls `Date.now()`/`new Date()` itself, so identical input always produces identical output; every timestamp is validated for parseability and chronological order, and a malformed (`NaN`/negative/`Infinity`) data-loss observation is rejected rather than coerced to zero, before any duration is computed. `RECOVERY_INCOMPLETE` covers both "not yet restored" and "restored but required validation did not pass"; `EVIDENCE_UNAVAILABLE` is reserved for required evidence that could not be obtained AT ALL — the same known-negative-fact-vs-missing-fact distinction 15-D/1's `REFUSE_INSUFFICIENT_EVIDENCE`/`UNAVAILABLE` split already draws. A proven breach on either the RTO or the RPO axis always outranks a met target on the other, mirroring `runRestoreValidation`'s own MISMATCH-beats-UNAVAILABLE-beats-MATCH ordering. Three boundaries are consumed, never re-derived: Phase 13 health (`isRuntimeConsideredRecovered` is a one-line `status === "HEALTHY"` predicate over an already-obtained `ReadinessReport`, DEGRADED is deliberately not recovered), Phase 15-C restore validation (`database_recovery`/`media_recovery` gate on an already-computed `RestoreValidationState` being exactly `VALIDATION_PASSED`, never recomputing checksum/row-count/referential-integrity logic), and Phase 14-D rollback authority (untouched — a bad-release decision and a recovery-time measurement remain two separate questions). Three new 13-D alert types (`recovery_rto_breached`, `recovery_rpo_breached`, `recovery_evidence_unavailable`; all ERROR, none user-visible, all `remediationEligible: false` in `incident-diagnosis.ts`) raise only on a PROVEN breach or PROVEN missing required evidence — `RECOVERED_NO_TARGET`, `RECOVERY_INCOMPLETE` and `INVALID_EVIDENCE` all raise nothing. No incident-detection wiring, no live `serviceRestoredAt` stamping, no RTO/RPO numbers, no region-outage runbook, no chaos infrastructure, no UI, and no migration exist in this batch.

- **A manual investigation can only ever observe (15-D/3).** `scripts/dlq-investigate.ts` — run manually, no HTTP route, no scheduler — peeks at most one message from the real `cinefield-provider-dlq.fifo` and evaluates it through the UNMODIFIED Phase 15-D/1 decision engine. `adapters/sqs-dlq-message-source.ts` is the package's first real AWS integration point, and it is non-destructive by construction rather than by discipline: `ReceiveMessageCommand` with `VisibilityTimeout: 0` means the message is immediately visible again to any other reader the instant the call returns, so there is no visibility window to later restore because none is ever opened, and no `DeleteMessageCommand`/`ChangeMessageVisibilityCommand`/`StartMessageMoveTaskCommand`/`SendMessageCommand`/`PurgeQueueCommand`/`SetQueueAttributes` import exists anywhere in the file — a structural test scans for exactly these command names, narrowed from 15-D/1's original blanket `@aws-sdk` ban now that the package legitimately contains one reviewed read-only adapter. `dlq-investigation-service.ts`'s `investigateProviderDlq` calls `evaluateDlqRedriveDecision` — the SAME engine `evaluateProviderDlqMessage` already calls — and passes its verdict through verbatim; a structural test confirms the literals `"SAFE_TO_REDRIVE"`/`"REFUSE_..."` appear nowhere in the service outside that one import. Four outcomes only: `NOT_CONFIGURED`, `SOURCE_UNAVAILABLE`, `NO_MESSAGE` (the DLQ is empty right now — ordinary, never an error), and `DECIDED` (the engine's own six-state verdict, unmodified). `CINEFIELD_SQS_PROVIDER_DLQ_URL` is registered in `secret-registry.ts` and `.env.example` as identifier-class, not a secret — authority is IAM. The script deliberately skips `assertStartupConfiguration`: that gate refuses an invalid PRODUCTION RUNTIME at process start for a long-lived worker, and applying it here could make a narrow investigation tool refuse to run during exactly the messy-production-config moment it exists to diagnose; the AWS/Supabase credentials the script already requires ARE the access control. The Phase 15-D/2 audit's one finding — the RTO `duration == target` boundary was correct by implementation (`<=`) but never directly asserted — is closed with a single pinning test in `phase-15d2-recovery-rto-rpo.e2e.test.ts`; no production arithmetic changed. Real AWS redrive execution, any scheduled invocation of this path, RTO/RPO numbers, a region-outage runbook, and chaos infrastructure all remain exactly as deferred as before.

- **Phase 16 presents; Phase 13 still owns health (16/1).** `src/app/admin/` — inside the existing single Next.js app, no `apps/admin` monorepo split, reconciling the roadmap's stale wording to repository reality (a structural test asserts no `apps/` directory exists). `decideAdminAccess()` (`src/lib/admin/admin-auth.ts`) is the one canonical authorization decision both `/admin`'s layout and `/api/admin/health` call, through the thin I/O wrapper `requireAdminAccess()` (`require-admin-access.ts`, the only file that imports `@clerk/nextjs/server` — split out specifically because that import makes a module unloadable by this repository's `node:test` harness, the same reason `admin-route-service.ts` takes a `clerkUserId` parameter rather than importing Clerk itself). No session, wrong session, or an unreadable allowlist source all deny; nothing resolves to `allowed: true` without both a real Clerk session and an explicit match. `CINEFIELD_ADMIN_CLERK_USER_IDS` is an explicit bootstrap, deliberately a SEPARATE variable from Phase 7-B's `ROUTE_ADMIN_CLERK_USER_IDS` (a structural test asserts `admin-auth.ts` never references the older one) — an honest stopgap given the repository has no admin role, no admin claim, and no org-based RBAC today, structured so a real role system later replaces only `isBootstrapAdmin`'s internals. `admin-health-service.ts` calls Phase 13's own `readiness()` once per `RuntimeName`, concurrently; `admin-health-projection.ts` reshapes the results into a bounded UI projection — `HealthStatus`/`HealthReason`/`Criticality` imported unchanged, `UNKNOWN` never upgraded, `UNREADY` always the worst `overallStatus`. `/api/health/live` is untouched. Every mutation path a Phase 16 screen could eventually wrap (DLQ redrive, route/provider mutation, kill switch, quarantine release, restore execution, deploy/rollback, billing) is structurally absent from this slice — proven by scanning for each specific identifier, not by inspection alone.

- **The real trace chain, not the roadmap's assumed one (16-A/2).** `generations`/`generation_attempts` have no `trace_id` column — the only persisted correlation is `outbox_events` rows with `aggregate_type = 'generation'` and `aggregate_id` = the generation id, and even there `trace_id` is nullable (`claim_generation_tx` writes `p_trace_id: null` unconditionally; `complete_generation_tx` and the cancel/failure paths pass a real one only when one existed at that moment). `getGenerationInvestigation()` (`generation-investigation-service.ts`) runs four narrow, concurrent, explicit-column, `LIMIT`-bounded reads — `generations`, `generation_attempts`, `outbox_events`, `media_assets` — and `buildTraceChain()` (pure) derives each link's status from what was actually found for that one generation: `AVAILABLE` with the real value, `NOT_PERSISTED` when absent, and `artifact_id` fixed at `NOT_APPLICABLE` because no distinct "artifact" concept exists in this schema beyond `media_assets` itself — nothing is inferred or guessed. Reuses the same `requireAdminAccess()` boundary and opaque-404 convention as `/api/admin/health` (16/1); a genuine miss and a denial share the same status code and are told apart only by response body shape, a distinction a non-admin caller can never observe. Reuses the existing `GENERATION_ID_PATTERN` from `generation-api-contract.ts` rather than a second copy, and rejects a malformed id before it ever reaches a query. No prompt, payload, cost figure, or storage location is ever selected by any of the four reads — the boundary is the query itself, not a filter applied afterward. No action of any kind exists in the UI; Users/Workspaces/Risk remain unbuilt.

- **The canonical user owner is `profiles`; the independent-read split is defensive discipline, not a grant workaround (16-A/3, corrected 16-A/4).** `public.profiles` (`clerk_user_id` primary key) is the one user-identity table in this schema; `generations.clerk_user_id` and `projects.clerk_user_id` both carry `REFERENCES profiles(clerk_user_id) ON DELETE CASCADE`. No workspace table exists at all — "workspace" means `projects` here (16-A/4 builds the read-only investigation screen for it; see below). `getAdminUserInvestigation()` (`user-investigation-service.ts`) runs two narrow, explicit-column reads — `profiles` (one row, by `clerk_user_id`) and `generations` (≤20 rows, by the same `clerk_user_id` ownership column 16-A/2 already trusts, `created_at desc`) — as two INDEPENDENT fallible reads rather than one shared `Promise.all` + one catch. **Correction:** 16-A/3 originally claimed this split existed because `profiles` grants `service_role` only `REFERENCES,TRIGGER,TRUNCATE,MAINTAIN` — no `SELECT` — citing only `20260805132704_remote_schema.sql`. The 16-A/3 post-implementation audit (carried forward in 16-A/4) found a later migration, `20260811120000_credit_system.sql` (line 127), issues `GRANT ALL ON TABLE "public"."profiles" TO "service_role"`, and no migration anywhere ever revokes anything from `service_role` on any table — repository evidence is `PROFILE_SERVICE_ROLE_SELECT_REPOSITORY_STATUS: CONFIRMED_PRESENT`, `PROFILE_GRANT_GAP: NONE`, and no migration was or is needed. The independent-read split is kept anyway as ordinary defensive discipline (any `profiles`-specific failure, for any reason, degrades to `PARTIAL_DATA` rather than discarding real generation evidence), not because a gap is expected. `PARTIAL_DATA` (a state the client-state layer keeps distinct from `FOUND`/`NO_GENERATIONS`/`EVIDENCE_UNAVAILABLE`) names exactly "we have real generation evidence for this identity but the profile enrichment could not be read." `EVIDENCE_UNAVAILABLE` covers the case where neither read can confirm existence either way. Same `requireAdminAccess()` boundary and opaque-404 convention as 16/1 and 16-A/2. `email`/`username`/`avatar_url` and the billing-adjacent `credits`/`plan` are deliberately never selected — the latter two sit on the same Phase 10 economic-truth boundary 16-A/2 already drew around `cost_amount`/`cost_currency`. Each recent-generation row links to `/admin/generations?generationId=<id>` by id — the existing 16-A/2 surface is reused, never re-implemented (a structural test asserts the new files never re-declare `buildTraceChain`/`TraceChainLink` or re-query `outbox_events`/`generation_attempts`/`media_assets`).

- **"Workspace" is `projects`, and the owner link stays a reference, never a re-implemented lookup (16-A/4).** No `workspaces` or `workspace_members` table exists anywhere in this schema; the closest and only canonical concept is `public.projects` (`id` uuid PK, `clerk_user_id NOT NULL REFERENCES profiles`, `title` 1–150 chars, `status` enum, timestamps), and `generations.project_id REFERENCES projects(id) ON DELETE CASCADE`. The screen is labelled "Workspace / Project" throughout — naming the roadmap concept honestly without inventing a second entity. `getAdminWorkspaceInvestigation()` (`workspace-investigation-service.ts`) runs two narrow, explicit-column, independent-fallible reads — `projects` (one row, by `id`: `id, title, status, clerk_user_id, created_at, updated_at` — `description` and `thumbnail_url` excluded) and `generations` (≤20 rows, by `project_id`, `created_at desc`) — the same `PARTIAL_DATA`/`NO_GENERATIONS`/`WORKSPACE_NOT_FOUND`/`EVIDENCE_UNAVAILABLE` outcome shape 16-A/3 established, with `FOUND`/`EVIDENCE_UNAVAILABLE`/`PARTIAL_DATA` semantics unchanged in kind. There is no `OWNER_NOT_AVAILABLE` outcome: `projects.clerk_user_id` is `NOT NULL` on the very row that establishes the workspace's existence, so it can never independently fail once the workspace is found — inventing that outcome would fabricate a failure mode this schema cannot produce, the same "`NOT_APPLICABLE`, not invented" standard 16-A/2 already applies to `artifact_id`. The owner is exposed as a bare `clerk_user_id` reference linking to `/admin/users?clerkUserId=<id>` (16-A/3, unconsumed query param today — the same precedent 16-A/3's own link to `/admin/generations?generationId=<id>` already set); no `profiles` read happens in this service at all. By-owner project listing (list all projects a user owns) was deliberately deferred — ownership is not ambiguous, but the brief asked for the narrowest service, and a list endpoint is a second query shape this slice does not need to answer its primary question. Same `requireAdminAccess()` boundary and opaque-404 convention as every other Phase 16 admin route. Workspaces and Risk remain the official 16-A package; this slice completes Workspaces. (Risk and Dashboard completion followed in the 16-A closure batch — see below. **Phase 16-A is now implementation-complete.**)

- **Risk reads the one canonical evidence log, `security_events`; Dashboard links out to everything real (16-A closure).** No second risk score, fraud model, incident classifier, or event store is created. `public.security_events` (Phase 12-C) already carries `risk_score`/`recommended_action` per row, written at record time by the pure `assessRisk()` (`risk-engine.ts`); `risk-investigation-service.ts` reads those columns verbatim and never re-invokes the scorer (double-counting recurrence would silently disagree with the row's own score). `service_role` has held `SELECT` on `security_events` since its creating migration, unchanged since. No other TypeScript in the repository reads this table back — this is its first reader. Three lookup axes, each a real column: `clerk_user_id` → `actor_clerk_user_id` (+ `media_assets.clerk_user_id` as secondary, supporting evidence); `generation_id` → `resource_type='generation' AND resource_id=<id>` (generic text reference, not an FK, + `media_assets.generation_id`, an actual FK); `trace_id` → `security_events.trace_id` only (`media_assets` has no such column, so that axis never attempts a second read). `project_id` and `subject_hash` are deliberately NOT lookup axes — the first has no column to join on without fabricating an owner-proxy correlation, the second is a one-way hash this surface does not attempt to re-derive. `security_events` (primary) and `media_assets` (secondary) are independent fallible reads; a successful-but-empty primary combined with a failed secondary is `PARTIAL_RISK_EVIDENCE`, never silently upgraded to `NO_RISK_EVIDENCE`, and a failed primary combined with an empty secondary is `RISK_SOURCE_UNAVAILABLE` — an empty secondary can never stand in for an unread primary. Observational only: a structural test bans `recordSecurityEvent`/`assessRisk`/quarantine-release/suspend/kill-switch/billing identifiers by name in every new file. `/admin` (System Health) gains a static "Start an investigation" section (`AdminInvestigationEntryPoints.tsx`, no fetch, no fake metric) linking to Users/Workspace/Project/Risk/Generations; the layout nav gains a real `Risk` link, leaving `Incidents`/`Cost/FinOps`/`Restore`/`Recovery`/`DLQ`/`Providers` as labels for later Phase 16 packages. `phase-16-a-closure-end-to-end.e2e.test.ts` proves the official done criterion directly: one seeded generation, walked from a user id and a project id, both arriving at the byte-identical `getGenerationInvestigation` result, with Risk evidence joining the same real ids (never fabricated) and a companion test proving the negative (no evidence recorded → `NO_RISK_EVIDENCE`, never an invented link). A cross-16-A sweep test walks every admin lib/api/page/component file in one pass for the sensitive-data boundary, the zero-mutation guarantee, single-admin-auth-boundary reuse, and `privateJson`/no-store on every route. **Phase 16-A is implementation-complete**: Dashboard, Users, Workspace/Project, Risk, Generations, Attempts, and Traces are all real, read-only screens.

- **Phase 16-B adds real mutation, through existing owners only, never a second implementation of any of them.** Official scope: Failed Jobs/DLQ, SQS command health, BullMQ auxiliary health, Models/Providers/Router controls. Binding ownership preserved throughout: Temporal (generation lifecycle), SQS (critical transport), Phase 15-D (redrive safety decision), BullMQ/Redis B (auxiliary-only), Phase 7 (routing mutation), Phase 13-D (alerting), Phase 13-E (sensitive-data boundary) — Phase 16 is presentation plus a narrow authorized action surface, never a second queue engine, lifecycle owner, routing evaluator, or alert router. `POST /api/admin/dlq/redrive` is the one genuinely new mutation primitive: standard SQS semantics mean a specific DLQ message can only be targeted by receiving it with a REAL visibility timeout (claiming it) — the existing Phase 15-D/3 investigation adapter's `VisibilityTimeout: 0` peek structurally cannot yield a usable receipt handle — so `sqs-dlq-redrive-executor.ts` (same `dlq-redrive` package, not a new one) receives with a short real claim window, evaluates through the UNMODIFIED `evaluateDlqRedriveDecision` (Phase 15-D/1) against the body it just received, and either sends+deletes (only on a fresh `SAFE_TO_REDRIVE`) or releases immediately on any refusal. `StartMessageMoveTaskCommand` is deliberately never used (queue-wide, no per-message target). The orchestration is split behind an injectable `DlqRedriveQueueClient` (mirroring `DlqMessageSource`'s existing split) so the full flow is tested with a fake at zero AWS cost; two existing Phase 15-D package-wide structural bans on `SendMessageCommand`/`DeleteMessageCommand`/`ChangeMessageVisibility` were narrowed — not weakened — to exclude exactly this one file, with a companion test re-asserting the ban everywhere else. The existing atomic attempt claim (`claimAttemptForSubmission`) remains the sole protection against double execution once a redriven command is delivered. BullMQ (Redis B) is genuinely unprovisioned in every environment and none of its four named queues has a real job producer yet — `bullmq-admin-service.ts` calls the real, unmocked BullMQ API and every test asserts the honest `NOT_CONFIGURED` outcome, matching `bullmq-foundation.test.ts`'s own established testing philosophy; this is `DEFERRED_EXTERNAL`, not a stub. `router-admin-service.ts` wraps `listRoutesForAdmin`/`setRouteEnabled` (Phase 7-B) unmodified, distinguishing the separate `ROUTE_ADMIN_CLERK_USER_IDS` authority layer (`ROUTE_AUTHORITY_DENIED`) from Phase 16's own `requireAdminAccess()` denial; `setRouteEnabled`'s boolean parameter already gives one reversible mutation for both disable and re-enable, so `setRuntimeRoutingControl` (Phase 7-E's separate, policy-gated, TTL runtime-control path) stays real and unmodified but deliberately unwired here. The Models/Providers page deliberately never reads `model_routes` (ROUTE_ADMIN-gated) or recomputes circuit-breaker routing eligibility (would be a second routing evaluator). Every mutation requires `requireAdminAccess()`, a fresh server-side safety recheck immediately before acting, a required reason, and a `createLogger()` audit line (Phase 13-E-guarded) — deliberately NOT dual-control/passkeys/step-up auth/OPA, which remain Phase 16-E's. Extending Phase 12-E's policy registry for these three actions was considered and deliberately not done — it would mean deciding role/two-person requirements unilaterally. No durable, queryable audit table exists yet (`security_events`'s `kind` taxonomy is DB-CHECK-constrained, and this batch prefers no migration) — a named, undisguised gap for Phase 16-E to close. **Phase 16-B does not start 16-C.**

- **Policy asks the Risk Engine; it never becomes one.** The gate reads 12-C's CONCLUSIONS — is this subject blocked — as one input among several, fetched from Redis/PostgreSQL rather than accepted from a caller. It does no scoring, and the two components stay separate modules with separate owners.

- **Policy input is an allowlist, and the decision log is the existing one.** No `metadata`, no `payload`, no index signature, and tests fail on any prompt-, secret- or URL-shaped field — a policy input travels into a log that gets read during incidents. Decisions land in `security_events` with a `policy_version`, both outcomes recorded, because a log holding only refusals cannot answer who released what. A second append-only store would mean a second retention policy, a second set of grants, and a second place nobody checks.

- **A security decision is arithmetic a person can check, and it recommends rather than acts (12-C).** The Risk Engine reads four things — the kind's fixed severity, how many windows the subject produced the signal in, whether the subject is authenticated, and whether the subject CAUSED the event — and returns a score, an action name and the factors behind it. No classifier, no clock, no randomness, and it imports nothing but its own contract, which is the strongest available statement that it cannot create a generation, move a credit, release quarantine or call a provider. `admin_review` is a REQUEST for a human; Phase 16 owns performing admin actions and Phase 19 owns policy-as-code.

- **A subject is not always an actor, and the response is capped accordingly.** When a provider returns a result URL aimed at cloud metadata, the only identity in scope is the account that asked for a video. The signal still scores `high` — it IS alarming — but a subject who did not cause an event can never be challenged or temporarily blocked; the strongest response is to ask a human to look. The score is not suppressed, so the row records both the severity and the reason the response was limited.

- **Storm control is the schema, and it bounds notifications as well as writes.** One row per `(dedupe_key, window_started_at)`, enforced by a unique index. An attacker generating ten thousand refusals cannot turn the security logger into a database amplifier, and cannot turn a user's notification channel into one either. The cost is that magnitude WITHIN a window is not stored; escalation reasons in windows, not requests, and a mutable counter would have made the evidence rewritable. Coalescing is per subject, so one noisy account cannot suppress another's evidence.

- **Security evidence is append-only for every role, service_role included.** A `BEFORE UPDATE OR DELETE` trigger refuses both. Retention is Phase 23's to lift deliberately. Raw rows are operator data behind service_role — exposing them would hand an attacker the detection rules along with their own score; a user receives a projected `security.warning` carrying a reason code and a severity, and nothing else.

- **A security warning travels the Phase 11 outbox path like every other notification.** The Risk Engine never publishes to Redis: the dispatcher owns that arrow and a second one would be a second thing to get wrong. Making that work required `outbox_tenant_for_aggregate` to learn the `security_event` aggregate — the emitter's signature stayed byte-identical, preserving the post-overload invariant that there is exactly ONE place a tenant can come from. An untenanted signal emits no warning rather than creating unroutable debt.

- **Security logging can fail without reopening what it refused.** Every reporter returns void and every write is detached; the refusal has already been decided and returned before the logger is called. A lost log line is the correct failure mode, because the alternative is a control that admits the request it just denied.

- **Every API route declares what kind of thing it is, and the limit comes from that (PRE-12).** Rate limits live in one policy table keyed by route CLASS — `paid_compute`, `durable_write`, `authenticated_read`, `realtime_connect`, `public_dev_stub` — not as numbers copied into fourteen handlers. Redis A owns the counters; Redis B is not involved and there is no in-memory fallback, because a process-local counter on serverless is not a limit. `consumeRateLimit` had existed since 6R.7 with zero production callers while `generate` could spend money; a structural guard now fails the build if the canonical limiter loses its callers or a route ships unclassified.

- **Fail-closed is decided per class and argued, never universally.** A path that can spend money or create durable work refuses when Redis cannot answer: the outage is exactly when an unlimited paid path is most dangerous, and a refusal is recoverable while an unbilled provider run is not. Only a catalog read and an in-memory dev stub fail open, and both are named in the table rather than implied.

- **The rate limiter counts requests; 11-D counts connections. They are not the same control.** A client can be inside one and outside the other. The limiter may not touch a connection lease, and a test asserts it does not. What they share on purpose is the trusted-IP derivation — two controls disagreeing about a caller's address would be worse than either alone. Both sit BELOW the future Cloudflare/Vercel edge, which stops crude floods but knows nothing about which user is spending or which endpoint costs money.

- **A private response says so rather than inheriting it.** Every route returns through `privateJson`, emitting `private, no-store` explicitly. The framework default is safe today only because every route is dynamic — which is exactly the assumption a CDN in front of the origin breaks, and putting one there is what 12-A's edge half does. Public immutable assets are untouched: nothing blanket-privatises in `next.config.ts` or `proxy.ts`.

- **One outbox row can be owed to more than one sink, and the lanes are separate (Phase 11 closure).** `outbox_events` was built for exactly one delivery — one `status`, one `published_at`, one claim. Phase 11 needed the same row delivered to Redis Streams as well, and overloading those columns would have produced a silent correctness bug: Kafka marking a row published makes it invisible to the realtime claim forever, and the user never receives the notification. The existing columns are now explicitly the KAFKA lane; a parallel `realtime_*` set carries realtime with its own claim, attempts and completion. Additive only, and proven independent in both directions. A generic deliveries table was rejected as the wrong amount of machinery for two known sinks.

- **A committed fact reaches a browser only because a long-running dispatcher carries it.** `worker/realtime-dispatcher-worker.ts` is the production owner of the first arrow, and it is a SEPARATE process from the Temporal and provider workers on purpose: a Redis outage crashing the dispatcher must not take down provider submission. Losing realtime is a degraded UI; losing provider submission is a failed paid generation. It owns delivery and nothing else — it cannot create a generation, start a workflow, retry a provider, move credits, release quarantine or mint a URL, because it imports nothing that could.

- **The publication order IS the correctness argument.** `claim -> validate/project -> XADD -> resolve('published')`, never claim -> resolve -> publish. A crash between the XADD and the resolve leaves the row owed and the next pass republishes it, producing a duplicate transport entry with the SAME `eventId` that 11-C's dedupe absorbs. At-least-once is chosen deliberately; exactly-once would need a distributed transaction across PostgreSQL and Redis. The inverse order loses the event silently and forever while the database reports success.

- **A valid event with no browser projection is finished, not retried.** The dispatcher's dispositions stay distinct — `published`, `not_user_facing`, `unroutable`, `invalid` are all terminal, and only a transport failure returns a row to pending. Retrying a correct decision forever is a busy loop; retrying a malformed event reproduces it identically forever; and an unroutable event is counted rather than retried into silence, so an emitter that forgot to capture a tenant is visible.

- **The tenant a realtime connection may observe is fixed before its body exists (Phase 11-D).** Principal to membership to effective tenant resolves ONCE, is captured in a const, and is never reassigned; the stream key derives from it before `Last-Event-ID` is read. Verified live: `?workspace=`, `?user=`, `?channel=` and `?stream=` return 401 exactly as the bare path does, because none of them is read at all. **There is no workspace yet** — no table, no column, no Clerk organization — so membership is honestly the identity relation and `workspaceId` is null. A membership table was not invented: a fake check returns a fake answer, and a boundary built on one is worse than an honest narrower boundary.

- **Connection slots are counted where every instance can see them, and the count is atomic.** Serverless invocations share no memory, so a process counter would permit the ceiling per instance and reset on every cold start. Each scope is a Redis A sorted set whose members are lease ids and whose scores are expiry timestamps — which gives counting, crash safety and idle eviction from one structure, where an `INCR`/`DECR` pair would give none of them (a lost `DECR` is a slot lost forever). Acquire, refresh and release are each a single Lua script, because `ZCARD`-then-`ZADD` from application code is a TOCTOU race. Proven live against Redis A: **40 concurrent acquires against a limit of 3 admitted exactly 3.**

- **The connection limiter fails closed, and the IP it counts is one the platform vouched for.** An unreachable counter refuses the connection: a DoS control that disables itself during an outage is not a control. `x-forwarded-for` is client-writable and appended rather than replaced, so its FIRST entry is the client's own claim — the trusted sources are `x-vercel-forwarded-for`, `x-real-ip`, then the LAST hop, and no trustworthy address means no IP scope at all rather than one shared bucket. Addresses are normalised so one host cannot occupy several buckets, then hashed; the key holds a hash and the address is never stored or logged.

- **Two identities, and conflating them would break exactly one thing each (Phase 11-C).** `eventId` is the outbox row's id, stable across at-least-once retries, and it is the DEDUPE key. The Redis stream id `<ms>-<n>` is the roadmap's per-channel `event_seq`: monotonic, assigned atomically inside `XADD`, and the cursor `Last-Event-ID` carries. A separate counter was rejected because it would need a Lua script to stay atomic with the append, its own index to answer "after this", its own mapping to answer "is this still in the window", and it could desynchronise from the stream and invent a gap. Deduping by seq would miss the duplicate publication 11-B proved can happen; ordering by eventId is meaningless. Each does its own job.

- **A replay is provably complete or the client is told to reconcile.** `decideResume` returns `replay` only when the cursor is still inside the retained window; if the oldest retained entry is newer than the cursor, whatever sat between them was trimmed and completeness cannot be established. The answer is then `reconcile` and the browser refetches authoritative state — roadmap 11.7's "tam state resync". **No business event is ever synthesized to fill a gap**, and there is no third outcome in which a client believes it is caught up and is not. Replay is bounded per read and per resume; hitting the cap reconciles rather than truncating silently.

- **The resume cursor is a position inside one stream, never a choice of stream.** The key is derived from the authenticated channel BEFORE the header is read, and no path concatenates a cursor into a key. Replayed entries therefore pass the same tenant filter as live ones by construction (roadmap 11.10). A malformed cursor reconciles rather than being coerced.

- **Idempotent apply needs three defences because they fail differently.** `eventId` dedupe catches the same logical event twice; seq comparison catches an older event arriving after a newer one; and a monotone state rank stops `completed` regressing to `processing` even when there is no seq to compare — which is precisely the state a reconciling refetch produces, since it answers "what is true now" rather than "what happened at cursor X". The dedupe set is bounded to its most recent entries; an unbounded one is a leak in any tab left open.

- **A realtime failure is a delivery failure and nothing more.** The adapter never marks an outbox row published, so an unreachable Redis leaves the fact as recoverable debt. It imports nothing that could mutate a generation, retry a provider, settle credits or start a workflow — asserted, not assumed. Realtime is a signal layer; PostgreSQL remains the authority a client resyncs from.

- **An event type is a contract, checked on both sides.** SQL's `emit_outbox_event` validates only that a type is non-empty; the shape, family and schema rules live in TypeScript. 9-E drifted across that seam and emitted `media.asset.*`, which no consumer could classify. The names are now canonical `asset.*`, and a guard reads every `emit_outbox_event` literal out of the migrations — resolving each function's EFFECTIVE definition the way PostgreSQL does, last `CREATE OR REPLACE` wins — and refuses any type that fails the envelope pattern, `familyOf()`, `topicForEventType()` or the schema registry.

- **The notification channel is captured, not looked up, and never supplied.** `outbox_events.tenant_id` is written inside the emitting transaction from the row the caller just wrote or locked, so routing is fixed at the moment the fact became true rather than depending on mutable state a delivery-time join would read. NULL means "not captured" and **refuses** — there is no fallback, global or admin channel. `ChannelId` is a branded type whose only constructor takes a database-captured tenant, so a user id from a request body cannot be passed where a channel is expected. The roadmap forbids `/events?workspace=...`; here it is not merely unimplemented, it is unrepresentable.

- **A notification carries copied fields, never a forwarded payload.** `outbox_events.payload` is unrestricted jsonb; a spread would publish whatever a future emitter adds. Each projector names its two or three fields, so object keys, signed URLs, provider internals, prompts, stack traces and quarantine approver identities cannot reach a browser even if an emitter puts them in a payload. Asset safety events validate and route but project to nothing: Phase 12 owns the user-facing security taxonomy, and `media_safety_audit` stays service_role-only.

- **`backup_etag` is not a checksum.** It is S3's ETag verbatim, recorded for audit; for multipart or SSE-KMS objects it is not an MD5 of the content. Verification is the byte count from `HeadObject`, and content identity is the Phase 9-B `checksum_sha256` over the canonical bytes.
- **Restore contract (defined, not yet implemented).** A restore reads a named S3 object version and writes it back as the R2 canonical object for its asset, then re-runs the 9-B ingest gate — a restored object is untrusted media like any other. It is a server-side operation with an explicit asset id and version; **no browser may invoke it**, and it may never be triggered automatically by an R2 read failure.
- **Provider success, storage, and safety are three different facts.** Completion requires all three: the bytes in R2, an asset record finalized, AND the ingest gate having read and allowed them. A media-safety refusal raises `MEDIA_INGEST_REJECTED`, never `PROVIDER_FAILED` — a provider that did its job perfectly must not be sent to the circuit breaker because its output was refused.
- **Do not change the current database schema to match future examples in the source contract.** Section 26's full example table list (`workspaces`, `scenes`, `shots`, `characters`, `credit_ledger`, `provider_jobs`, `webhook_events`, `community_posts`, …) is target architecture. The current schema has exactly three tables: `profiles`, `projects`, `generations` (verified directly against `supabase/migrations/20260805132704_remote_schema.sql`). Do not add columns or tables speculatively to "get ahead" of a future phase.
- **Do not persist API keys, authorization headers, signed URLs, temporary provider URLs, or raw provider responses.** This is already enforced today: `output_url` stores only a private storage path (never a signed URL), provider adapters never leak raw payloads past their own file, and secrets are read from server-only env vars. This restates source sections 6, 22, and 34 as a hard current-code invariant, not just a future goal.
- **Preserve mock-image, fal-flux-schnell, Trigger.dev, mock-tts, private Storage, polling, image rendering, and audio playback.** These are real, tested, working paths (see the Implementation Checkpoints below). No future phase may modify them except through its own additive, reviewed change.
- **New integrations must be additive and tested before replacing working paths.** No phase may remove or break an existing verified capability as a side effect of adding a new one. This restates source section 46's working method as a standing rule, not just an instruction for one agent session.

---

## 1. Core Architectural Rule

The project is not built from a single AI model or a single API connection. The system consists of independent layers, each with distinct responsibilities that must not be blurred together:

1. User interface
2. Authentication
3. Project and media management
4. Credit and subscription system
5. Generation API
6. Job queue / long-running task system
7. AI Director
8. Prompt compiler
9. Model registry
10. Provider router
11. Provider adapters
12. Generation worker
13. Webhook and polling system
14. File storage
15. Media processing
16. Security and moderation
17. Logging and observability
18. Community and sharing
19. MCP integration
20. Admin panel

**Current implementation note:** layers 1 (UI, Next.js App Router), 3 (projects/generations rows), 5 (`/api/orchestration/execute`), 6 (Trigger.dev), 9 (model registry), 11 (provider adapters), 12 (`executeGeneration`), and 14 (Supabase Storage) exist today for image and audio (text-to-speech). Layers 2 (Clerk) and parts of 16 exist for auth. The remaining layers (4, 7, 8 as a distinct module, 10 as a distinct module, 13 as webhooks specifically, 15, 17 beyond basic logs, 18, 19, 20) are target architecture, not yet built.

## 2. Target System Architecture

The source contract's diagram (preserved verbatim below; original Turkish labels) describes the eventual full request path: user → Next.js frontend → Clerk / upload → Next.js backend API → authorization/credit/input checks → Supabase → Trigger.dev → Cinema Worker → AI Director / Prompt Compiler / Asset Analyzer → Cloudflare AI Gateway → Provider Router → fal.ai / Runway / Google Veo / Kling / others → Webhook/Polling Manager → Result Normalizer → R2 / Supabase DB / FFmpeg → user result.

```
                        KULLANICI (USER)
                            │
                            ▼
                    Next.js Frontend
                            │
               ┌────────────┴────────────┐
               ▼                         ▼
             Clerk                 Upload sistemi
       Kimlik doğrulama            Signed URL
       (Authentication)
               │                         │
               └────────────┬────────────┘
                            ▼
                   Next.js Backend API
                            │
            ┌───────────────┼────────────────┐
            ▼               ▼                ▼
       Yetki kontrolü   Kredi kontrolü   Input doğrulama
       (Authorization)  (Credit check)   (Input validation)
            │               │                │
            └───────────────┼────────────────┘
                            ▼
                     Supabase Database
                            │
                    Generation kaydı
                    (Generation record)
                            │
                            ▼
                       Trigger.dev
                            │
                            ▼
                       Cinema Worker
                            │
       ┌────────────────────┼─────────────────────┐
       ▼                    ▼                     ▼
  AI Director         Prompt Compiler       Asset Analyzer
       │                    │                     │
       └────────────────────┼─────────────────────┘
                            ▼
                    Cloudflare AI Gateway
                            │
            ┌───────────────┼────────────────┐
            ▼               ▼                ▼
       Metin modeli     Vision modeli    Moderasyon
       (Text model)     (Vision model)   (Moderation)
                            │
                            ▼
                     Provider Router
                            │
       ┌────────────┬───────┼────────┬────────────┐
       ▼            ▼       ▼        ▼            ▼
     fal.ai       Runway   Google   Kling API   Diğerleri
                         Veo API                (Others)
       │            │       │        │            │
       └────────────┴───────┼────────┴────────────┘
                            ▼
                 Webhook / Polling Manager
                            │
                            ▼
                      Result Normalizer
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
             R2        Supabase DB       FFmpeg
              │             │             │
              └─────────────┼─────────────┘
                            ▼
                     Kullanıcı sonucu
                     (User result)
```

**Current implementation note:** today's real path for a completed generation is: browser → Supabase insert → `POST /api/orchestration/execute` (Clerk-authenticated) → direct execution or Trigger.dev dispatch (`GENERATION_EXECUTION_MODE`) → `executeGeneration()` (claim → normalize → route → validate → provider adapter `submit`/`getResult` → `normalizeOutputs` → upload to Supabase Storage → `markCompleted`) → signed URL minted only for the response → browser renders image or `<audio controls>`. There is no Cloudflare AI Gateway, no AI Director, no Prompt Compiler, no R2, and no FFmpeg in the current path — those are target architecture (Phases 5A–13).

## 3. Frontend Responsibility

The frontend manages user experience only: sign-in/sign-up, model selection, prompt input, reference upload, resolution/aspect-ratio/duration selection, camera and style settings, project creation, generation status display, result gallery, credit display, generation history, project sharing, and readable error messages.

The frontend must **never**: carry a provider API key, call fal.ai or Runway directly, compute credits, decide model pricing, choose a provider endpoint, block waiting on a long job, or trust a model id sent by the user.

The frontend must send only safe, limited parameters to the backend, e.g.:

```json
{
  "projectId": "project_123",
  "modelKey": "runway-image-to-video",
  "prompt": "A cinematic fashion scene",
  "aspectRatio": "16:9",
  "durationSeconds": 5,
  "assetIds": ["asset_456"]
}
```

The frontend must never send:

```json
{
  "providerEndpoint": "https://provider.example/generate",
  "providerApiKey": "...",
  "rawProviderModelId": "..."
}
```

**Current implementation note:** already true today — `CinemaStudioWorkspace.tsx` sends only `{generationId}` to `/api/orchestration/execute`; ownership, model, provider, and settings are resolved server-side from the database and the model registry, never trusted from the request body.

## 4. Model / Provider / Feature Are Three Distinct Concepts

- **Provider**: the company/platform offering the API (e.g. `fal`, `runway`, `google`, `replicate`, `cloudflare`, `openai`).
- **Model**: the actual AI model doing the generation (e.g. Veo, Kling, Seedance, Runway Gen, FLUX, Whisper, Llama, Qwen).
- **Feature / product mode**: the user-facing generation experience (e.g. Cinema Studio, Image-to-Video, Product Commercial, AI Director, Character Builder, Storyboard, Upscaler, Lip Sync, Camera Motion).

A feature is not the same as one model. Cinema Studio ≠ one video model — it is AI Director + prompt compiler + camera settings + character references + model selection + video generation + result processing, combined.

**Current implementation note:** the model registry already separates `id` (Cinefield-internal), `providerId`, and `providerModelId` per entry — the provider/model distinction is real today. "Feature" as its own composed layer (AI Director, prompt compiler) does not exist yet.

## 5. Model Registry Is the Single Source of Truth

Every supported model must be defined in one central registry, e.g.:

```ts
type ModelDefinition = {
  key: string;
  displayName: string;
  provider: string;
  providerModelId: string;
  adapter: string;

  capabilities: {
    textToImage: boolean;
    imageToImage: boolean;
    textToVideo: boolean;
    imageToVideo: boolean;
    videoToVideo: boolean;
    audio: boolean;
    lipSync: boolean;
  };

  limits: {
    durations?: number[];
    aspectRatios?: string[];
    maxReferenceImages?: number;
    maxPromptLength?: number;
    supportedResolutions?: string[];
  };

  pricing: {
    internalCreditCost: number;
    estimatedProviderCost?: number;
  };

  availability: {
    enabled: boolean;
    maintenanceMode: boolean;
    allowedPlans: string[];
  };
};
```

No hand-written, separate model lists may exist in the frontend. The model card, price, supported duration, resolution, and aspect ratios must all be derived from the same registry data.

**Current implementation note:** `src/lib/orchestration/model-registry.ts` already implements this principle with `ModelRegistryEntry`/`ModelCapabilities` — narrower in scope today (no `pricing`, `availability.allowedPlans`, or feature-flag fields yet, since credits/plans/feature-flags are not implemented), but structurally the same "one registry, one shape" idea. Extending it with pricing/availability fields is future work (Phase 7, Phase 9), not a reason to build a second registry now.

## 6. Provider Adapter Rule

Each provider must use its own adapter (illustrative layout from the source):

```
providers/
  fal/
  runway/
  google/
  kling/
  replicate/
  cloudflare/
```

Each adapter must expose the same standard operations:

```ts
interface GenerationProviderAdapter {
  validateInput(input: NormalizedGenerationInput): Promise<void>;
  createJob(input: NormalizedGenerationInput): Promise<ProviderJobResponse>;
  getJobStatus(externalJobId: string): Promise<ProviderJobStatus>;
  cancelJob?(externalJobId: string): Promise<void>;
  normalizeResult(rawResult: unknown): Promise<NormalizedGenerationResult>;
  normalizeError(error: unknown): NormalizedProviderError;
}
```

Provider-specific request/response types must never leak outside the adapter. No other part of the application should know fal.ai's or Runway's raw response format.

**Current implementation note (see also the override section above):** this is real today at `src/lib/orchestration/providers/provider-adapter.ts` (`ProviderAdapter`: `submit`/`getStatus`/`getResult`/`cancel`) and `src/lib/orchestration/providers/{mock,fal}-provider.ts`. The folder path differs from the source's illustrative `providers/fal/` (Cinefield uses `src/lib/orchestration/providers/fal-provider.ts`, one file per provider rather than one directory per provider) — this is an accepted, working variation, not a gap. Adapters already keep fal-specific shapes (e.g. `mapAspectRatioToFalImageSize`) private to their own file.

## 7. Normalized Generation Input

A common input shape must be built before any provider call:

```ts
type NormalizedGenerationInput = {
  generationId: string;
  userId: string;
  projectId: string;

  taskType:
    | "text-to-image"
    | "image-to-image"
    | "text-to-video"
    | "image-to-video"
    | "video-to-video"
    | "upscale"
    | "lip-sync";

  provider: string;
  modelKey: string;
  providerModelId: string;

  originalPrompt: string;
  enhancedPrompt?: string;
  negativePrompt?: string;

  inputAssets: Array<{
    assetId: string;
    url: string;
    type: "image" | "video" | "audio";
    role:
      | "start-frame"
      | "end-frame"
      | "character-reference"
      | "style-reference"
      | "source-video"
      | "audio";
  }>;

  settings: {
    aspectRatio?: string;
    resolution?: string;
    durationSeconds?: number;
    seed?: number;
    numberOfOutputs?: number;
    cameraMotion?: string;
    stylePreset?: string;
  };
};
```

Every provider adapter must convert this shared input into its own API format.

**Current implementation note:** `NormalizedGenerationRequest` in `src/lib/orchestration/types.ts` is Cinefield's real equivalent — `taskType` is called `workflow` (with its own `WorkflowType` union, now including `text-to-speech`), and `settings` already carries `voice`/`language` for audio in addition to the source's fields. `enhancedPrompt` does not exist yet (no prompt compiler/AI Director layer yet) — `prompt` is passed through verbatim, unmodified, by design (see Phase 4's Unicode-preservation guarantee).

## 8. Generation State Machine

Generation status values must not change arbitrarily. Standard states (source contract, target):

```
draft → validating → queued → submitted → processing → post_processing → uploading → completed
```

On failure: `processing → failed`. A generation must never return to `processing` after completing. Status updates must be idempotent.

**Current implementation note:** the current database `status` column supports a narrower, already-working set: `queued`, `processing`, `completed`, `failed`, `cancelled` (see `src/types/database.ts`, `Generation.status`). Finer-grained progress (`validating`, `submitted`, `post_processing`, `uploading`) already exists — but as `metadata.orchestration.stage`, a richer in-JSON value written by `status-manager.ts`, not as new database `status` enum values. **Do not add new `status` column values to chase the source contract's exact list** — the `metadata.orchestration.stage` field already serves that purpose without a schema change, per the override section above.

## 9. Idempotency Rule

A user double-clicking a button must not cause double charging. Every generation request should use an idempotency key (`user_id + project_id + client_request_id`). A repeated request must not deduct new credit, must not create a new provider job, and must return the existing generation record. A webhook delivered twice must not be processed twice.

**Current implementation note:** already implemented for the Trigger.dev dispatch path — `generationTask.trigger()` is called with `idempotencyKey: generationId` (1-hour TTL), and independently, `claimGeneration`'s `.eq("status","queued")` compare-and-set in `status-manager.ts` prevents a second execution of the same row regardless of dispatch path. No credit system exists yet, so the "double charge" half of this rule has nothing to apply to yet.

### 9.1 A committed generation is not a started workflow (M6)

`create_generation_tx()` and the Temporal start call are two separate
operations against two separate systems. Committing the row therefore does
NOT mean a workflow exists, and for a while this codebase quietly assumed it
did — `/api/generate` called the result "a durable, recoverable generation"
while nothing in the system recovered it. A crash, redeploy or Temporal
outage in that window left a row in `queued` that no worker would ever pick
up. Once Phase 10 reserves credit in the same transaction, that stranded row
takes an open reservation with it.

The intent to start is now durable. `create_generation_tx()` writes one row
into `workflow_start_outbox` in the SAME transaction as the generation, so
"committed" and "somebody is obliged to start this" became the same fact.

```
create_generation_tx()  ──┐
  generation row          │  one transaction
  workflow-start intent ──┘
        │
        ├─ fast path:  the request starts Temporal immediately and retires
        │              the intent (best effort — losing this costs nothing)
        │
        └─ relay:      claims due intents under a lease, starts the SAME
                       deterministic workflow id, marks delivered
```

Four properties make redelivery safe rather than dangerous:

- **Deterministic id.** `generationWorkflowId()` is a pure function of the
  generation id, and the starter passes `WorkflowIdConflictPolicy.USE_EXISTING`.
  Temporal itself refuses a second workflow, so at-least-once delivery costs
  at most a redundant API call. The dangerous direction — never starting — is
  the one the outbox removes.
- **An already-running workflow is a delivered intent**, not a conflict. The
  obligation was that a workflow exists, not that this caller created it.
- **Failure is never terminal.** `mark_workflow_start_failed()` returns the
  row to pending with backoff. An undeliverable start stays owed; abandoning
  it would recreate the stranded generation, just with a tidier table.
- **The relay may only start workflows.** It cannot create a generation,
  submit provider work, write generation state or touch credits — asserted by
  tests over its imports and its source. Temporal remains the sole generation
  lifecycle owner; this is a delivery guarantee in front of it, not a second
  owner.

Generations that predate the mechanism are retired rather than replayed
(`20260818010000`). Inventing an obligation retroactively is not recovery —
on the live database it would have started 91 workflows for abandoned
early-August test rows.

Audit defect **M6 = CLOSED**.

## 10. Credit and Cost System

Platform credit must be kept separate from provider cost. The following concepts must not be conflated: provider cost, platform credit price, user subscription, promotional credit, refunded credit.

Suggested tables: `credit_wallets`, `credit_ledger`, `subscriptions`, `model_pricing`, `provider_cost_records`.

Credit movements should be recorded as immutable ledger entries, e.g.:

```
+500 subscription_credit
-80  generation_reservation
+80  generation_refund
-60  final_generation_charge
```

Correct method: reserve estimated credit at generation start → send provider request → finalize real cost on success → refund credit on failure per policy → write every movement to the ledger. Merely decrementing a single `credits` number on the user table is not sufficient.

**Current implementation note — target architecture, not implemented.** No credit, wallet, subscription, or ledger tables or logic exist in the current schema or codebase. This entire section is a future phase (Phase 9 in the roadmap below). No generation currently deducts or reserves any credit.

## 11. Provider Cost Protection

Every model should define `estimated_cost`, `maximum_allowed_cost`, `user_credit_cost`, `timeout`, and `retry_policy`. Before starting a job: check user credit, check plan access, estimate provider cost, check daily spend limit, check provider maintenance state. Monthly spend limits must not be exceedable by uncontrolled continued generation.

**Current implementation note — target architecture, not implemented.** No cost-protection fields exist on the current `ModelRegistryEntry`/`ModelCapabilities` types. The fal.ai adapter has its own internal request timeout (90s) but no cost ceiling logic. Future phases (Phase 9) would add this without needing to touch the current provider adapters' core contract.

## 12. Retry and Fallback Rules

Not every error should be retried.

- **Retryable:** 429 rate limit, 502 bad gateway, 503 service unavailable, 504 timeout, transient network errors.
- **Not retryable:** 401 invalid API key, 403 forbidden, 400 invalid parameter, unsupported resolution, unsupported duration, moderation rejection, insufficient provider balance.

Retries should use exponential backoff (e.g. 30s, 2m, 5m, 15m), with a limited number of attempts per provider. Provider fallback should only apply when a compatible model exists — a user who explicitly chose a model must not be silently switched to another.

**Current implementation note:** already implemented and more precisely than the source's example backoff schedule — `OrchestrationErrorCode` in `src/lib/orchestration/errors.ts` classifies every error as retryable or not (matching the retryable/non-retryable split above almost exactly: `PROVIDER_RATE_LIMIT`, `PROVIDER_TIMEOUT`, `PROVIDER_FAILED`, `OUTPUT_MISSING`, `OUTPUT_DOWNLOAD_FAILED`, `STORAGE_UPLOAD_FAILED`, `DATABASE_UPDATE_FAILED` are retryable; `PROVIDER_AUTH_ERROR`, `PROVIDER_QUOTA_EXCEEDED`, `INVALID_INPUT`, capability errors are not). The Trigger.dev task (`src/trigger/generation-task.ts`) uses `trigger.config.ts`'s retry policy (`maxAttempts: 3`, exponential backoff with jitter) and a `catchError`/`AbortTaskRunError` hook that consults this same classification, plus a `resetForRetry` requeue step so a genuine retry can re-claim the row. No provider fallback (switching models automatically) exists — not needed yet with a single real provider (fal.ai).

## 13. AI Director's Job

The AI Director is not the generation model itself. It: understands user intent, determines scene type, structures the prompt, proposes camera direction, chooses lens and lighting, determines motion intensity, describes character/environment references, ranks candidate models, and produces the generation settings needed. Its output should be schema-validated (e.g. with Zod). It must never itself deduct credit, choose an API key, call a free-form endpoint, invent a model outside the registry, or make uncontrolled database changes.

**Current implementation note — target architecture, not implemented.** No AI Director module exists. Model selection today is a direct, explicit choice (the model picker, or the `?model=` dev override), not an AI-ranked recommendation.

## 14. Prompt Compiler Layer

A single generic prompt should not be sent to every video model. Each model family should have its own prompt compiler (illustrative: `prompt-compilers/runway.ts`, `kling.ts`, `veo.ts`, `seedance.ts`, `image-model.ts`), translating a shared creative brief (subject, action, environment, camera, lighting, style, timing, constraints, negative instructions) into that model's specific format. The provider adapter sends the request; the prompt compiler prepares the artistic, model-specific prompt — these are not the same thing.

**Current implementation note — target architecture, not implemented.** Today, `generation.prompt` is passed through to every provider verbatim and unmodified (this is deliberate for the text-to-speech Unicode-preservation guarantee established in Phase 4, and is not itself wrong for TTS). A per-model-family prompt compiler for creative video/image prompts does not exist yet.

## 15. Character Consistency

Character consistency must not rely on writing a name into a prompt. The system should have distinct entities: `characters`, `character_versions`, `character_reference_assets`, `character_embeddings`, `character_usage`. A character record may include name, description, facial features, hair, clothing, apparent age, color palette, reference images, an approved primary image, negative traits, and model-specific settings. Updating a character must not break older projects' references — hence versioning.

**Current implementation note — target architecture, not implemented.** No character entities exist in the current schema.

## 16. Shared Creative Asset System

The system should not just keep a flat file list. Reusable asset types should include: character, location, prop, product, style, color palette, camera preset, voice, music, logo, brand kit. Each asset may belong to a project, may belong to a workspace, may be used across multiple scenes, may be versioned, and may be archived rather than deleted.

**Current implementation note — target architecture, not implemented.** Only per-generation `input_url`/`output_url` file references exist today; no reusable, cross-project asset library.

## 17. Project / Scene / Shot Hierarchy

A film project is not a single generation record. Suggested structure:

```
Workspace
  └── Project
       └── Sequence
            └── Scene
                 └── Shot
                      └── Generation
                           └── Output Asset
```

A shot may have multiple generation attempts; the user should be able to mark one as the selected output.

**Current implementation note — target architecture, not implemented.** The current hierarchy is flat: `Project → Generation`. No workspace, sequence, scene, or shot tables exist.

## 18. Hero-Frame-First Workflow

For cinematic video, rather than starting video generation directly, this flow should be supported: creative brief → storyboard → hero frame generation → hero frame approval → image-to-video → post-processing → final edit. This helps lock character, lighting, composition, and art direction before video generation begins.

**Current implementation note — target architecture, not implemented.**

## 19. Asset Upload Architecture

Large files should not pass through the Next.js server. Correct flow: frontend → backend issues a signed upload URL → file uploads directly to storage (R2 in the source contract) → backend verifies the asset record. Upload-time checks should include MIME type, file size, extension, image resolution, video duration, malicious file scanning, and metadata stripping. A user-supplied external URL must never be sent directly to a provider — it must first be safely ingested or verified into the system.

**Current implementation note:** partially implemented differently — Cinefield's current input upload path uses the Supabase Storage JS client directly from the authenticated browser (`supabase.storage.from("generation-inputs").upload(...)`), which is itself a form of direct-to-storage upload (not proxied through a Next.js request body), matching the *intent* of this rule even though the mechanism (Supabase client upload vs. a custom signed-upload-URL endpoint) differs from the source's R2-oriented description. MIME/size checks exist client-side (`ALLOWED_INPUT_MIME_TYPES`, `MAX_INPUT_FILE_SIZE`) and at the bucket level (`allowed_mime_types`, `file_size_limit` — verified directly against the live Supabase bucket config). Malicious-file scanning and metadata stripping are not implemented.

## 20. Storage Structure

Example R2 folder layout from the source contract:

```
users/{userId}/
  projects/{projectId}/
    source/
    references/
    generations/{generationId}/
      raw/
      processed/
      thumbnails/
      previews/
```

File names must not be derived directly from the user's original uploaded filename — a UUID or safe internal id should be used. Private assets should be served via signed URL; public community content should live in a separate public delivery area.

**Current implementation note (see also override section above):** Cinefield's real, working storage layout today is Supabase Storage, not R2: `<clerkUserId>/<projectId>/<generationId>/<generated-file-name>.<ext>` in the private `generation-outputs` bucket (`buildOrchestrationOutputPath` in `output-storage.ts`), file names already using a timestamp+random suffix rather than the user's original name, and signed URLs already minted only for authenticated responses, never persisted. This satisfies the *principles* of section 20 today using Supabase Storage instead of R2 — migrating the literal bytes to R2 is Phase 12, a separate future decision, not a correction of a current gap.

## 21. FFmpeg and Post-Processing

FFmpeg may be used for format conversion, codec standardization, thumbnail generation, preview generation, video concatenation, adding audio, fades, resize/crop, frame extraction, and metadata stripping. FFmpeg must not run inside a Next.js request — a separate worker or Trigger.dev task should be used. Raw provider output should be preserved; processed output should be saved as a separate asset.

**Current implementation note — target architecture, not implemented.** No FFmpeg or post-processing step exists yet; outputs are stored exactly as the provider (or mock) produced them.

## 22. Webhook Security

Provider webhooks must not be trusted directly. A webhook endpoint should perform: signature verification, timestamp check, replay protection, known-provider check, known-external-job-id check, idempotency, valid status transition check, and payload schema validation. A webhook should only update job status and enqueue any needed follow-up work — heavy media processing must not happen inside the webhook request itself.

**Current implementation note — target architecture, not implemented.** No webhook endpoint exists. The current fal.ai adapter is synchronous (`executionMode: "sync"`) — it awaits the result directly in `submit()` rather than receiving a webhook. A webhook layer would be needed for any future asynchronous provider.

## 23. Polling Rule

For providers that do not support webhooks, polling should be used. Polling should not run unbounded, should use an exponential or controlled interval, should have a maximum job duration, should respect the provider's rate limit, should stop once the job completes, and should not re-query a cancelled job. Example interval progression: 10s, 20s, 30s, 60s, 60s.

**Current implementation note:** implemented, but at a different layer than the source contract describes — Cinefield's current polling is not a provider-status poll (no async provider exists yet to poll), it is the **browser polling its own database row** after a Trigger.dev dispatch (`pollGenerationUntilTerminal` in `CinemaStudioWorkspace.tsx`, fixed interval 1.5s, capped at 40 attempts / ~60s). This is a legitimate, working, different mechanism serving the same underlying need (the client eventually learning that an async job finished) — it is not a gap to be "fixed" to match the source's exact interval schedule.

## 24. Cloudflare's Role

Cloudflare may be used for: AI Gateway, Workers AI, rate limiting, WAF, bot protection, DDoS protection, R2 storage, CDN, signed delivery, queues, or helper edge tasks. Cloudflare AI Gateway is appropriate for short AI tasks: prompt enhancement, image analysis, task classification, moderation, embedding, reranking, text-model fallback, usage logging. **Cloudflare AI Gateway is not a long-running video job orchestrator. Cloudflare Workers AI is not Runway or fal.ai. Cloudflare R2 is not a generation database.** Each product should be used for its own job.

**Current implementation note — not yet integrated (see override section above and Phase 5A–5C).** No Cloudflare product is currently connected. When it is, AI Gateway and Workers AI must be tracked as separate concepts (gateway vs. actual provider), per the override section.

## 25. Trigger.dev's Role

Trigger.dev should carry out: long video generation jobs, retry, polling, provider status checks, result download, post-processing, storage upload, Supabase status updates, credit finalization or refund, thumbnail generation, notification creation. **Trigger.dev is not a model. Trigger.dev is not a provider.** It is purely a reliable task-execution and orchestration layer.

**Current implementation note:** already implemented exactly this way. `src/trigger/generation-task.ts` is one generic task (`cinefield-generation`) that calls the same `executeGeneration()` the direct/HTTP path uses — it does not itself know about providers, models, or workflows. Post-processing, credit finalization, and notifications are not yet implemented (no post-processing pipeline, no credit system, no notifications table).

## 26. Supabase's Role

Per the source contract, Supabase is intended as the primary source for records including: `profiles`, `workspaces`, `workspace_members`, `projects`, `sequences`, `scenes`, `shots`, `generations`, `assets`, `characters`, `locations`, `props`, `styles`, `credit_wallets`, `credit_ledger`, `subscriptions`, `provider_jobs`, `webhook_events`, `model_registry`, `notifications`, `community_posts`, `comments`, `likes`. Supabase is not required to be the sole large-video-file storage solution — large media may live in R2, with Supabase holding the metadata/ownership record.

**Current implementation note — the vast majority of this table list is target architecture, not implemented.** The current schema (verified against `supabase/migrations/20260805132704_remote_schema.sql`) has exactly three tables: `profiles`, `projects`, `generations`. Every other table named above (`workspaces`, `workspace_members`, `sequences`, `scenes`, `shots`, `assets`, `characters`, `locations`, `props`, `styles`, `credit_wallets`, `credit_ledger`, `subscriptions`, `provider_jobs`, `webhook_events`, `model_registry`-as-a-table, `notifications`, `community_posts`, `comments`, `likes`) does **not** exist today and must not be assumed present by any future change. `model_registry` in particular is currently code (`model-registry.ts`), not a database table — Phase 7 ("Model Registry Unification") is where that distinction would be revisited, not before.

## 27. Clerk / Supabase User Mapping

Clerk is the source of user identity. Supabase is the source of application profile and business data. Example mapping: `Clerk user ID → profiles.clerk_user_id`. A `userId` sent from the frontend must never be trusted — the backend must take the user id from a verified Clerk session. Supabase Row Level Security must be applied. The service role key must never be sent to the frontend.

**Current implementation note:** already implemented exactly this way. Every server route/orchestrator call takes `clerkUserId` from a verified server-side `auth()` call, never from the request body (see `orchestrator.ts`'s own comment: "must come from a verified server-side Clerk session — never from the request body"). `SUPABASE_SERVICE_ROLE_KEY` is read only in `src/lib/supabase/supabaseAdmin.ts`, marked `server-only`, and never exposed via `NEXT_PUBLIC_`.

## 28. Stripe and Subscriptions

Stripe should not be treated as merely a payment-collection tool. The intended flow: checkout → Stripe webhook → webhook verification → update subscription record → add credit package to the ledger. Credit must never be granted just because the frontend claims payment succeeded — only after a verified Stripe webhook. Events to handle: checkout completed, subscription created/updated/cancelled, invoice paid, invoice payment failed, refund, chargeback.

**Current implementation note — target architecture, not implemented.** No Stripe integration, webhook endpoint, or subscription table exists in the current codebase or schema. This is Phase 10 in the roadmap below (explicitly *after* Cloudflare and multilingual-prompt phases, per the user-specified updated order).

## 29. Community System

Community content should have its own publication layer, separate from the generation table. Publishing an item should record: public title, description, thumbnail, a display-safe model name, permission to share settings used, remix permission, visibility, and moderation status. Private prompts and hidden provider data must not become public automatically. Remixing a public project should create a new, independent project — the original must not be modified.

**Current implementation note — target architecture, not implemented.** No community/publication tables or UI exist.

## 30. Collaboration and Workspace

Future team functionality may support roles: owner, admin, editor, viewer, billing. Each project should belong to a workspace rather than a single user, enabling future team members, shared projects, comments, an approval system, a shared credit pool, and a brand kit. Even in a single-user first version, the data model should be workspace-ready.

**Current implementation note — target architecture, not implemented.** Projects currently belong directly to a `clerk_user_id`; there is no workspace table or concept.

## 31. MCP Architecture

MCP lets AI agents securely call tools in the project. The MCP server must not hand provider API keys directly to agents — MCP tools must call the backend service layer. Example tools: `list_models`, `create_project`, `list_projects`, `upload_reference`, `generate_image`, `generate_video`, `get_generation_status`, `list_generations`, `get_generation_result`, `cancel_generation`, `list_characters`, `create_character`. MCP calls must go through the same rules as the normal web app: user authentication, authorization, credit, model registry, moderation, rate limit, provider adapter, audit log. The web app and MCP must not be two separate generation systems — both must use the same core service.

**Current implementation note — target architecture, not implemented.** No MCP server exists in this repository yet.

## 32. Asynchronous Result for MCP

A video generation MCP request must not be held open for minutes. The correct response is immediate acknowledgment (`{"generationId": "gen_123", "status": "queued", "message": "Generation started."}`), with the agent later calling a `get_generation_status` tool. Once complete, the result should be returned via a secure URL.

**Current implementation note — target architecture for MCP specifically, but the underlying mechanism already exists and is proven.** `/api/orchestration/execute` in trigger mode already returns immediately with `{status: "queued", ...}` rather than blocking (Phase 3), and a signed URL is only produced once the generation is actually complete (Phase 3–4). A future MCP layer would reuse this exact mechanism, not build a new one.

## 33. Security and Moderation

Controls that should exist: prompt moderation, upload moderation, rate limiting, IP abuse detection, per-user limits, suspicious-account detection, malicious URL blocking, SSRF protection, file validation, API key protection, webhook verification, audit log, admin ban system. Personal/sensitive data policy must be considered when logging user prompts.

**Current implementation note:** partially implemented. API key protection (server-only env vars, never logged — verified explicitly in `fal-provider.ts`'s own comments and code), and basic file validation (MIME/size checks) exist. Prompt/upload moderation, rate limiting, IP abuse detection, SSRF protection beyond the output-normalizer's HTTPS-only fetch restriction, audit logging, and an admin ban system do not exist yet.

## 34. Observability

Every generation should have a traceable correlation id: `request_id`, `generation_id`, `provider_job_id`, `trigger_run_id`, `user_id`, `project_id`. Logs may record which endpoint was called, which model was selected, which provider was used, how many retries occurred, how long the provider took, what error occurred, when credit was reserved, whether credit was refunded, whether the file was uploaded to storage. Logs must **never** contain: API keys, authorization headers, Stripe secrets, the Supabase service role key, or full sensitive user data.

**Current implementation note:** partially implemented. `orchestrator.ts`'s `log()` function already logs `generationId`, `provider`, `modelId`, `workflow`, `stage`, `durationMs`, `result`, and `errorCode` — explicitly documented as "never includes prompts, tokens, or payloads." `trigger_run_id` is available (returned in the dispatch response) but not currently cross-logged with the generation id server-side. Structured credit-lifecycle logging does not exist (no credit system yet). Phase 13 has since added three pieces on top of this: a W3C `traceparent` correlation id that survives durable boundaries (13-A), an allow-list telemetry guard (13-E), and the health foundation described below. **No external observability backend is configured** — no Sentry, no Datadog, no Better Stack, no OpenTelemetry exporter, no DSN or API key anywhere in the repository. Everything below emits to the local structured logger only.

### 34.1 Health: liveness, readiness and dependency health are three different questions

`src/lib/health/` (Phase 13 health foundation). The three are kept apart deliberately, because conflating them is how a dependency incident becomes an application outage.

- **Liveness** — *can this process execute?* `liveness()` is synchronous and performs **zero I/O**: it reads no environment variable, opens no connection and awaits nothing. If it can return, the answer is yes. A liveness probe that touched Redis would let one Redis blip fail every container's probe simultaneously, and an orchestrator answers failed liveness by restarting — a restart storm caused by a healthy application.
- **Readiness** — *can this runtime safely do its own job?* Dependency-aware, per runtime, and it removes a container from rotation rather than killing it. `DEGRADED` counts as ready: refusing traffic because an optional or fallback-covered dependency is unwell takes the product down to protect it from a partial loss of function.
- **Dependency health** — the diagnostic view. Every dependency is probed, including `OPTIONAL` and `DEFERRED` ones whose answer cannot affect readiness, because omitting them makes the diagnostic lie about what exists.

The status model is four-valued: `HEALTHY`, `DEGRADED`, `UNREADY`, `UNKNOWN`. **`UNKNOWN` is never treated as healthy.** A probe that threw, timed out or could not answer reports `UNKNOWN`, and a `CRITICAL` dependency reporting `UNKNOWN` makes the runtime `UNREADY`. This is the same rule as `AMBIGUOUS != SAFE TO RETRY` and `stored != verified` elsewhere in this contract.

**There is no global dependency rule — the matrix decides per runtime.** `DEPENDENCY_MATRIX` in `health-contract.ts` maps each of the six runtimes (`web`, `temporal-worker`, `provider-worker`, `realtime-dispatcher`, `media-worker`, `dr-worker`) to its dependencies and a criticality, each carrying a written `why`. The same dependency means different things in different processes: Redis A is an accelerator for the web tier (`DEGRADED_ALLOWED`) and the actual delivery destination for the realtime dispatcher (`CRITICAL`); `s3-dr` is `CRITICAL` only for `dr-worker` and `OPTIONAL` everywhere else.

**Every probe has a timeout, and the whole evaluation has a budget.** Per-dependency budgets live in `PROBE_TIMEOUT_MS` (50–1500 ms); probes run concurrently, so readiness is bounded by the slowest single probe rather than their sum, and the whole call races `READINESS_BUDGET_MS` (4 s). Exceeding it answers `UNREADY` with a `timeout` reason instead of hanging — a health check that hangs reads to an orchestrator as a failure anyway, and hanging is the one behaviour that helps nobody.

**Health is observational.** Nothing in `src/lib/health/` can restart a generation, retry a provider, settle a credit, release a quarantine or change a security decision. A failing probe changes a status string; it never changes business state. Probes are read-only by construction — the Supabase probe calls the existing read-only `realtime_outbox_debt()` RPC, the Redis A probe issues `PING` plus a `CONFIG GET`, provider health is read with one bounded `SCAN` (never `KEYS`, which is O(N) over the whole keyspace and blocks the Redis event loop), and the config probe reuses `configurationHealth()` from 12-D rather than introducing a second validator that could drift from the first.

**Public exposure is one endpoint and it is the least informative one.** `GET /api/health/live` returns `{status, timestamp}` — no version, build id, region, runtime name or dependency. `readiness()` and `dependencyHealth()` are `server-only` functions with **no HTTP route at all**: an unauthenticated readiness endpoint enumerates which subsystems are unwell, which is a map of the architecture plus a list of what is currently weakest. 12-D reached the same conclusion for `configurationHealth()`. The liveness route obeys the same rate-limit and cache contract as every other route via a dedicated `public_health` policy class — anonymous, 240/min, and **fail-open**, so neither a burst nor a Redis outage can turn liveness into a false failure and trigger restarts.

This is the health *foundation* only. **Phase 13-C (external uptime, synthetic checks, heartbeat and public status) is NOT complete** — no external monitor is configured, nothing calls `/api/health/live` from outside, and no worker pushes a heartbeat. A runtime going `UNREADY` now raises an internal alert (§34.2) — 13-C is what would make that visible from outside the process.

### 34.2 Alert router: normalize, deduplicate, correlate — route, do not deliver

`src/lib/alerts/` (Phase 13-D, code half). Roadmap 13-D: "Merkezi Alert Router + Telegram Operations/Security + status.cinefield.ai routing kur", done-criterion "Aynı incident dedupe edilip doğru kanala tek olay olarak gidiyor." This package is the router — normalize, deduplicate, correlate, decide a channel. **It does not deliver anywhere.** There is no Telegram bot, no status page, no webhook, no token and no network call anywhere in the directory; a test scans the source for exactly that and fails if one appears.

**The envelope is a projection, not a copy.** `AlertCandidate` → `AlertEnvelope` is built field by field from a fixed allow-list, the same shape as the 13-E telemetry guard and for the same reason: a prompt, a signed URL, a raw error object or a security-evidence row passed in by a producer is silently dropped, not merely discouraged. The durable evidence already lives in `security_events`, the outbox tables and the audit trail; an alert says *this happened, this often, here* and stops there.

**Severity is server-derived, from one catalogue.** `ALERT_CATALOGUE` in `alert-contract.ts` gives every one of the eleven alert types exactly one default severity (`INFO`/`WARNING`/`ERROR`/`CRITICAL`) and a written reason — nothing a caller passes can override it, and an uncatalogued type is refused rather than routed.

**Deduplication is deterministic and bounded.** The dedupe key is `source:type:resource` — never an occurrence id, a trace id or a timestamp, because those identify the occurrence and the key must identify the problem. Inside a type's window, repeats increment an occurrence count and deliver nothing; there are exactly two ways out of suppression: crossing an escalation threshold (10 / 100 / 1,000 / 10,000) or, for `CRITICAL` alerts only, 300 seconds of silence — a sustained critical failure must not read identically to one that recovered.

**Routing is symbolic.** `channelsFor(severity, userVisible)` returns `DASHBOARD` always, adds `TELEGRAM` at `ERROR`/`CRITICAL`, and adds `STATUS_PAGE` only when both `CRITICAL` and the alert type is marked user-visible in the catalogue — a security alert is `CRITICAL` but never user-visible, so it can never reach a public surface. The only implemented sink, `LoggingAlertSink`, writes to the 13-E-guarded structured logger; `TelegramAlertSink` and `StatusPageSink` are named in `AlertDeliverySink`'s doc comment as the future external half and are not implemented.

**The catalogue and its producers are asserted to match exactly, both directions**, in `alert-sources.ts` — the same defence this repository has built five times over for "a component that exists with no production caller." Two real callers exist today: `security-event-logger.ts` raises `security_high_severity`/`security_action_recommended` after every recorded row (never on a coalesced one, so the database's own storm control is not undone one layer up), and `worker/realtime-dispatcher-worker.ts` raises health-transition, outbox-debt and dispatcher-failure alerts once a minute alongside its existing debt log. Signals the roadmap names but this repository cannot yet observe — workflow-start outbox debt, DR backup debt, SQS/DLQ depth, Kafka lag, replay-gap spikes — have **no producer** and are not in the catalogue; an alert type nothing can raise would be a fake alert.

**A defect the live proof caught and a standing guard against its return:** `dependencyHealth()` still probes `OPTIONAL`/`DEFERRED` dependencies for the diagnostic view even though `rollUp()` ignores them for readiness (§34.1) — which means Kafka and Redis B report `UNKNOWN` on every single poll, forever, by design, since their probes do no I/O. The alert producer initially alerted on any `UNKNOWN` regardless of criticality, so every worker startup paged three `ERROR`/`TELEGRAM` alerts for infrastructure that was never supposed to be running — the exact alarm fatigue 13-D exists to prevent, reintroduced one layer above where the health contract had already solved it. `alertOnReadiness` now skips `OPTIONAL`/`DEFERRED` dependencies with the same one-line guard `rollUp()` uses, and a regression test pins it.

**Failure semantics match the rest of observability.** `raiseAlert` never throws; a throwing sink is caught inside `dispatchToSinks` and never reaches the caller. Nothing in `src/lib/alerts/` imports Supabase, Temporal, credit, settlement, quarantine or provider-adapter code — an alerting fault must not become the incident it exists to report.

**Not built in this half:** `TelegramAlertSink`, `StatusPageSink`, any Datadog/Sentry bridge, `status.cinefield.ai` itself, and the `ACKNOWLEDGED` alert-state transition (needs a human and an operator surface — Phase 16). No Telegram bot, Better Stack, Datadog or Sentry account was created.

## 35. Admin Panel

Should include at least: users, subscriptions, credit movements, generation records, provider jobs, failed jobs, model status, provider status, model prices, usage cost, moderation records, community content, webhook events, system announcements. Should support: disabling a model, putting a model in maintenance mode, changing price, adding credit to a user, retrying a generation, hiding content, suspending a user. Every admin action must be written to an audit log.

**Current implementation note — target architecture, not implemented.** No admin panel exists in this repository.

## 36. Feature Flag System

New models should not be opened directly to all users. Feature flag support should exist (e.g. `runway_gen_new_enabled`, `cinema_studio_beta`, `mcp_enabled`, `community_publish_enabled`, `auto_model_routing_enabled`), operable at global, plan, workspace, user, or percentage-rollout level.

**Current implementation note — target architecture, not implemented as a general system.** One narrow, real precedent already exists: `GENERATION_EXECUTION_MODE` + `TRIGGER_SECRET_KEY` presence together gate whether "trigger" execution mode activates (`resolveExecutionMode()` in `execution-mode.ts`) — an env-var-level flag, not a general per-user/per-plan feature flag system. Per the override section above, any future integration (Cloudflare, Runway, etc.) should follow this same "additive, gated, defaults to the safe/existing path" pattern until a real feature-flag system (if ever needed) is built.

## 37. Model Health System

Health status should be tracked per provider/model: `operational`, `degraded`, `rate_limited`, `maintenance`, `disabled`. If a provider's error rate rises, the system may stop accepting new jobs, show a warning on the model card, exclude the model from automatic selection, or notify an admin. This decision must not be left to the AI model alone.

**Current implementation note — target architecture, not implemented.** `ModelRegistryEntry.enabled: boolean` exists today (a static on/off switch checked by the orchestrator — `MODEL_DISABLED` error), but there is no dynamic health tracking, error-rate monitoring, or automatic exclusion.

## 38. Model Routing Rules

Automatic model selection should be constrained by deterministic rules, evaluating: task type, input type, requested quality, duration, resolution, aspect ratio, need for character consistency, camera control, audio need, user's plan, user's credit, provider status, estimated cost, estimated generation time. The AI Director may propose; the backend registry and policy engine make the final decision.

**Current implementation note — target architecture, not implemented.** Model selection today is a direct, explicit user choice (or the `?model=` dev override) — there is no automatic routing/ranking layer.

## 39. Database Migration Rule

The production database must not be changed manually or uncontrollably — every change must go through a migration. Before migrating: review existing data, check backward compatibility, prepare a rollback plan, evaluate index needs. Table/field names should not be overly coupled to a specific provider (e.g. avoid `fal_video_jobs`; prefer `provider_jobs`). Provider-specific raw payloads, if needed, may live in a JSONB column or a separate provider-metadata table.

**Current implementation note:** the current schema is small (3 tables) and already avoids provider-coupled naming (`generations.provider` is a plain string column, not a provider-specific table). Provider-specific detail is already kept out of the schema and confined to code (`ModelRegistryEntry`) and to `metadata` (a generic JSONB column), consistent with this rule. Per the override section, no schema change should be made merely to anticipate a future example from this contract.

## 40. Development Environments

At least three environments should be used: development, preview/staging, production — each with its own Supabase project (or safely separated schema), Clerk configuration, Stripe mode, Cloudflare gateway, R2 bucket, Trigger.dev environment, and provider API keys. Development keys must not be used in production. Stripe test and live keys must not be mixed.

**Current implementation note:** development environment exists and is what has been verified throughout Phases 1–4 (local `.env.local`, a single Supabase project, Clerk in development-key mode — the app itself already warns about this in the browser console, Trigger.dev's own "dev" environment via `trigger dev`). Distinct staging/production environments do not exist yet — see Phase 11 ("Vercel Staging") in the roadmap.

## 41. Test Strategy

At minimum: unit tests (model registry, credit calculation, prompt compiler, input validation, status transitions, error normalization), integration tests (Supabase records, Clerk verification, Stripe webhook, provider adapter, R2 upload, Trigger.dev task), contract tests (provider request/response shape hasn't silently changed), and end-to-end tests (sign in → create project → upload asset → start generation → credit reserved → job completes → video visible). Real paid provider calls should not run in every test. A mock provider adapter must exist.

**Current implementation note:** no automated test suite (unit/integration/contract/e2e) exists in this repository yet — verification so far has been manual, live testing per phase (documented in each phase's report), plus `npx tsc --noEmit` and `npm run build` as the current pre-commit gate. **The mock provider adapter this section calls for already exists and is exactly how every phase has been verified at zero cost** (`mock-image`, `mock-video`, `mock-tts` in `src/lib/orchestration/providers/mock-provider.ts`).

## 42. Mock Provider

A mock provider should exist so flow can be tested during development without spending money:

```
providers/mock/
```

A mock provider should: generate a fake job id, return "processing" for a while, return test video/output, produce controlled errors, simulate timeouts, simulate rate limits — so credit, retry, webhook, and UI states can all be tested without real provider cost.

**Current implementation note:** already implemented, at `src/lib/orchestration/providers/mock-provider.ts` (not the source's illustrative `providers/mock/` path — see the folder-layout note in section 6/the override section). It already supports controlled failure modes via `mock_mode` metadata (`success`, `provider-failure`, `retryable-failure`, `missing-output`), and produces genuine, spec-valid output bytes rather than fake placeholders: a real PNG (`png-encoder.ts`) for image models and a real WAV tone (`wav-encoder.ts`) for `mock-tts`, deterministically seeded per generation. This has been the verification method for every phase so far.

## 43. Deployment Rule

The Next.js app may run on a platform like Vercel. Heavy tasks — long polling, FFmpeg, large file download/upload, long generation waits — must not be tied to a frontend deployment's request lifecycle; these belong in Trigger.dev workers or a suitable compute environment. Before every deployment: TypeScript check, lint, unit tests, migration check, environment variable check, build, smoke test.

**Current implementation note:** the Trigger.dev half of this is already real — long-running generation work is dispatched to Trigger.dev precisely so it is not tied to a Next.js request lifecycle (Phase 3). No Vercel deployment exists yet (local dev only) — see Phase 11. The current pre-commit gate (established across Phases 2–4) is `npx tsc --noEmit` + `npm run build`; there is no lint step, automated test step, migration check, or smoke test step yet in that gate.

## 44. Changes That Would Break the Project

The following must not be done: treating fal.ai and Runway as the same provider; using a provider's name as a model name; mistaking Cloudflare for a video generator; mistaking Trigger.dev for a model router; calling a provider directly from the frontend; putting an API key in a `NEXT_PUBLIC_` variable; holding a Next.js endpoint open until generation completes; stuffing every provider's conditional logic into one `generateVideo` file; keeping the frontend's model list independent of the backend; deducting credit only in the frontend; applying uncontrolled fallback on provider error; processing the same webhook twice; storing a large video as base64 in the database; sending the Supabase service role key to the browser; blindly trusting a user-supplied storage URL; handing every AI task to a single LLM; directly calling a model id the AI Director invented; changing the production database without a migration; running unlimited generation without tracking provider cost; using production Stripe or provider keys in a test environment.

**Current implementation note:** every item in this list that is currently applicable is already respected: providers are kept distinct in the model registry (`providerId` field), no API key is ever in a `NEXT_PUBLIC_` variable (verified across all provider adapters), `/api/orchestration/execute` in trigger mode never holds the request open (returns `202` immediately), there is one generic `executeGeneration()` rather than per-provider branching logic, the frontend model list is not independent of the backend registry for orchestration models (`isOrchestrationModel` checks are backend-registry-derived), no credit deduction exists anywhere (frontend or backend) so there's nothing to get wrong there yet, webhook double-processing has no webhook to double-process yet, no base64 video/audio is ever stored (real bytes go to Storage, only the path to the database), the service role key is `server-only` and never shipped to the browser, and schema changes so far (none, in fact, across Phases 2–4) have gone through reviewed, documented phases rather than ad hoc edits.

## 45. Original Build Order (Source Contract)

The source contract's own suggested order was:

- **Faz 1 — Base platform:** Next.js, Clerk, Supabase, basic user profile, workspace, project, asset upload, R2.
- **Faz 2 — Generation core:** generation table, model registry, provider interface, mock provider, Trigger.dev, status machine, credit reservation.
- **Faz 3 — First real provider:** fal.ai adapter, one image model, one video model, polling or webhook, result normalization. ("First, one provider should work perfectly.")
- **Faz 4 — Second independent provider:** Runway adapter, separate API client, separate schema, separate error mapping, separate provider job handling. ("Runway must not be added inside fal.ai's code.")
- **Faz 5 — Cloudflare AI layer:** AI Gateway, prompt enhancement, vision analysis, moderation, rate limit, AI logging.
- **Faz 6 — Cinema system:** AI Director, prompt compiler, camera presets, style presets, characters, locations, props, hero frame, scene/shot structure.
- **Faz 7 — Payments:** Stripe, subscription, credit ledger, model pricing, refund policy, usage dashboard.
- **Faz 8 — Community:** publish, profile, project page, remix, like, comment, moderation.
- **Faz 9 — MCP:** MCP authentication, tool definitions, generation service connection, async status, audit log, rate limit.
- **Faz 10 — Scaling:** provider health, feature flags, cost analytics, admin panel, queue concurrency, CDN optimization, observability, backup, disaster recovery.

Each phase should be tested before moving to the next.

**See `IMPLEMENTATION_ROADMAP.md` for the current, updated phase order** (Phase 5A onward), which reorders the source's Faz 5+ sequence based on what has actually been built (Faz 1–3 are effectively done, in a different but compatible shape; Faz 4/Runway has been deliberately pushed later; a dedicated audio/TTS track has been added that the source contract did not originally have a phase number for).

## 46. Working Method for Coding Agents

Before making a change in this project: inspect the current repository structure; read the relevant files; check the current database schema; check whether the same feature already has another implementation; state which architectural layer will be touched; verify the provider/model/feature distinction; make small, reversible changes; run TypeScript and tests; verify existing working providers are not broken; report the change file-by-file. **Code, folders, tables, environment variables, or endpoints must not be assumed to exist without having seen them. Fictional code connections must not be invented when information is missing.**

**Current implementation note:** this section is not superseded by anything — it is a direct, standing instruction to every future agent working in this repository, this phase included. Every "current implementation note" throughout this document was written by directly reading the relevant source files, migration SQL, and live Supabase bucket configuration, not by assumption.

## 47. Final Architectural Principle

The system's "brain" is not a single AI model. AI Director produces creative decisions. The policy engine validates the decision. The model registry determines allowed models. The provider router selects the correct adapter. The provider adapter makes the real API call. Trigger.dev executes the long task. Cloudflare governs AI calls. Supabase records the system. R2 stores media. FFmpeg processes the result. Clerk verifies the user. Stripe manages payment.

Each layer must do only its own job. The project's sustainability depends on providers never being conflated with each other, and on the shared generation core being preserved. Adding a new provider should not require rewriting the existing system. Adding a new model should, in most cases, be completable with: a registry entry + the relevant adapter support + a prompt-compiler setting + pricing + a test.

**When a proposed change conflicts with this architecture contract, the risk must be stated explicitly before the change is applied.**

**Current implementation note:** the "adding a model = registry entry + adapter support" principle is already proven true in this codebase — `fal-flux-schnell` (Phase 2) and `mock-tts` (Phase 4) were each added as a registry entry plus (for fal) reuse of the existing generic fal adapter, with zero changes to the orchestrator, Trigger.dev task, or API route. This is direct, working evidence that the contract's final principle already holds for this codebase.
