output "secret_arns" {
  description = "Map of bare secret name -> full Secrets Manager ARN. Slots directly into infra/modules/ecs/'s per-role secret_arns maps (the ECS module already reads this shape — see its own main.tf's `secrets = [for k, arn in each.value.secret_arns : ...]`) and into infra/modules/iam/'s task_secret_arns variable, both unmodified by this batch."
  value       = { for k, v in aws_secretsmanager_secret.this : k => v.arn }
}
