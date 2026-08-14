output "execution_role_arn" {
  description = "Shared ECS task execution role: image pull, logs, and the named secrets only."
  value       = aws_iam_role.execution.arn
}

output "provider_worker_role_arn" {
  description = "Task role for the SQS provider worker."
  value       = aws_iam_role.provider_worker.arn
}

output "temporal_worker_role_arn" {
  description = "Task role for the Temporal worker."
  value       = aws_iam_role.temporal_worker.arn
}

output "policy_documents" {
  description = <<-EOT
    The rendered policy JSON for each boundary. Exposed so a review — or a
    policy-linting job — can read exactly what was granted without needing
    account access. Contains no ARN that is not already an input.
  EOT
  value = {
    provider_worker = data.aws_iam_policy_document.provider_worker.json
    temporal_worker = data.aws_iam_policy_document.temporal_worker.json
  }
}

output "realtime_dispatcher_role_arn" {
  description = "Task role for the realtime outbox dispatcher. Intentionally carries NO policy — it uses no AWS service."
  value       = aws_iam_role.realtime_dispatcher.arn
}

output "dr_backup_role_arn" {
  description = "Task role for the DR backup worker. Write + read-back on the DR bucket; no delete, no queues."
  value       = aws_iam_role.dr_backup.arn
}

output "media_worker_role_arn" {
  description = "Task role for the untrusted-media worker. No provider secret, no DB credential, no queue rights."
  value       = aws_iam_role.media_worker.arn
}
