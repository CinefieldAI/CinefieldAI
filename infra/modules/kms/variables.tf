variable "queue_key_arn" {
  description = "Existing KMS key ARN for SQS. Null uses SQS-managed encryption — still encrypted at rest."
  type        = string
  default     = null
}

variable "log_key_arn" {
  description = "Existing KMS key ARN for CloudWatch log groups. Null uses the CloudWatch service key."
  type        = string
  default     = null
}

variable "msk_key_arn" {
  description = "Existing KMS key ARN for MSK encryption at rest. Null uses the AWS-managed MSK key."
  type        = string
  default     = null
}

variable "storage_key_arn" {
  description = "Existing KMS key ARN for object storage Cinefield owns. Null uses the bucket's default. Note: generation outputs live in Supabase Storage today, not S3."
  type        = string
  default     = null
}

variable "require_customer_managed_keys" {
  description = "When true, every purpose must have an explicit customer-managed key. Intended for production, so 'we never chose' cannot pass silently as 'we chose AWS-managed'."
  type        = bool
  default     = false
}
