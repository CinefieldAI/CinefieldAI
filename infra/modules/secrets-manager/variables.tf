variable "environment" {
  description = "development | staging | production — matches CinefieldEnvironment and AwsSecretsManagerProvider's own namespace prefix exactly."
  type        = string
  validation {
    condition     = contains(["development", "staging", "production"], var.environment)
    error_message = "environment must be development, staging, or production."
  }
}

variable "secret_names" {
  description = "Bare secret NAMES (e.g. \"SUPABASE_SERVICE_ROLE_KEY\") to create containers for — must match src/lib/config/secret-registry.ts entries with class SERVER_SECRET/INFRA_SECRET/PROVIDER_SECRET. No default: the list is a deliberate, reviewed decision per environment, never every registry entry automatically."
  type        = list(string)
}

variable "kms_key_arn" {
  description = "KMS key ARN to encrypt these secrets with. Null uses the AWS-managed aws/secretsmanager key — still encrypted at rest, just not customer-managed. Typically infra/modules/kms-keys/'s own output for a purpose named for secrets, wired explicitly when a human decides to."
  type        = string
  default     = null
}
