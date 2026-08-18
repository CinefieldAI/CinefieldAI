# Cinefield infrastructure as code (Phase 6R.16, hardened Phase 18-A/B/C/D)

Foundation, now `fmt`/`validate`-verified. **Nothing here has been applied.**
No AWS resource in this repository was created by Terraform; the queues,
cluster and roles that exist today were created by hand and are documented in
`docs/operations/AWS_PROVIDER_RUNTIME.md`. This tree is the reviewable
declaration of what production *should* be, written so the eventual adoption
is a diff review rather than an archaeology exercise.

## Tooling

**Terraform is the canonical IaC engine** (Phase 18-A decision — this HCL
stays syntactically OpenTofu-compatible, but Terraform is what every CI
workflow (`.github/workflows/infra-*.yml`) actually pins and runs; OpenTofu
was deliberately not introduced as a second engine). Required version ≥ 1.6.

`fmt -check`, `init -backend=false`, and `validate` have now actually been
run (Phase 18-A, Terraform 1.9.8) — the gap this section used to describe is
closed. Two real, previously-undetected problems that hand-review alone had
missed were found and fixed this way: a formatting inconsistency in
`modules/redis/outputs.tf`, and a genuine `validate` failure in
`modules/iam/variables.tf` (Terraform's `||` does not short-circuit
`strcontains()`'s null-argument check — `try(!strcontains(var.x, "*"), true)`
is the fix, not `coalesce`, which has its own null/empty-string gotcha). See
`docs/security-gates.md`'s Phase 18 section for the full account. Re-run
these three commands after any further change to this tree, before relying
on hand-review alone.

## Layout

```
infra/
  bootstrap/      remote-state backend (S3 + DynamoDB lock) — Phase 18-A,
                  local state (cannot depend on the backend it creates),
                  never applied — see that module's own header
  modules/
    sqs/      command + callback + media queues, with DLQs
    msk/      Kafka event backbone
    redis/    INTERFACE ONLY — see the warning below
    ecs/      long-running workers (provider worker, Temporal worker)
    iam/      least-privilege roles per service boundary
    kms/      encryption ownership — declares NO keys
  environments/
    dev/          + backend.hcl.example (real backend.hcl is git-ignored)
    production/   + backend.hcl.example (real backend.hcl is git-ignored)
```

CI (Phase 18-C, `.github/workflows/`): `infra-ci.yml` runs fmt/validate/plan
on every PR touching `infra/`, never applies. `infra-apply.yml` is the ONLY
workflow that may run `terraform apply`, and only against production, only
via manual `workflow_dispatch`, only inside a protected GitHub `environment:
production`. `infra-drift.yml` runs a scheduled, read-only `terraform plan
-detailed-exitcode` and reports the result to the existing Phase 13-D alert
system through `POST /api/internal/infra/drift-report` — see
`docs/operations/INFRA_EMERGENCY_RUNBOOK.md` for what happens when it fires.
All three are CODE_COMPLETE but LIVE_EXTERNAL_REQUIRED: none of them can do
anything real until `bootstrap/` is applied for real and the repository's
`AWS_ROLE_ARN`/`TF_STATE_BUCKET`/`TF_STATE_DYNAMODB_TABLE`/`AWS_REGION`
variables and `CINEFIELD_INFRA_DRIFT_INGEST_TOKEN` secret are configured.

## Redis is deliberately not modelled as an AWS resource

Cinefield's Redis A (application state) is **Redis Cloud**, not ElastiCache.
Writing an `aws_elasticache_replication_group` for it would be a lie in
executable form: the next person reads the module, believes AWS owns the
instance, and either builds a duplicate or plans a change against something
Terraform does not manage. Redis B (BullMQ) is not provisioned at all and its
provider has not been chosen.

So `modules/redis` creates nothing. It declares the two responsibilities,
takes their endpoints as external inputs, and enforces the one property that
actually matters architecturally — that A and B are distinct. When a provider
decision is made, an implementation is added behind that interface and this
paragraph is replaced by the decision.

## What is deliberately absent

- **Remote state, applied.** `bootstrap/` now DECLARES the S3 bucket and
  DynamoDB lock table (Phase 18-A), and both environment roots declare a
  partial `backend "s3" {}` block pointing at them — but nothing here is
  hard-coded (bucket/table names live in a git-ignored `backend.hcl`, real
  values only) and nothing has been applied. Pointing `init` at a bucket
  that does not exist yet would make it fail confusingly, which is exactly
  why `bootstrap/` has to be applied first, by hand, before either
  environment's `backend.hcl` can point at something real.
- **Account IDs, ARNs of real principals, credentials.** Every one is a
  variable. `terraform.tfvars` is git-ignored; only `.example` files are
  committed.
- **KMS keys.** `modules/kms` declares usage and aliases as inputs and emits
  the policy statements other modules need. Key creation is a separate,
  deliberately manual act.
- **The Vercel frontend.** It stays on Vercel. ECS is only for work that
  genuinely needs a long-running process.

## Never

```
terraform apply      tofu apply      terraform plan against real credentials
```

Applying this tree against the live account without first reconciling it with
the hand-created resources would attempt to recreate them.
