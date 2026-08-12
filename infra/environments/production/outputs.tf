output "queue_urls" {
  description = "Queue URLs by logical key. A URL identifies; IAM authenticates."
  value       = module.sqs.queue_urls
}

output "ecs_cluster_name" {
  description = "ECS cluster name."
  value       = module.ecs.cluster_name
}

output "worker_role_arns" {
  description = "Task role ARN per worker boundary."
  value = {
    provider_worker = module.iam.provider_worker_role_arn
    temporal_worker = module.iam.temporal_worker_role_arn
  }
}

output "redis_boundary" {
  description = "The declared Redis A / Redis B separation and who owns each. Neither is managed by this state."
  value       = module.redis.responsibilities
}

output "encryption_ownership" {
  description = "Which key protects what, including purposes deliberately left on an AWS-managed key."
  value       = module.kms.encryption_ownership
}
