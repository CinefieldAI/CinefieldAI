terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }

  # Empty, PARTIAL backend block (Phase 18-A) — same reasoning as the dev
  # root's own comment. `infra/bootstrap/` now defines the S3 bucket +
  # DynamoDB lock table this points at (CODE_COMPLETE, never applied — see
  # that module's own header). Real values are supplied at
  # `init -backend-config=backend.hcl` time from
  # environments/production/backend.hcl, which is git-ignored exactly like
  # every other *.tfvars in this tree; only backend.hcl.example is
  # committed. Until that bootstrap is applied for real,
  # `init -backend=false` is what `validate`/CI use — this root still
  # initializes with local state for that purpose, and that remains NOT
  # adequate for a real apply.
  backend "s3" {}
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
