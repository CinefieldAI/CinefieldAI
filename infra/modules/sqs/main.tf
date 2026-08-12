/**
 * Cinefield SQS topology (Phase 6R.16).
 *
 * Declares the queues src/lib/aws/sqs-topology.ts already contracts. That
 * file stays the source of truth the application reads; this module must
 * agree with it, which is why the defaults are copied from it verbatim
 * rather than re-derived.
 *
 * DLQ FIRST, THEN THE QUEUE THAT REDRIVES INTO IT — the redrive policy needs
 * the DLQ's ARN, so the dependency direction is fixed.
 *
 * Redrive out of a DLQ is deliberately NOT automated here. A redriven
 * provider command re-enters the worker, whose attempt-evidence gate decides
 * whether submission is still legal; automating that loop would put a
 * potentially billable retry on a timer no human reviewed.
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

locals {
  # A FIFO DLQ is mandatory for a FIFO queue; the variable validation already
  # enforces the naming half of that rule.
  queues = var.queues
}

resource "aws_sqs_queue" "dlq" {
  for_each = local.queues

  name       = "${var.name_prefix}${each.value.dlq_name}"
  fifo_queue = each.value.fifo

  # Content-based dedup is off: Cinefield supplies an explicit, deterministic
  # MessageDeduplicationId (commandIdFor) so dedup identity is a reviewed
  # value rather than a hash of whatever the body happens to contain.
  content_based_deduplication = false

  message_retention_seconds = var.message_retention_seconds

  kms_master_key_id       = var.kms_master_key_id
  sqs_managed_sse_enabled = var.kms_master_key_id == null ? true : null

  tags = merge(var.tags, {
    "cinefield:role"  = "dead-letter"
    "cinefield:queue" = each.key
  })
}

resource "aws_sqs_queue" "main" {
  for_each = local.queues

  name       = "${var.name_prefix}${each.value.name}"
  fifo_queue = each.value.fifo

  content_based_deduplication = false

  visibility_timeout_seconds = each.value.visibility_timeout_seconds
  receive_wait_time_seconds  = each.value.receive_wait_time_seconds
  message_retention_seconds  = var.message_retention_seconds

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq[each.key].arn
    maxReceiveCount     = each.value.max_receive_count
  })

  kms_master_key_id       = var.kms_master_key_id
  sqs_managed_sse_enabled = var.kms_master_key_id == null ? true : null

  tags = merge(var.tags, {
    "cinefield:role"  = "primary"
    "cinefield:queue" = each.key
  })
}
