terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }

  # Empty, PARTIAL backend block (Phase 18-A). The actual bucket/table/key
  # come from environments/dev/backend.hcl at `init -backend-config=
  # backend.hcl` time, never hard-coded here — a committed bucket name in
  # this file would be one editable line away from a dev apply targeting
  # production's state key. `infra/bootstrap/` creates the bucket and lock
  # table this block eventually points at; until that bootstrap is applied
  # for real, `init -backend=false` (as this tree's own README already
  # documents) is what `validate`/CI use.
  backend "s3" {}
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      "cinefield:environment" = "dev"
      "cinefield:managed-by"  = "terraform"
    }
  }
}
