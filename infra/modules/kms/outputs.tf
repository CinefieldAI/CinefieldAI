output "queue_key_arn" {
  description = "Key protecting the SQS queues, or null for SQS-managed encryption."
  value       = var.queue_key_arn
}

output "log_key_arn" {
  description = "Key protecting ECS worker log groups, or null for the CloudWatch service key."
  value       = var.log_key_arn
}

output "msk_key_arn" {
  description = "Key protecting MSK at rest, or null for the AWS-managed MSK key."
  value       = var.msk_key_arn
}

output "storage_key_arn" {
  description = "Key protecting Cinefield-owned object storage, or null."
  value       = var.storage_key_arn
}

output "encryption_ownership" {
  description = <<-EOT
    The reviewable answer to "which key protects what", including which
    purposes deliberately use an AWS-managed key. This mapping is the
    artifact; the keys themselves are inventory created outside Terraform.
  EOT
  value = {
    customer_managed = local.customer_managed
    aws_managed      = local.aws_managed
  }
}
