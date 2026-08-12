# Cinefield infrastructure as code (Phase 6R.16)

Foundation only. **Nothing here has been applied.** No AWS resource in this
repository was created by Terraform; the queues, cluster and roles that exist
today were created by hand and are documented in
`docs/operations/AWS_PROVIDER_RUNTIME.md`. This tree is the reviewable
declaration of what production *should* be, written so the eventual adoption
is a diff review rather than an archaeology exercise.

## Tooling

Written as standard HCL, compatible with Terraform ≥ 1.6 and OpenTofu ≥ 1.6.
The repository had no prior IaC, so no tool is inherited.

**Neither `terraform` nor `tofu` is installed in the development environment
this was authored in, so `fmt -check`, `init -backend=false` and `validate`
were NOT run.** That is a real gap, not a formality: HCL here is
syntactically standard and hand-reviewed, but unverified by a parser. Running
those three commands is the first thing to do on a machine that has the
binary, before any other work on this tree.

## Layout

```
infra/
  modules/
    sqs/      command + callback + media queues, with DLQs
    msk/      Kafka event backbone
    redis/    INTERFACE ONLY — see the warning below
    ecs/      long-running workers (provider worker, Temporal worker)
    iam/      least-privilege roles per service boundary
    kms/      encryption ownership — declares NO keys
  environments/
    dev/
    production/
```

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

- **Remote state.** No backend is configured and no S3 bucket is hard-coded.
  Bootstrapping state storage is its own reviewed change; pointing at a
  bucket that does not exist would make `init` fail confusingly.
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
