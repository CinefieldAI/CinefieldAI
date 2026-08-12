/**
 * Cinefield Redis boundary — INTERFACE ONLY, CREATES NOTHING (Phase 6R.16).
 *
 * READ THIS BEFORE ADDING A RESOURCE HERE.
 *
 * Cinefield runs TWO logically separate Redis responsibilities and they must
 * never be merged:
 *
 *   Redis A — application state. Provider health, rate limits, idempotency
 *             records, model/pricing caches, distributed locks. Small values,
 *             latency-sensitive, TTL-bounded.
 *   Redis B — BullMQ queue state. Job payloads, retry bookkeeping. Different
 *             access pattern, different failure blast radius, and BullMQ's
 *             own guidance is a dedicated instance. A BullMQ backlog must
 *             never be able to evict Cinefield's rate-limit or lock keys.
 *
 * WHY THERE IS NO aws_elasticache_replication_group IN THIS FILE
 * Redis A is **Redis Cloud**, not ElastiCache. Modelling it as an AWS
 * resource would be a lie written in executable form: the next reader
 * believes Terraform owns the instance, and either builds a second one or
 * plans a destructive change against something this state file has never
 * managed. Redis B is not provisioned at all, and no provider has been
 * chosen for it.
 *
 * So this module declares the CONTRACT — two distinct responsibilities, two
 * distinct endpoints, explicitly labelled with who actually owns each — and
 * creates no infrastructure. When the provider decision is made, an
 * implementation goes behind this interface and the module's outputs do not
 * change shape.
 *
 * The one invariant it does enforce is the one that actually matters: A and B
 * must not be the same instance.
 */

terraform {
  required_version = ">= 1.6.0"
}

locals {
  # Normalized so the equality check below cannot be defeated by a trailing
  # slash or a case difference in the host.
  normalized_a = lower(trimsuffix(trimspace(var.redis_a_endpoint), "/"))
  normalized_b = lower(trimsuffix(trimspace(var.redis_b_endpoint), "/"))

  a_is_managed_here = var.redis_a_provider == "aws_elasticache"
  b_is_managed_here = var.redis_b_provider == "aws_elasticache"
}

# The isolation invariant, enforced at plan time rather than trusted.
# `precondition` fires during plan, so a merged configuration cannot even
# produce a plan, let alone be applied.
resource "terraform_data" "redis_isolation_guard" {
  input = {
    a_provider = var.redis_a_provider
    b_provider = var.redis_b_provider
  }

  lifecycle {
    precondition {
      condition     = local.normalized_a != local.normalized_b
      error_message = "Redis A (application state) and Redis B (BullMQ) must be separate instances. Sharing one lets a BullMQ backlog evict rate-limit, lock and idempotency keys."
    }

    precondition {
      condition     = !local.a_is_managed_here && !local.b_is_managed_here
      error_message = "This module creates no infrastructure. Set a provider to aws_elasticache only together with an implementation added behind this interface — otherwise the state file claims to own an instance it does not."
    }
  }
}
