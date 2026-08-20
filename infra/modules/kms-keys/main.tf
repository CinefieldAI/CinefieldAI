/**
 * Cinefield KMS key hierarchy (Phase 25-A) — CODE_COMPLETE, never applied
 * by this batch.
 *
 * ---------------------------------------------------------------------------
 * A SEPARATE MODULE, DELIBERATELY, FROM infra/modules/kms/
 * ---------------------------------------------------------------------------
 * That module's own header states plainly: "Key creation is therefore a
 * deliberate, separately-reviewed act — not something that happens as a
 * side effect of applying an environment." This module IS that deliberate,
 * separately-reviewed act — it is not wired into
 * infra/environments/{dev,production}/main.tf by this batch or any other,
 * and never will be automatically. A human who decides to activate real
 * KMS keys wires this module's outputs into `infra/modules/kms/`'s own
 * `queue_key_arn`/`log_key_arn`/`msk_key_arn`/`storage_key_arn` inputs
 * explicitly, in a reviewed diff — the same shape that module's own
 * variables already describe ("existing KMS key ARN").
 *
 * ---------------------------------------------------------------------------
 * ONE KEY PER PURPOSE PER ENVIRONMENT — CROSS-ENVIRONMENT DECRYPT IS
 * STRUCTURALLY IMPOSSIBLE, NOT MERELY DISCOURAGED
 * ---------------------------------------------------------------------------
 * 25-A's own done-criterion: "Cross-environment decrypt/read engelli."
 * Each key's policy grants `kms:Decrypt`/`kms:GenerateDataKey*` ONLY to the
 * IAM role ARNs THIS environment's `var.key_users` supplies — a `staging`
 * role has no statement anywhere in a `production` key's policy, so
 * guessing the ARN grants nothing. This is enforced at the KMS layer, not
 * only by naming discipline.
 *
 * ---------------------------------------------------------------------------
 * DELETION SAFETY (section 21)
 * ---------------------------------------------------------------------------
 * `deletion_window_in_days = 30` — AWS's own maximum recovery window.
 * Nothing in this module can force an immediate delete; scheduling one at
 * all requires a human directly changing this resource's lifecycle outside
 * Terraform's own protection, which `prevent_destroy = true` here refuses
 * by default.
 */

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

locals {
  purposes = toset(var.purposes)
}

resource "aws_kms_key" "this" {
  for_each = local.purposes

  description             = "Cinefield ${var.environment} - ${each.key}"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  policy = data.aws_iam_policy_document.key_policy[each.key].json

  tags = {
    environment = var.environment
    purpose     = each.key
    managedBy   = "terraform"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_kms_alias" "this" {
  for_each = local.purposes

  name          = "alias/cinefield-${var.environment}-${each.key}"
  target_key_id = aws_kms_key.this[each.key].key_id
}

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "key_policy" {
  for_each = local.purposes

  # Root always retains administrative control — the same baseline AWS's
  # own default key policy requires, so account-level IAM policies can
  # still manage the key even if every role below is later removed.
  statement {
    sid    = "AccountRootAdministration"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
    actions   = ["kms:*"]
    resources = ["*"]
  }

  dynamic "statement" {
    for_each = length(lookup(var.key_users, each.key, [])) > 0 ? [1] : []
    content {
      sid    = "ScopedDecryptForThisEnvironmentOnly"
      effect = "Allow"
      principals {
        type        = "AWS"
        identifiers = lookup(var.key_users, each.key, [])
      }
      actions = [
        "kms:Decrypt",
        "kms:GenerateDataKey",
        "kms:GenerateDataKeyWithoutPlaintext",
        "kms:DescribeKey",
      ]
      resources = ["*"]
    }
  }
}
