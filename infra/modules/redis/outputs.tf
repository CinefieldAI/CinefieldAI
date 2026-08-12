output "responsibilities" {
  description = <<-EOT
    The declared Redis boundary: which responsibility each instance carries
    and who owns it. This is the artifact the module exists to produce — a
    reviewable statement that A and B are separate, and that neither is
    managed by this Terraform state today.
  EOT

  value = {
    application_state = {
      purpose  = "provider health, rate limits, idempotency, model/pricing cache, distributed locks"
      provider = var.redis_a_provider
      endpoint = var.redis_a_endpoint
      managed_by_terraform = false
    }
    bullmq_queue_state = {
      purpose  = "BullMQ job and retry state — isolated so a queue backlog cannot evict application state"
      provider = var.redis_b_provider
      endpoint = var.redis_b_endpoint
      managed_by_terraform = false
    }
  }
}

output "isolation_enforced" {
  description = "True once the plan-time precondition has confirmed A and B are distinct instances."
  value       = terraform_data.redis_isolation_guard.id != null
}
