variable "cluster_name" {
  description = "MSK cluster name."
  type        = string
}

variable "kafka_version" {
  description = "Pinned Kafka version. Defaulted because an implicit version is worse than a chosen one; bump deliberately."
  type        = string
  default     = "3.6.0"
}

# ---------------------------------------------------------------------------
# Deliberately NOT defaulted. See the module header: a plausible-looking
# default here becomes a production cluster nobody sized.
# ---------------------------------------------------------------------------

variable "broker_count" {
  description = "Number of broker nodes. Must be a multiple of the number of client subnets (one broker per AZ, minimum)."
  type        = number

  validation {
    condition     = var.broker_count >= 2
    error_message = "A single-broker cluster has no availability story; use at least 2."
  }
}

variable "broker_instance_type" {
  description = "Broker instance type, e.g. kafka.m7g.large. No default: sizing is a decision, not an inheritance."
  type        = string
}

variable "broker_ebs_volume_size_gb" {
  description = "Per-broker EBS storage in GB."
  type        = number
}

variable "client_subnet_ids" {
  description = "Private subnets, one per AZ. No default: placement depends on a real VPC."
  type        = list(string)

  validation {
    condition     = length(var.client_subnet_ids) >= 2
    error_message = "MSK requires client subnets in at least two availability zones."
  }
}

variable "security_group_ids" {
  description = "Security groups controlling broker access. Must not permit ingress from the public internet."
  type        = list(string)

  validation {
    condition     = length(var.security_group_ids) > 0
    error_message = "At least one security group is required; an MSK cluster is never left unguarded."
  }
}

variable "iam_authentication_enabled" {
  description = "SASL/IAM authentication. True by default because it is the only mechanism requiring no credential material."
  type        = bool
  default     = true
}

variable "kms_key_arn" {
  description = "Customer-managed KMS key for encryption at rest. Null uses the AWS-managed MSK key — still encrypted."
  type        = string
  default     = null
}

variable "cloudwatch_log_group" {
  description = "CloudWatch log group for broker logs. Null disables broker log delivery."
  type        = string
  default     = null
}

variable "tags" {
  description = "Tags applied to the cluster."
  type        = map(string)
  default     = {}
}
