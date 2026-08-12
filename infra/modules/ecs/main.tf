/**
 * Cinefield ECS Fargate workers (Phase 6R.16).
 *
 * SCOPE: only work that genuinely needs a long-running process.
 *   provider-worker   the SQS receive loop (worker/provider-worker.ts)
 *   temporal-worker   the Temporal workflow/activity worker
 *
 * THE NEXT.JS FRONTEND STAYS ON VERCEL. It is not modelled here and must not
 * be: moving it would be a platform migration, not an IaC detail, and having
 * a half-declared alternative sitting in this tree invites someone to try.
 *
 * NO SECRETS IN THE TASK DEFINITION. Container `environment` carries only
 * non-secret settings; everything else arrives through `secrets`, which
 * resolves a Secrets Manager / SSM ARN at task start. A value placed in
 * `environment` is visible in the task definition to anyone with
 * ecs:DescribeTaskDefinition, which is a much wider audience than the people
 * who may read the secret itself.
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

resource "aws_ecs_cluster" "this" {
  name = var.cluster_name

  setting {
    name  = "containerInsights"
    value = var.container_insights_enabled ? "enabled" : "disabled"
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "worker" {
  for_each = var.workers

  name              = "/ecs/${var.cluster_name}/${each.key}"
  retention_in_days = var.log_retention_days
  kms_key_id        = var.log_kms_key_arn

  tags = var.tags
}

resource "aws_ecs_task_definition" "worker" {
  for_each = var.workers

  family                   = "${var.cluster_name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = each.value.cpu
  memory                   = each.value.memory

  # Two roles, deliberately distinct: execution_role pulls the image and
  # writes logs (AWS's own plumbing); task_role is what the application code
  # itself may do. Collapsing them would hand the running container the
  # ability to read every secret the platform can pull.
  execution_role_arn = var.execution_role_arn
  task_role_arn      = each.value.task_role_arn

  container_definitions = jsonencode([
    {
      name      = each.key
      image     = each.value.image
      essential = true

      # Non-secret settings only.
      environment = [
        for k, v in each.value.environment : { name = k, value = v }
      ]

      # Secret ARNs, resolved at task start. No value is ever in this file.
      secrets = [
        for k, arn in each.value.secret_arns : { name = k, valueFrom = arn }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.worker[each.key].name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = each.key
        }
      }

      stopTimeout = each.value.stop_timeout_seconds
    }
  ])

  tags = var.tags
}

resource "aws_ecs_service" "worker" {
  for_each = var.workers

  name            = "${var.cluster_name}-${each.key}"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.worker[each.key].arn
  desired_count   = each.value.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets = var.private_subnet_ids
    # Private subnets with a NAT route. A worker that polls SQS and calls
    # providers needs egress, never ingress.
    security_groups  = var.security_group_ids
    assign_public_ip = false
  }

  # A worker holding a claimed attempt must be allowed to finish or to record
  # its evidence; ECS's own deployment circuit breaker prevents a bad revision
  # from rolling the whole service.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  tags = var.tags
}
