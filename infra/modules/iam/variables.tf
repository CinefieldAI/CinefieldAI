variable "name_prefix" {
  description = "Role name prefix, e.g. cinefield-production."
  type        = string
}

variable "region" {
  description = "Region, used in kms:ViaService conditions."
  type        = string
}

variable "provider_worker_consume_queue_arns" {
  description = "Queues the provider worker RECEIVES from. Scoped to exactly these ARNs — never a wildcard."
  type        = list(string)

  validation {
    condition     = length(var.provider_worker_consume_queue_arns) > 0 && !contains(var.provider_worker_consume_queue_arns, "*")
    error_message = "Provide explicit queue ARNs. A wildcard resource is never acceptable here."
  }
}

variable "provider_worker_produce_queue_arns" {
  description = "Queues the provider worker SENDS to, if any. Separate from consuming so the two are granted independently."
  type        = list(string)
  default     = []

  validation {
    condition     = !contains(var.provider_worker_produce_queue_arns, "*")
    error_message = "A wildcard resource is never acceptable here."
  }
}

variable "temporal_worker_produce_queue_arns" {
  description = "Queues the Temporal worker dispatches commands to."
  type        = list(string)

  validation {
    condition     = length(var.temporal_worker_produce_queue_arns) > 0 && !contains(var.temporal_worker_produce_queue_arns, "*")
    error_message = "Provide explicit queue ARNs. A wildcard resource is never acceptable here."
  }
}

variable "task_secret_arns" {
  description = <<-EOT
    The exact secret/parameter ARNs the task definitions reference. The
    execution role gets read access to these and nothing else — a broad grant
    is how every task in a cluster ends up able to read every secret.

    ARNs only. No secret VALUE ever appears in Terraform.
  EOT
  type        = list(string)
  default     = []

  validation {
    condition     = !contains(var.task_secret_arns, "*")
    error_message = "A wildcard secret resource defeats the point of this variable."
  }
}

variable "msk_cluster_arn" {
  description = "MSK cluster ARN. Null omits every Kafka statement entirely — no permission is granted for infrastructure that does not exist."
  type        = string
  default     = null
}

variable "queue_kms_key_arn" {
  description = "Customer-managed key encrypting the queues. Null omits the KMS statements (SQS-managed encryption needs no grant)."
  type        = string
  default     = null
}

variable "tags" {
  description = "Tags applied to every role."
  type        = map(string)
  default     = {}
}
