# Least privilege — runtime identities and the secret injection matrix

Phase 12-D. Roadmap ¶1645 ("least privilege"), ¶1219 / 6R.22 (queue-scoped
IAM), ¶327 and ¶1458 (both red — the untrusted-media sandbox), ¶2210
(queue-based IAM fixed in code, not in a console).

Nothing here is applied. The IAM module is `infra/modules/iam/`, and
provisioning it is Phase 25 / IaC work that needs an AWS account.

---

## The rule

**One role per boundary, not one role per account.** Every runtime gets
exactly the actions its code performs, scoped to exactly the ARNs it touches.
No `Action = "*"`, no `Resource = "*"`. A static test scans the Terraform and
fails on either.

There is one narrow exception, and it is in AWS's own model: MSK topic actions
must be granted against a cluster-derived ARN *pattern*, because topics are
created at runtime. The wildcard is the topic segment inside this cluster's
ARN — never the resource.

---

## Runtime identities

| Runtime | AWS actions | Scope | Notes |
| --- | --- | --- | --- |
| ECS task **execution** role | ECR pull, CloudWatch logs, `secretsmanager:GetSecretValue`, `ssm:GetParameters` | only the exact secret ARNs the task definitions reference | AWS plumbing, never the application's own permissions. A broad grant here is how every task in a cluster ends up able to read every secret. |
| **Provider worker** | `sqs:ReceiveMessage`, `DeleteMessage`, `GetQueueAttributes`, `ChangeMessageVisibility`; optional `SendMessage` | named queue ARNs, consume and produce granted separately | Extends visibility in flight rather than letting a live claim time out into a duplicate delivery. |
| **Temporal worker** | `sqs:SendMessage`, `GetQueueAttributes`; `kafka-cluster:Connect/WriteData/DescribeTopic` when MSK exists | named queue ARNs; this cluster's topic prefix | Dispatches commands; produces domain events. |
| **Realtime dispatcher** | **none** | — | Claims outbox rows from PostgreSQL, writes Redis Streams. Neither is an AWS service. The role exists with an empty policy so that the day it needs an action, granting it is a reviewed change rather than something it inherited. |
| **DR backup worker** | `s3:PutObject`, `GetObject`, `ListBucket`; KMS via `s3.<region>` | the DR bucket and its keys | **No `DeleteObject`.** Programmatic deletion is impossible, not merely unimplemented; retention is a bucket lifecycle policy, which an application credential cannot reach. No queues. |
| **Media worker** | `s3:PutObject`, `GetObject` | one scratch bucket's key path | **No `ListBucket`** — a compromised parser must not enumerate other users' objects. See below. |

---

## The media worker is a sandbox, and IAM is only half of it

Red notes ¶327 and ¶1458 say the same thing twice: the Outbound Fetch Gateway
bounds where a download may *go*, but it cannot make the bytes safe, and those
bytes reach FFmpeg, image decoders and audio parsers. So the media worker runs
"disposable sandbox'ta … provider/DB secret YOK, read-only filesystem,
CPU/RAM/file-size/execution-time limitleri, restricted egress ve minimum IAM."

The IAM half is one write path. The **secret** half is the injection matrix
below, and it is the part that actually matters: a parser exploit in a process
holding a Supabase service key is a database compromise, while the same
exploit in a process holding nothing is a wasted container.

6R.22 (¶1219) adds the queue half — "media worker'ın generation command
kuyruğuna SendMessage hakkı olmaz". There is no SQS statement in that role at
all, so it holds by construction rather than by a deny rule someone could
reorder.

---

## Secret injection matrix

Which runtime receives which secret. A blank cell is a deliberate refusal, not
an oversight — every one of them is a blast-radius decision.

| Secret | Web (Vercel) | Temporal worker | Provider worker | Realtime dispatcher | DR backup | Media worker |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| `CLERK_SECRET_KEY` | ✅ | | | | | |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | ✅ | ✅ | ✅ | | **✗** |
| `REDIS_URL` (Redis A) | ✅ | ✅ | ✅ | ✅ | | |
| `BULLMQ_REDIS_URL` (Redis B) | | | ✅ | | | |
| `TEMPORAL_API_KEY` | ✅ | ✅ | | | | |
| Provider keys (`FAL_KEY`, …) | | | ✅ | | | **✗** |
| `CLOUDFLARE_R2_*` | ✅ | | ✅ | | ✅ | |
| DR bucket access | | | | | ✅ (task role) | |

The two ✗ cells are the red notes, written as configuration.

The web tier holds `CLERK_SECRET_KEY` and no provider key: a request handler
never calls a provider directly — it starts a workflow, and the worker holding
the provider credential is not internet-facing.

---

## Redis A and Redis B are different credentials

6R.25 (¶1225): both are closed to the public internet, both run TLS + auth,
and they use **separate credentials in separate environments**. Redis A is
application state; Redis B is BullMQ queue state only (red note ¶244).

`validateConfiguration()` fails closed if `REDIS_URL` and `BULLMQ_REDIS_URL`
resolve to the same target, because sharing one instance means a BullMQ flush
wipes rate-limit counters, connection leases and idempotency records — a
correctness failure that presents as an unrelated outage.

---

## What is not covered here

- **No IAM is applied.** These are Terraform definitions and a matrix.
- **KMS key policies** beyond the `kms:ViaService`-conditioned grants above
  are Phase 25 (¶2691).
- **CloudTrail alerting on anomalous secret reads** is Phase 25 (¶2683, ¶2696).
- **Human access** — who may assume these roles — is Phase 16's admin plane
  (¶1954), and secret/key operations are already on the two-person list
  (¶2284), registered in the 12-E policy gate as `secret.rotate` and currently
  denying.
