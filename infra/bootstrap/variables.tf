variable "region" {
  description = "Region for the state bucket and lock table."
  type        = string
  default     = "eu-central-1"
}

variable "name_prefix" {
  description = "Prefix for the bucket and table name, e.g. cinefield-tfstate."
  type        = string
  default     = "cinefield-tfstate"
}
