/**
 * Cinefield MSK / Kafka event backbone (Phase 6R.16).
 *
 * NOT PROVISIONED. Kafka is external setup that has not happened (Phase
 * 6R.9 is foundation-only), so this module declares the shape and refuses to
 * guess the parts that depend on a real VPC and a real load profile.
 *
 * SIZING IS NOT DEFAULTED
 * Broker count, instance type, storage and placement have no defaults worth
 * having: a conservative-looking default is how a cluster gets provisioned at
 * the wrong size and then never revisited, and an MSK cluster is expensive
 * and slow to resize. Subnets, security groups and instance type are required
 * inputs. The one default supplied is the Kafka version, because a pinned
 * version is safer than an implicit one.
 *
 * AUTHENTICATION MIRRORS THE APPLICATION'S OPEN DECISION
 * src/lib/kafka/kafka-config.ts deliberately defines no SASL/TLS fields
 * because Cinefield has not selected an event-bus auth architecture. This
 * module takes the same position: IAM auth is the default here because it is
 * the only mechanism that needs no credential material at all, and anything
 * else must be chosen explicitly rather than inherited from a template.
 */

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

resource "aws_msk_cluster" "this" {
  cluster_name           = var.cluster_name
  kafka_version          = var.kafka_version
  number_of_broker_nodes = var.broker_count

  broker_node_group_info {
    instance_type   = var.broker_instance_type
    client_subnets  = var.client_subnet_ids
    security_groups = var.security_group_ids

    storage_info {
      ebs_storage_info {
        volume_size = var.broker_ebs_volume_size_gb
      }
    }
  }

  client_authentication {
    # No credential material anywhere: brokers authenticate the ECS task role.
    sasl {
      iam = var.iam_authentication_enabled
    }
    # Unauthenticated access is never enabled, in any environment.
    unauthenticated = false
  }

  encryption_info {
    # Null means the AWS-managed MSK key. A customer-managed key is supplied
    # by the KMS module when encryption ownership is decided.
    encryption_at_rest_kms_key_arn = var.kms_key_arn

    encryption_in_transit {
      client_broker = "TLS"
      in_cluster    = true
    }
  }

  logging_info {
    broker_logs {
      cloudwatch_logs {
        enabled   = var.cloudwatch_log_group != null
        log_group = var.cloudwatch_log_group
      }
    }
  }

  tags = merge(var.tags, { "cinefield:role" = "event-backbone" })
}
