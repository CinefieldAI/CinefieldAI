/**
 * Cinefield encryption ownership — DECLARES NO KEYS (Phase 6R.16).
 *
 * WHY THERE IS NO aws_kms_key HERE
 * A KMS key is one of the few AWS resources whose accidental destruction is
 * effectively unrecoverable: deleting it renders every ciphertext encrypted
 * under it permanently unreadable, and Terraform will happily plan a replace
 * for something as ordinary as a changed key policy. Key creation is
 * therefore a deliberate, separately-reviewed act — not something that
 * happens as a side effect of applying an environment.
 *
 * WHAT THIS MODULE DOES INSTEAD
 * It is the single place that answers "which key protects what". It takes
 * existing key ARNs as inputs, validates that each declared purpose has one
 * (or is explicitly using an AWS-managed key), and emits the per-purpose ARN
 * every other module consumes. That makes encryption ownership reviewable in
 * one file, which is the actual goal — the keys themselves are inventory,
 * the mapping is the decision.
 *
 * Key rotation is likewise NOT invented here: rotation policy belongs to the
 * change that creates the key, alongside the grants that depend on it.
 */

terraform {
  required_version = ">= 1.6.0"
}

locals {
  purposes = {
    queues = {
      description = "SQS command and callback queues"
      key_arn     = var.queue_key_arn
    }
    logs = {
      description = "CloudWatch log groups for ECS workers"
      key_arn     = var.log_key_arn
    }
    event_backbone = {
      description = "MSK encryption at rest"
      key_arn     = var.msk_key_arn
    }
    object_storage = {
      description = "Generation output objects, where Cinefield owns the bucket"
      key_arn     = var.storage_key_arn
    }
  }

  # A null ARN means "use the AWS-managed key for that service", which is a
  # legitimate choice and still encrypted — it is recorded explicitly so the
  # difference between "chose AWS-managed" and "forgot" is visible.
  customer_managed = { for k, v in local.purposes : k => v.key_arn if v.key_arn != null }
  aws_managed      = [for k, v in local.purposes : k if v.key_arn == null]
}

resource "terraform_data" "encryption_ownership" {
  input = {
    customer_managed_purposes = keys(local.customer_managed)
    aws_managed_purposes      = local.aws_managed
  }

  lifecycle {
    precondition {
      condition = alltrue([
        for arn in values(local.customer_managed) : can(regex("^arn:aws[a-z-]*:kms:", arn))
      ])
      error_message = "Every supplied key must be a KMS key ARN. A key id or alias resolves differently across accounts and would silently bind the wrong key."
    }

    precondition {
      # A production environment that leaves everything AWS-managed has not
      # made a decision; it has skipped one. Surface it rather than infer it.
      condition     = !var.require_customer_managed_keys || length(local.aws_managed) == 0
      error_message = "require_customer_managed_keys is set, but these purposes have no key: see the aws_managed output."
    }
  }
}
