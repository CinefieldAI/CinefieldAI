output "key_arns" {
  description = "Map of purpose -> KMS key ARN. Slot directly into infra/modules/kms/'s queue_key_arn/log_key_arn/msk_key_arn/storage_key_arn (which expect purposes named queues/logs/event_backbone/object_storage respectively) when a human deliberately decides to wire the two modules together — never automatic."
  value       = { for k, v in aws_kms_key.this : k => v.arn }
}

output "alias_names" {
  description = "Map of purpose -> alias name, for operator reference (alias/cinefield-<environment>-<purpose>)."
  value       = { for k, v in aws_kms_alias.this : k => v.name }
}
