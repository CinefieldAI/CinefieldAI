variable "redis_a_provider" {
  description = <<-EOT
    Who actually owns Redis A (application state).

    "redis_cloud" is the current truth. "undecided" is allowed so a
    non-production environment can declare the gap honestly rather than
    inventing an owner. "aws_elasticache" is rejected by the module's own
    precondition until an implementation exists behind this interface — see
    the module header.
  EOT
  type        = string
  default     = "redis_cloud"

  validation {
    condition     = contains(["redis_cloud", "aws_elasticache", "undecided"], var.redis_a_provider)
    error_message = "redis_a_provider must be one of: redis_cloud, aws_elasticache, undecided."
  }
}

variable "redis_b_provider" {
  description = "Who owns Redis B (BullMQ queue state). Currently undecided and unprovisioned — Phase 6R.8 external setup."
  type        = string
  default     = "undecided"

  validation {
    condition     = contains(["redis_cloud", "aws_elasticache", "undecided"], var.redis_b_provider)
    error_message = "redis_b_provider must be one of: redis_cloud, aws_elasticache, undecided."
  }
}

variable "redis_a_endpoint" {
  description = <<-EOT
    HOST:PORT of Redis A. NOT a connection string and NOT a password.

    The application reads its credential from REDIS_URL, which lives in the
    deployment's secret store and never in Terraform: a password in a tfvars
    file is a password in git history and in every plan output. This value
    exists only so the isolation invariant can be checked and so the
    environment can document what it points at.
  EOT
  type        = string
  default     = ""

  validation {
    condition     = !can(regex("(?i)(redis(s)?://|:[^@/]+@|password)", var.redis_a_endpoint))
    error_message = "redis_a_endpoint must be a bare host:port. A URL or credential must never enter Terraform state."
  }
}

variable "redis_b_endpoint" {
  description = "HOST:PORT of Redis B. Same rule as Redis A: never a URL, never a credential."
  type        = string
  default     = ""

  validation {
    condition     = !can(regex("(?i)(redis(s)?://|:[^@/]+@|password)", var.redis_b_endpoint))
    error_message = "redis_b_endpoint must be a bare host:port. A URL or credential must never enter Terraform state."
  }
}
