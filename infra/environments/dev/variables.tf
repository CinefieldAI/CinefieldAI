variable "region" {
  description = "AWS region."
  type        = string
  default     = "eu-central-1"
}

variable "redis_a_provider" {
  description = "Owner of dev Redis A. 'undecided' is honest for an environment with no instance yet."
  type        = string
  default     = "undecided"
}

variable "redis_a_endpoint" {
  description = "Dev Redis A host:port. Never a URL, never a credential."
  type        = string
  default     = ""
}

variable "redis_b_provider" {
  description = "Owner of dev Redis B (BullMQ)."
  type        = string
  default     = "undecided"
}

variable "redis_b_endpoint" {
  description = "Dev Redis B host:port. Must differ from Redis A."
  type        = string
  default     = ""
}
