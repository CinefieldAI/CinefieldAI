variable "name_prefix" {
  description = "Resource name prefix. Queue names below already carry the cinefield- prefix; this scopes non-production environments."
  type        = string
}

variable "queues" {
  description = <<-EOT
    The queue topology. Mirrors src/lib/aws/sqs-topology.ts, which is the
    reviewable contract the application actually reads — the names, FIFO
    choice, redelivery budget and visibility windows must match it exactly or
    a worker will long-poll a queue that does not exist. Defaults are supplied
    from that file rather than invented here.
  EOT

  type = map(object({
    name                       = string
    fifo                       = bool
    dlq_name                   = string
    max_receive_count          = number
    visibility_timeout_seconds = number
    receive_wait_time_seconds  = number
  }))

  default = {
    provider = {
      name                       = "cinefield-provider.fifo"
      fifo                       = true
      dlq_name                   = "cinefield-provider-dlq.fifo"
      max_receive_count          = 5
      visibility_timeout_seconds = 180
      receive_wait_time_seconds  = 20
    }
    generation_control = {
      name                       = "cinefield-generation-control.fifo"
      fifo                       = true
      dlq_name                   = "cinefield-generation-control-dlq.fifo"
      max_receive_count          = 5
      visibility_timeout_seconds = 60
      receive_wait_time_seconds  = 20
    }
    provider_callback = {
      name                       = "cinefield-provider-callback"
      fifo                       = false
      dlq_name                   = "cinefield-provider-callback-dlq"
      max_receive_count          = 5
      visibility_timeout_seconds = 120
      receive_wait_time_seconds  = 20
    }
    media_download = {
      name                       = "cinefield-media-download"
      fifo                       = false
      dlq_name                   = "cinefield-media-download-dlq"
      max_receive_count          = 5
      visibility_timeout_seconds = 300
      receive_wait_time_seconds  = 20
    }
    media_processing = {
      name                       = "cinefield-media-processing"
      fifo                       = false
      dlq_name                   = "cinefield-media-processing-dlq"
      max_receive_count          = 5
      visibility_timeout_seconds = 900
      receive_wait_time_seconds  = 20
    }
    moderation = {
      name                       = "cinefield-moderation"
      fifo                       = false
      dlq_name                   = "cinefield-moderation-dlq"
      max_receive_count          = 5
      visibility_timeout_seconds = 120
      receive_wait_time_seconds  = 20
    }
    backup = {
      name                       = "cinefield-backup"
      fifo                       = false
      dlq_name                   = "cinefield-backup-dlq"
      max_receive_count          = 3
      visibility_timeout_seconds = 900
      receive_wait_time_seconds  = 20
    }
  }

  validation {
    # SQS refuses a FIFO queue whose name does not end in .fifo, and refuses a
    # non-FIFO DLQ for a FIFO queue. Catching it here beats catching it in a
    # half-applied plan.
    condition = alltrue([
      for q in values(var.queues) :
      q.fifo ? (endswith(q.name, ".fifo") && endswith(q.dlq_name, ".fifo"))
      : (!endswith(q.name, ".fifo") && !endswith(q.dlq_name, ".fifo"))
    ])
    error_message = "FIFO queues and their DLQs must both end in .fifo; standard queues must not."
  }

  validation {
    condition     = alltrue([for q in values(var.queues) : q.max_receive_count >= 1 && q.max_receive_count <= 1000])
    error_message = "max_receive_count must be between 1 and 1000."
  }
}

variable "kms_master_key_id" {
  description = "KMS key id/ARN for server-side encryption. Null uses SQS-owned encryption (sqs_managed_sse_enabled), which is still encrypted at rest."
  type        = string
  default     = null
}

variable "message_retention_seconds" {
  description = "How long an undelivered message survives. 4 days: long enough to survive a weekend outage, short enough that a forgotten DLQ does not accumulate indefinitely."
  type        = number
  default     = 345600
}

variable "tags" {
  description = "Tags applied to every queue."
  type        = map(string)
  default     = {}
}
