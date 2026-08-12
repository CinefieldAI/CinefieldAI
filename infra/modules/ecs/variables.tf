variable "cluster_name" {
  description = "ECS cluster name."
  type        = string
}

variable "region" {
  description = "Region, used for the awslogs driver."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnets with NAT egress. No default: placement depends on a real VPC."
  type        = list(string)
}

variable "security_group_ids" {
  description = "Task security groups. Egress-only is the intent; a worker needs no ingress."
  type        = list(string)
}

variable "execution_role_arn" {
  description = "Task EXECUTION role: pulls the image and writes logs. Distinct from each task's own role."
  type        = string
}

variable "workers" {
  description = <<-EOT
    Long-running workers. Only services that genuinely need a persistent
    process belong here — the Next.js frontend stays on Vercel.

    `environment` is for NON-SECRET settings only; anything sensitive goes in
    `secret_arns`, which resolves at task start. A value in `environment` is
    readable by anyone with ecs:DescribeTaskDefinition.
  EOT

  type = map(object({
    image                = string
    cpu                  = string
    memory               = string
    desired_count        = number
    task_role_arn        = string
    environment          = map(string)
    secret_arns          = map(string)
    stop_timeout_seconds = number
  }))

  validation {
    # A hard stop against the most likely mistake this module can suffer.
    condition = alltrue([
      for w in values(var.workers) : alltrue([
        for k in keys(w.environment) :
        !can(regex("(?i)(secret|password|token|api_?key|credential|private_key|_url$)", k))
      ])
    ])
    error_message = "A secret-shaped or URL-shaped key appeared in a container `environment` map. Use `secret_arns` instead — task definitions are widely readable."
  }

  validation {
    condition     = alltrue([for w in values(var.workers) : w.desired_count >= 0 && w.desired_count <= 50])
    error_message = "desired_count must be between 0 and 50."
  }
}

variable "container_insights_enabled" {
  description = "CloudWatch Container Insights."
  type        = bool
  default     = true
}

variable "log_retention_days" {
  description = "CloudWatch log retention. Bounded on purpose: worker logs carry ids and codes, but indefinite retention is still a growing surface."
  type        = number
  default     = 30
}

variable "log_kms_key_arn" {
  description = "Customer-managed key for log encryption. Null uses the CloudWatch service key."
  type        = string
  default     = null
}

variable "tags" {
  description = "Tags applied to every resource."
  type        = map(string)
  default     = {}
}
