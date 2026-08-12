output "queue_urls" {
  description = "Dev queue URLs by logical key."
  value       = module.sqs.queue_urls
}

output "worker_role_arns" {
  description = "Task role ARN per worker boundary."
  value = {
    provider_worker = module.iam.provider_worker_role_arn
    temporal_worker = module.iam.temporal_worker_role_arn
  }
}

output "redis_boundary" {
  description = "The declared Redis A / Redis B separation."
  value       = module.redis.responsibilities
}
