variable "region" {
  description = "AWS region. Locked production region, matching DEFAULT_AWS_REGION in src/lib/aws/sqs-topology.ts."
  type        = string
  default     = "eu-central-1"
}

# ---------------------------------------------------------------------------
# Network. No defaults: placement depends on a real VPC, and a guessed subnet
# id is worse than a missing one.
# ---------------------------------------------------------------------------

variable "private_subnet_ids" {
  description = "Private subnets with NAT egress, for workers and MSK brokers."
  type        = list(string)
}

variable "worker_security_group_ids" {
  description = "Security groups for ECS worker tasks. Egress-only intent."
  type        = list(string)
}

variable "msk_security_group_ids" {
  description = "Security groups for MSK brokers. Unused unless enable_msk is true."
  type        = list(string)
  default     = []
}

# ---------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------

variable "provider_worker_image" {
  description = "Container image for the SQS provider worker, digest-pinned in production."
  type        = string
}

variable "temporal_worker_image" {
  description = "Container image for the Temporal worker, digest-pinned in production."
  type        = string
}

variable "provider_worker_desired_count" {
  description = "Provider worker task count."
  type        = number
  default     = 1
}

variable "temporal_worker_desired_count" {
  description = "Temporal worker task count."
  type        = number
  default     = 1
}

# ---------------------------------------------------------------------------
# Secrets: ARNs ONLY. No value belonging to a secret ever enters this tree.
# ---------------------------------------------------------------------------

variable "provider_worker_secret_arns" {
  description = "Secret ARNs the provider worker's task definition resolves at start (env var name -> ARN)."
  type        = map(string)
  default     = {}
}

variable "temporal_worker_secret_arns" {
  description = "Secret ARNs the Temporal worker's task definition resolves at start (env var name -> ARN)."
  type        = map(string)
  default     = {}
}

variable "task_secret_arns" {
  description = "Flat list of every secret ARN above. Scopes the execution role's read permission to exactly these."
  type        = list(string)
  default     = []
}

# ---------------------------------------------------------------------------
# Encryption
# ---------------------------------------------------------------------------

variable "queue_kms_key_arn" {
  description = "Customer-managed key for SQS. Null uses SQS-managed encryption."
  type        = string
  default     = null
}

variable "log_kms_key_arn" {
  description = "Customer-managed key for CloudWatch log groups."
  type        = string
  default     = null
}

variable "msk_kms_key_arn" {
  description = "Customer-managed key for MSK at rest."
  type        = string
  default     = null
}

variable "require_customer_managed_keys" {
  description = "Fail the plan if any purpose lacks an explicit key. Off until keys are created, so this root stays reviewable meanwhile."
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# Redis. Host:port only — the credential lives in the secret store, never here.
# ---------------------------------------------------------------------------

variable "redis_a_endpoint" {
  description = "Redis A (application state) host:port. Redis Cloud — not managed by this Terraform."
  type        = string
  default     = ""
}

variable "redis_b_provider" {
  description = "Redis B (BullMQ) provider. Undecided and unprovisioned — Phase 6R.8 external setup."
  type        = string
  default     = "undecided"
}

variable "redis_b_endpoint" {
  description = "Redis B host:port, once it exists. Must differ from Redis A."
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------
# MSK. Off by default: Kafka is external setup that has not happened.
# ---------------------------------------------------------------------------

variable "enable_msk" {
  description = "Create the MSK cluster. False until Kafka provisioning is actually decided and sized."
  type        = bool
  default     = false
}

variable "msk_broker_count" {
  description = "Broker nodes. Unused unless enable_msk is true."
  type        = number
  default     = 2
}

variable "msk_broker_instance_type" {
  description = "Broker instance type. Unused unless enable_msk is true; must be chosen deliberately before enabling."
  type        = string
  default     = "kafka.m7g.large"
}

variable "msk_broker_ebs_volume_size_gb" {
  description = "Per-broker EBS storage in GB. Unused unless enable_msk is true."
  type        = number
  default     = 100
}
