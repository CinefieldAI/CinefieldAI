terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }

  # No backend, for the same reason as production: remote-state ownership is
  # an undecided, separately-reviewed bootstrap concern.
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
