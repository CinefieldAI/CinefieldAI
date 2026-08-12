/**
 * Cinefield dev environment (Phase 6R.16) — NEVER APPLIED.
 *
 * Intentionally the smaller root: queues, the Redis boundary declaration and
 * the IAM shape, with no ECS services and no MSK. A dev environment that
 * mirrors production exactly costs production money for no extra confidence;
 * what it must mirror is the CONTRACT — the same queue topology and the same
 * least-privilege boundaries — which is what this root exercises.
 *
 * Every queue is prefixed so a dev apply can never collide with, or be
 * mistaken for, the production queues the workers actually read.
 */

locals {
  name_prefix = "cinefield-dev"

  tags = {
    "cinefield:environment" = "dev"
    "cinefield:phase"       = "6R"
  }
}

module "kms" {
  source = "../../modules/kms"
  # Dev deliberately uses AWS-managed keys: still encrypted, and it keeps a
  # customer-managed key's destruction risk out of a throwaway environment.
  require_customer_managed_keys = false
}

module "sqs" {
  source = "../../modules/sqs"

  name_prefix       = "dev-"
  kms_master_key_id = module.kms.queue_key_arn
  tags              = local.tags
}

module "redis" {
  source = "../../modules/redis"

  redis_a_provider = var.redis_a_provider
  redis_a_endpoint = var.redis_a_endpoint
  redis_b_provider = var.redis_b_provider
  redis_b_endpoint = var.redis_b_endpoint
}

module "iam" {
  source = "../../modules/iam"

  name_prefix = local.name_prefix
  region      = var.region

  provider_worker_consume_queue_arns = [module.sqs.queue_arns["provider"]]
  temporal_worker_produce_queue_arns = [
    module.sqs.queue_arns["provider"],
    module.sqs.queue_arns["generation_control"],
  ]

  # No MSK in dev, so no Kafka permission is granted at all.
  msk_cluster_arn = null
  tags            = local.tags
}
