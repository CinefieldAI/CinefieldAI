/**
 * Phase 26-B — AWS Fault Injection Service experiment templates.
 *
 * CODE_COMPLETE, LIVE_DEFERRED, same as infra/modules/kms-keys/ and
 * infra/modules/secrets-manager/ before it: `terraform fmt`/`validate` pass,
 * nothing here is applied, and `var.experiments` ships empty from every
 * environment root until a real, reviewed decision wires real target ARNs
 * and a real FIS role in. No experiment defined here can ever run against
 * "everything" — `experiment_options.account_targeting = "single-account"`
 * refuses the alternative account-scope FIS supports, and every target is an
 * explicit ARN list (variables.tf refuses a wildcard structurally, not by
 * convention).
 *
 * Production is not excluded at the Terraform layer — an environment's own
 * root decides what it instantiates this module with, and instantiating it
 * for `production` is itself the "explicit approval" the roadmap's 26 done-
 * criterion and section 7's execution-boundary rule require. Today, no
 * environment root references this module at all (see the "not wired"
 * disclosure in docs/security-gates.md's Phase 26 section) — the code-level
 * refusal in src/lib/chaos/chaos-environment-guard.ts is the ONLY boundary
 * that is actually live right now.
 */

resource "aws_fis_experiment_template" "this" {
  for_each = var.experiments

  description = each.value.description
  role_arn    = var.fis_role_arn

  action {
    name      = each.key
    action_id = each.value.action_id

    target {
      key   = "Instances"
      value = each.key
    }
  }

  target {
    name           = each.key
    resource_type  = each.value.target_resource_type
    resource_arns  = each.value.target_resource_arns
    selection_mode = "ALL"
  }

  dynamic "stop_condition" {
    for_each = each.value.stop_condition_alarm_arns
    content {
      source = "aws:cloudwatch:alarm"
      value  = stop_condition.value
    }
  }

  # Refuses the org/account-wide blast radius FIS otherwise permits. This is
  # the single-account guardrail section 28's "no account-wide AWS fault
  # injection" invariant requires structurally, not merely by review.
  experiment_options {
    account_targeting            = "single-account"
    empty_target_resolution_mode = "fail"
  }

  tags = {
    "cinefield:environment" = var.environment
    "cinefield:managed-by"  = "terraform"
    "cinefield:phase"       = "26-B"
  }
}
