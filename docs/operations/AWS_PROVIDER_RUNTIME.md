# AWS Provider Runtime — Verified Production Baseline

Phase 6R. Documents the AWS infrastructure that carries a provider
submission from the Next.js application to a provider and back, as it
exists today. The infrastructure was created and configured manually
(console); this document is the record of that manual setup, not a
Terraform/OpenTofu source of truth — see **Future IaC migration** below.

This document is descriptive only. It contains resource **names** and
**roles**, never resource **values** that function as secrets (no keys,
no tokens, no ARNs beyond what's needed to name a resource, no email
addresses, no subscription identifiers).

## Architecture

```
Next.js / orchestration
        |
        v
   AWS SQS FIFO            (cinefield-provider.fifo)
        |
        v
ECS / Fargate provider-worker
        |
        v
   ProviderAdapter
        |
        v
     provider               (mock today; fal.ai / Cloudflare Workers AI registered)
        |
        v
Supabase DB / Storage
```

The command that flows through this path is `provider.submit`
(`src/lib/contracts/command-wire.ts`). It is the **only** command type
carried on this transport today. The worker never calls a provider
directly from an untrusted field on the message — every routing
decision (provider, model, ownership) is re-derived from the database
by `generationId`/`attemptId`, and the atomic claim in
`generation_attempts` (not the transport) is the authority that
prevents a duplicate delivery from producing a duplicate provider call.

## ECS

| Resource | Name |
|---|---|
| Cluster | `cinefield-production` |
| Service | `cinefield-provider-worker-service-umzbbpv2` |
| Task definition | `cinefield-provider-worker`, revision `3` |

The task definition's `taskRoleArn` and `executionRoleArn` point at the
two IAM roles below. The container image is published to the ECR
repository `cinefield/provider-worker` and runs
`worker/provider-worker.ts` as its entrypoint — the long-lived receive
loop against the provider queue.

## SQS

| Resource | Name |
|---|---|
| Provider command queue (FIFO) | `cinefield-provider.fifo` |
| Provider dead-letter queue (FIFO) | `cinefield-provider-dlq.fifo` |

`provider.submit` remains the provider command transport for Phase 6R.
`MessageGroupId` is the generation id (ordering/no-concurrent-processing
per generation); `MessageDeduplicationId` is the deterministic
`commandId` (`type:attemptId`) for transport-level dedup. Both are
defense-in-depth — the authoritative duplicate-submission guard is the
`generation_attempts` compare-and-set in Postgres, not the queue.

## IAM

| Role | Purpose |
|---|---|
| `cinefield-provider-worker-task-role` | **Task role** — the AWS permissions the *application code inside the running container* is allowed to use (what the worker's own AWS SDK calls may do). |
| `cinefield-ecs-task-execution-role` | **Execution role** — the permissions *ECS/Fargate itself* needs to start the task: pulling the container image from ECR, writing logs to CloudWatch, and injecting the secrets referenced by the task definition. The application never assumes this role's permissions directly. |

Provider secrets (`FAL_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) are injected
into the container via the ECS task definition's `secrets` block,
resolved from AWS Secrets Manager by the execution role at task start.
The worker's own code never calls the Secrets Manager API and never
reads or logs a secret value — only its presence, as a boolean, the
same discipline used throughout the codebase (`sqs-config.ts`'s
`describeSqsConfig()` is the pattern this follows). **No secret value
is recorded in this document.**

## CloudWatch alarms

| Alarm | Watches |
|---|---|
| `cinefield-provider-dlq-messages` | Messages landing in `cinefield-provider-dlq.fifo` — signals a command the worker could not process after its full redelivery budget. |
| `cinefield-provider-worker-zero-running` | The ECS service dropping to zero running tasks — signals the provider queue has no consumer. |

## SNS

CloudWatch alarm notifications are wired to an SNS topic with an email
subscription. The subscription's email address and subscription ARN
are intentionally not recorded here.

## Verified tests (all PASS)

Each test below was run against a strictly isolated fixture (a
synthetic `generations`/`generation_attempts` row pair, never real user
data, always using `provider = "mock"`) and cleaned up immediately
after verification, per the zero-cost testing methodology used
throughout Phase 6R.

1. **SQS → ECS provider-worker runtime test** — a `provider.submit`
   message sent to `cinefield-provider.fifo` is received, processed,
   and deleted by the running ECS task.
2. **Mock provider execution** — the worker resolves `provider=mock`
   through the provider registry and produces output with zero cost.
3. **Supabase output persistence** — the mock provider's output is
   written to the private `generation-outputs` Storage bucket and the
   `generation_attempts`/`generations` rows reach a terminal state.
4. **Application-level idempotency / duplicate delivery protection** —
   two messages for the same logical command, sent with *different*
   `MessageDeduplicationId`s (bypassing SQS's own transport dedup),
   still produced exactly one Storage output. The
   `generation_attempts` atomic claim, not the transport, is what
   prevented the second delivery from submitting twice.
5. **Retry / retain behavior** — a message the handler cannot durably
   resolve is left on the queue (never deleted) so SQS redelivers it.
6. **DLQ redrive after repeated `attempt_not_found`** — a schema-valid
   command referencing a non-existent attempt was redelivered across
   its full `maxReceiveCount` and parked in
   `cinefield-provider-dlq.fifo`, without ever reaching a provider
   call (the handler returns `retain` before any provider-adapter code
   executes on this path).
7. **DLQ cleanup** — the parked test message was removed from the DLQ
   after the test above, restoring it to empty.
8. **CloudWatch DLQ alarm** — `cinefield-provider-dlq-messages` alarmed
   correctly on the test message's arrival in the DLQ.
9. **CloudWatch zero-worker alarm** — `cinefield-provider-worker-zero-running`
   verified against the service's running-task count.
10. **Current healthy state** — provider worker running, DLQ empty,
    both alarms in an OK state.

## Known non-blocking IAM cleanup notes

Recorded here as a **future** least-privilege / IaC cleanup item. No
policy was changed as part of this documentation task.

- The provider task role (`cinefield-provider-worker-task-role`)
  currently grants:
  - `sqs:ReceiveMessage`
  - `sqs:DeleteMessage`
  - `sqs:ChangeMessageVisibility`
  - `sqs:GetQueueAttributes`
  - `sqs:GetQueueUrl`
- A static audit of the worker's own code
  (`worker/provider-worker.ts` and everything it imports) found
  runtime use of exactly:
  - `sqs:ReceiveMessage`
  - `sqs:DeleteMessage`
- The three remaining grants
  (`ChangeMessageVisibility`, `GetQueueAttributes`, `GetQueueUrl`) are
  not exercised by any code path today. Removing them is a
  least-privilege cleanup for a future IaC pass, not a correctness or
  security blocker at the current stage.
- The execution role (`cinefield-ecs-task-execution-role`) has
  narrowly scoped Secrets Manager permissions. FAL secret access is
  currently duplicated across two separate inline policies on that
  role — functionally harmless (both resolve to the same allow), but
  worth consolidating into one statement in the same future cleanup
  pass.
- Neither role was inspected in full via `iam:GetRole`/`iam:ListRolePolicies`
  in this pass — the credentials available at the time were
  push-only (ECR) and could not read IAM. This note reflects what
  application-code analysis and prior operator-reported policy
  contents established, not a live re-read of the policy documents.

## Future IaC migration

This AWS infrastructure was created and verified manually through the
AWS Console. This document describes that pre-IaC production baseline.
A future phase will codify the same resources (ECS cluster/service/task
definition, the two SQS queues, both IAM roles and their policies, the
two CloudWatch alarms, and the SNS topic) in Terraform or OpenTofu, at
which point the codified definitions — not this document — become the
source of truth for the infrastructure's shape. Until that phase, this
document is the authoritative description of what exists.
