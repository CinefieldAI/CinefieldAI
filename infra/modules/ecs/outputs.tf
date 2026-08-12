output "cluster_arn" {
  description = "ECS cluster ARN."
  value       = aws_ecs_cluster.this.arn
}

output "cluster_name" {
  description = "ECS cluster name."
  value       = aws_ecs_cluster.this.name
}

output "service_names" {
  description = "Service name by worker key."
  value       = { for k, s in aws_ecs_service.worker : k => s.name }
}

output "task_definition_arns" {
  description = "Task definition ARN by worker key."
  value       = { for k, t in aws_ecs_task_definition.worker : k => t.arn }
}

output "log_group_names" {
  description = "CloudWatch log group by worker key."
  value       = { for k, g in aws_cloudwatch_log_group.worker : k => g.name }
}
