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
