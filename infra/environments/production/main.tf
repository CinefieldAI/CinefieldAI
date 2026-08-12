/**
 * Cinefield production environment (Phase 6R.16) — NEVER APPLIED.
 *
 * The queues, ECS cluster and roles that exist in the account today were
 * created by hand (see docs/operations/AWS_PROVIDER_RUNTIME.md). Applying
 * this root as-is would attempt to CREATE them again and fail on name
 * conflicts. Adoption means importing the existing resources into state
 * first, resource by resource, verifying an empty plan, and only then
 * treating Terraform as the owner. That is a separate, deliberate change.
 *
 * MSK and Redis B are not provisioned at all and are gated off by default.
 */

locals {
  name_prefix = "cinefield-production"

  tags = {
    "cinefield:environment" = "production"
    "cinefield:phase"       = "6R"
  }
}

# ---------------------------------------------------------------------------
# Encryption ownership. Declares no keys — see the module header.
# ---------------------------------------------------------------------------

module "kms" {
  source = "../../modules/kms"

  queue_key_arn   = var.queue_kms_key_arn
  log_key_arn     = var.log_kms_key_arn
  msk_key_arn     = var.msk_kms_key_arn
  storage_key_arn = null

  # Production must have made a choice, not defaulted into one.
  require_customer_managed_keys = var.require_customer_managed_keys
}

# ---------------------------------------------------------------------------
# SQS. Names and timings come from src/lib/aws/sqs-topology.ts.
# ---------------------------------------------------------------------------

module "sqs" {
  source = "../../modules/sqs"

  # The topology already carries the cinefield- prefix; production adds none.
  name_prefix       = ""
  kms_master_key_id = module.kms.queue_key_arn
  tags              = local.tags
}

# ---------------------------------------------------------------------------
# Redis boundary. Creates nothing; enforces A/B isolation. Redis A is Redis
# Cloud, Redis B is unprovisioned — see the module header before changing.
# ---------------------------------------------------------------------------

module "redis" {
  source = "../../modules/redis"

  redis_a_provider = "redis_cloud"
  redis_a_endpoint = var.redis_a_endpoint

  redis_b_provider = var.redis_b_provider
  redis_b_endpoint = var.redis_b_endpoint
}

# ---------------------------------------------------------------------------
# MSK. Gated off: Kafka is external setup that has not happened.
# ---------------------------------------------------------------------------

module "msk" {
  source = "../../modules/msk"
  count  = var.enable_msk ? 1 : 0

  cluster_name              = "${local.name_prefix}-events"
  broker_count              = var.msk_broker_count
  broker_instance_type      = var.msk_broker_instance_type
  broker_ebs_volume_size_gb = var.msk_broker_ebs_volume_size_gb
  client_subnet_ids         = var.private_subnet_ids
  security_group_ids        = var.msk_security_group_ids
  kms_key_arn               = module.kms.msk_key_arn
  tags                      = local.tags
}

# ---------------------------------------------------------------------------
# IAM. Scoped to the exact queue ARNs the SQS module produced.
# ---------------------------------------------------------------------------

module "iam" {
  source = "../../modules/iam"

  name_prefix = local.name_prefix
  region      = var.region

  provider_worker_consume_queue_arns = [module.sqs.queue_arns["provider"]]
  provider_worker_produce_queue_arns = []

  temporal_worker_produce_queue_arns = [
    module.sqs.queue_arns["provider"],
    module.sqs.queue_arns["generation_control"],
  ]

  task_secret_arns  = var.task_secret_arns
  msk_cluster_arn   = var.enable_msk ? module.msk[0].cluster_arn : null
  queue_kms_key_arn = module.kms.queue_key_arn

  tags = local.tags
}

# ---------------------------------------------------------------------------
# ECS workers. The Next.js frontend stays on Vercel and is absent by design.
# ---------------------------------------------------------------------------

module "ecs" {
  source = "../../modules/ecs"

  cluster_name       = local.name_prefix
  region             = var.region
  private_subnet_ids = var.private_subnet_ids
  security_group_ids = var.worker_security_group_ids
  execution_role_arn = module.iam.execution_role_arn
  log_kms_key_arn    = module.kms.log_key_arn
  tags               = local.tags

  workers = {
    provider-worker = {
      image         = var.provider_worker_image
      cpu           = "512"
      memory        = "1024"
      desired_count = var.provider_worker_desired_count
      task_role_arn = module.iam.provider_worker_role_arn

      # Non-secret settings only. Anything sensitive goes in secret_arns —
      # the module's own validation rejects a secret-shaped key here.
      environment = {
        NODE_ENV                = "production"
        AWS_REGION              = var.region
        SQS_COMMAND_BUS_ENABLED = "true"
      }
      secret_arns          = var.provider_worker_secret_arns
      stop_timeout_seconds = 120
    }

    temporal-worker = {
      image         = var.temporal_worker_image
      cpu           = "512"
      memory        = "1024"
      desired_count = var.temporal_worker_desired_count
      task_role_arn = module.iam.temporal_worker_role_arn

      environment = {
        NODE_ENV                = "production"
        AWS_REGION              = var.region
        SQS_COMMAND_BUS_ENABLED = "true"
      }
      secret_arns          = var.temporal_worker_secret_arns
      stop_timeout_seconds = 120
    }
  }
}
