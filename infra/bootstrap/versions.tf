terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }

  # LOCAL STATE, DELIBERATELY. This root creates the remote-state backend
  # (S3 bucket + DynamoDB lock table) every other environment root will
  # point at — it cannot depend on a backend it is the one creating. Every
  # Terraform bootstrap of this shape has this same chicken-and-egg root;
  # its own state stays local, applied once, by hand, by someone with real
  # AWS credentials, then left alone.
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      "cinefield:environment" = "bootstrap"
      "cinefield:managed-by"  = "terraform"
      "cinefield:phase"       = "18-A"
    }
  }
}
