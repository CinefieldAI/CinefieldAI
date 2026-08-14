/**
 * Cinefield IAM — least privilege by service boundary (Phase 6R.16).
 *
 * ONE ROLE PER BOUNDARY, NOT ONE ROLE PER ACCOUNT. The provider worker, the
 * Temporal worker and the shared task-execution role each get exactly the
 * actions their code performs, scoped to exactly the ARNs it touches.
 *
 * NO Action = "*" AND NO Resource = "*" ANYWHERE IN THIS MODULE.
 * There is one narrow exception in AWS's own model — `kafka-cluster:Connect`
 * and the topic/group actions must be granted against cluster-derived ARN
 * patterns rather than a single ARN, because topics are created at runtime.
 * Those are still scoped to THIS cluster's ARN prefix, never to `*`, and the
 * wildcard is inside the resource path, not the resource itself.
 *
 * The execution role deliberately does NOT get secret read permission by
 * default. It needs it only for the specific secret ARNs a task definition
 * references, which the caller passes in — granting it broadly is how every
 * task in a cluster ends up able to read every secret.
 */

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

data "aws_iam_policy_document" "ecs_task_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# ---------------------------------------------------------------------------
# Task EXECUTION role — AWS's plumbing: pull the image, ship the logs, and
# resolve ONLY the named secrets. Never the application's own permissions.
# ---------------------------------------------------------------------------

resource "aws_iam_role" "execution" {
  name               = "${var.name_prefix}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role = aws_iam_role.execution.name
  # AWS's own managed policy for ECR pull + CloudWatch log creation. Using it
  # rather than hand-rolling keeps up with AWS's changes to that plumbing.
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  count = length(var.task_secret_arns) > 0 ? 1 : 0

  statement {
    sid       = "ReadOnlyTheSecretsTheseTasksReference"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue", "ssm:GetParameters"]
    resources = var.task_secret_arns
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  count  = length(var.task_secret_arns) > 0 ? 1 : 0
  name   = "${var.name_prefix}-ecs-execution-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets[0].json
}

# ---------------------------------------------------------------------------
# Provider worker task role — SQS consumer.
# ---------------------------------------------------------------------------

resource "aws_iam_role" "provider_worker" {
  name               = "${var.name_prefix}-provider-worker"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume.json
  tags               = var.tags
}

data "aws_iam_policy_document" "provider_worker" {
  statement {
    sid    = "ConsumeProviderCommands"
    effect = "Allow"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      # The handler extends visibility while a submission is in flight rather
      # than letting a live claim time out into a duplicate delivery.
      "sqs:ChangeMessageVisibility",
    ]
    resources = var.provider_worker_consume_queue_arns
  }

  dynamic "statement" {
    # Producing is separate from consuming and is granted only where the
    # worker genuinely enqueues follow-on work.
    for_each = length(var.provider_worker_produce_queue_arns) > 0 ? [1] : []
    content {
      sid       = "EnqueueFollowOnWork"
      effect    = "Allow"
      actions   = ["sqs:SendMessage", "sqs:GetQueueAttributes"]
      resources = var.provider_worker_produce_queue_arns
    }
  }

  dynamic "statement" {
    for_each = var.queue_kms_key_arn == null ? [] : [1]
    content {
      sid       = "UseQueueEncryptionKey"
      effect    = "Allow"
      actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
      resources = [var.queue_kms_key_arn]
      condition {
        test     = "StringEquals"
        variable = "kms:ViaService"
        values   = ["sqs.${var.region}.amazonaws.com"]
      }
    }
  }
}

resource "aws_iam_role_policy" "provider_worker" {
  name   = "${var.name_prefix}-provider-worker"
  role   = aws_iam_role.provider_worker.id
  policy = data.aws_iam_policy_document.provider_worker.json
}

# ---------------------------------------------------------------------------
# Temporal worker task role — dispatches commands, publishes events.
# ---------------------------------------------------------------------------

resource "aws_iam_role" "temporal_worker" {
  name               = "${var.name_prefix}-temporal-worker"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume.json
  tags               = var.tags
}

data "aws_iam_policy_document" "temporal_worker" {
  statement {
    sid       = "DispatchCommands"
    effect    = "Allow"
    actions   = ["sqs:SendMessage", "sqs:GetQueueAttributes"]
    resources = var.temporal_worker_produce_queue_arns
  }

  dynamic "statement" {
    for_each = var.msk_cluster_arn == null ? [] : [1]
    content {
      sid       = "ConnectToEventBackbone"
      effect    = "Allow"
      actions   = ["kafka-cluster:Connect", "kafka-cluster:DescribeCluster"]
      resources = [var.msk_cluster_arn]
    }
  }

  dynamic "statement" {
    for_each = var.msk_cluster_arn == null ? [] : [1]
    content {
      sid    = "ProduceDomainEvents"
      effect = "Allow"
      actions = [
        "kafka-cluster:WriteData",
        "kafka-cluster:DescribeTopic",
      ]
      # Topics are created at runtime, so AWS's model requires a topic ARN
      # PATTERN here. It is still bounded to this cluster — the wildcard is
      # the topic segment, never the resource.
      resources = [replace(var.msk_cluster_arn, ":cluster/", ":topic/")]
    }
  }

  dynamic "statement" {
    for_each = var.queue_kms_key_arn == null ? [] : [1]
    content {
      sid       = "UseQueueEncryptionKey"
      effect    = "Allow"
      actions   = ["kms:GenerateDataKey", "kms:Decrypt"]
      resources = [var.queue_kms_key_arn]
      condition {
        test     = "StringEquals"
        variable = "kms:ViaService"
        values   = ["sqs.${var.region}.amazonaws.com"]
      }
    }
  }
}

resource "aws_iam_role_policy" "temporal_worker" {
  name   = "${var.name_prefix}-temporal-worker"
  role   = aws_iam_role.temporal_worker.id
  policy = data.aws_iam_policy_document.temporal_worker.json
}

# ---------------------------------------------------------------------------
# Realtime dispatcher task role — Phase 12-D.
# ---------------------------------------------------------------------------
# IT GETS NO AWS PERMISSIONS, AND THAT IS THE FINDING.
#
# The dispatcher claims outbox rows from PostgreSQL and writes them to Redis
# Streams. Neither is an AWS service: Supabase authenticates with a service
# key and Redis with a URL, both injected as secrets by the execution role.
# It sends no SQS message, touches no bucket, produces to no topic.
#
# So the role exists with an assume-role trust and no inline policy at all.
# Creating it anyway rather than reusing another worker's role is the whole
# point of one-role-per-boundary: the day the dispatcher genuinely needs an
# AWS action, granting it is a reviewed one-line change instead of something
# it already had because it was sharing a role with the Temporal worker.
resource "aws_iam_role" "realtime_dispatcher" {
  name               = "${var.name_prefix}-realtime-dispatcher"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume.json
  tags               = var.tags
}

# ---------------------------------------------------------------------------
# DR backup worker task role — Phase 12-D (Phase 9-D's runtime).
# ---------------------------------------------------------------------------
# Writes R2 objects into the S3 disaster-recovery bucket. WRITE AND READ, NO
# DELETE: the operator's own note on 9-D is that DeleteObject authority was
# never granted, so programmatic deletion is impossible rather than merely
# unimplemented. Retention on that bucket is a lifecycle policy's job, which
# is an account-level control an application credential cannot reach.
#
# It also gets no SQS and no Kafka. A backup job that could enqueue a
# generation command would be a backup job that could start paid work.
resource "aws_iam_role" "dr_backup" {
  name               = "${var.name_prefix}-dr-backup"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume.json
  tags               = var.tags
}

data "aws_iam_policy_document" "dr_backup" {
  count = var.dr_bucket_arn == null ? 0 : 1

  statement {
    sid    = "WriteBackupObjects"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      # Read-back is how a backup is verified. `stored != verified` is a
      # standing rule in this codebase, and it needs GetObject to hold.
      "s3:GetObject",
      "s3:ListBucket",
    ]
    # Bucket ARN for ListBucket, object ARN for the object actions. The `/*`
    # is the key path inside THIS bucket, never a wildcard resource.
    resources = [var.dr_bucket_arn, "${var.dr_bucket_arn}/*"]
  }

  dynamic "statement" {
    for_each = var.dr_kms_key_arn == null ? [] : [1]
    content {
      sid       = "UseBackupEncryptionKey"
      effect    = "Allow"
      actions   = ["kms:GenerateDataKey", "kms:Decrypt"]
      resources = [var.dr_kms_key_arn]
      condition {
        test     = "StringEquals"
        variable = "kms:ViaService"
        values   = ["s3.${var.region}.amazonaws.com"]
      }
    }
  }
}

resource "aws_iam_role_policy" "dr_backup" {
  count  = var.dr_bucket_arn == null ? 0 : 1
  name   = "${var.name_prefix}-dr-backup"
  role   = aws_iam_role.dr_backup.id
  policy = data.aws_iam_policy_document.dr_backup[0].json
}

# ---------------------------------------------------------------------------
# Media worker task role — Phase 12-D, enforcing a red note.
# ---------------------------------------------------------------------------
# Roadmap ¶327 and ¶1458 (both red): "Media Worker disposable sandbox'ta
# çalışmalı: provider/DB secret YOK, read-only filesystem,
# CPU/RAM/file-size/execution-time limitleri, restricted egress ve minimum
# IAM." The Outbound Fetch Gateway bounds where a download may GO; it cannot
# make the bytes safe, and those bytes reach FFmpeg and image parsers.
#
# The IAM half of that sandbox is this role, and its content is almost
# nothing. The secret half is enforced by the injection matrix in
# docs/security/least-privilege.md and by test: this task definition
# references NO provider secret and NO database credential, so a parser
# exploit lands in a process that holds neither.
#
# 6R.22 (¶1219) adds the queue half: "media worker'ın generation command
# kuyruğuna SendMessage hakkı olmaz." There is no SQS statement here at all,
# so that holds by construction rather than by a deny rule someone could
# reorder.
resource "aws_iam_role" "media_worker" {
  name               = "${var.name_prefix}-media-worker"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume.json
  tags               = var.tags
}

data "aws_iam_policy_document" "media_worker" {
  count = var.media_scratch_bucket_arn == null ? 0 : 1

  statement {
    sid    = "WriteProcessedMediaOnly"
    effect = "Allow"
    # No ListBucket: a compromised parser must not be able to enumerate other
    # users' objects. It writes what it was told to write and reads back the
    # single key it just wrote.
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = ["${var.media_scratch_bucket_arn}/*"]
  }
}

resource "aws_iam_role_policy" "media_worker" {
  count  = var.media_scratch_bucket_arn == null ? 0 : 1
  name   = "${var.name_prefix}-media-worker"
  role   = aws_iam_role.media_worker.id
  policy = data.aws_iam_policy_document.media_worker[0].json
}
