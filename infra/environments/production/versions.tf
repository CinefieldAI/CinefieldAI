terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }

  # NO BACKEND BLOCK ON PURPOSE.
  #
  # Remote-state ownership has not been decided, and hard-coding an S3 bucket
  # + DynamoDB lock table that do not exist would make `init` fail in a way
  # that reads like a bug rather than a missing decision. Bootstrapping state
  # storage — bucket, versioning, encryption, lock table, and who may write
  # to it — is its own reviewed change.
  #
  # Until then this root initializes with local state, which is adequate for
  # `validate` and code review and is NOT adequate for a real apply.
}

provider "aws" {
  region = var.region

  # Credentials come from the default provider chain — an SSO profile locally,
  # a role in CI. No access key ever appears in this tree.

  default_tags {
    tags = {
      "cinefield:environment" = "production"
      "cinefield:managed-by"  = "terraform"
    }
  }
}
