variable "environment" {
  description = "development | staging | production — matches CinefieldEnvironment (src/lib/config/environment.ts). Namespaces every key/alias so one environment's key can never satisfy another's grant."
  type        = string
  validation {
    condition     = contains(["development", "staging", "production"], var.environment)
    error_message = "environment must be development, staging, or production."
  }
}

variable "purposes" {
  description = "Which key purposes to create. Defaults to the same four infra/modules/kms/ already names (queues/logs/event_backbone/object_storage) so this module's outputs slot into that one's inputs directly."
  type        = list(string)
  default     = ["queues", "logs", "event_backbone", "object_storage"]
}

variable "key_users" {
  description = "Map of purpose -> list of IAM role ARNs permitted kms:Decrypt/GenerateDataKey for that purpose's key, in THIS environment only. Typically infra/modules/iam/'s own role outputs (provider_worker_role_arn, temporal_worker_role_arn, dr_backup_role_arn) — never a role from a different environment's IAM module instance."
  type        = map(list(string))
  default     = {}
}
