/**
 * Cinefield Secrets Manager namespace (Phase 25-B) — CODE_COMPLETE, never
 * applied by this batch.
 *
 * ---------------------------------------------------------------------------
 * CONTAINERS ONLY. NO VALUE IS EVER WRITTEN BY THIS MODULE.
 * ---------------------------------------------------------------------------
 * `aws_secretsmanager_secret` creates the named container; this module
 * deliberately declares NO `aws_secretsmanager_secret_version` resource.
 * Terraform state durably persists whatever a `_version` resource's value
 * argument holds — even a "placeholder" — which is exactly the kind of
 * secret-in-state-file risk `docs/security/least-privilege.md` and this
 * repository's own secret-registry.ts discipline exist to prevent. An
 * operator sets the real value out-of-band (AWS Console, CLI, or the
 * rotation flow itself once wired) after this resource exists — the same
 * two-step "create the container in Terraform, populate it outside
 * Terraform" pattern AWS's own Secrets Manager documentation recommends
 * for exactly this reason.
 *
 * ---------------------------------------------------------------------------
 * NAMESPACE MATCHES AwsSecretsManagerProvider EXACTLY
 * ---------------------------------------------------------------------------
 * `cinefield/{environment}/{secret_name}` — the identical prefix
 * `src/lib/config/secret-access.ts`'s `AwsSecretsManagerProvider.secretId()`
 * already computes from `resolveEnvironment()`. One naming decision, made
 * once, matching both sides.
 */

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

resource "aws_secretsmanager_secret" "this" {
  for_each = toset(var.secret_names)

  name       = "cinefield/${var.environment}/${each.value}"
  kms_key_id = var.kms_key_arn

  # AWS's own minimum for automatic rotation eligibility (0 disables
  # scheduled deletion protection accidentally short-circuiting a still-live
  # secret). This module does not enable ROTATION here — that requires a
  # rotation Lambda this batch does not fabricate (section 32: "do not
  # provision paid services"); it only creates a container Secrets Manager
  # rotation could later target.
  recovery_window_in_days = 30

  tags = {
    environment = var.environment
    managedBy   = "terraform"
  }
}
