variable "environment" {
  type = string
  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "environment must be one of dev, staging, production."
  }
}

# The role AWS FIS assumes to run an experiment. Deliberately a variable, not
# created here: scoping it to exactly the actions/resources this module's own
# experiments need is a separate, reviewed IAM decision (infra/modules/iam/),
# never a "let FIS do whatever it wants" role.
variable "fis_role_arn" {
  type = string
  validation {
    condition     = can(regex("^arn:aws[a-z-]*:iam::[0-9]{12}:role/", var.fis_role_arn))
    error_message = "fis_role_arn must be a real IAM role ARN, never a placeholder or wildcard."
  }
}

# One entry per Phase 26-A catalogued scenario that has a real AWS-side fault
# to inject (a subset of src/lib/chaos/game-day-catalogue.ts — not every
# scenario there has an AWS FIS action; process-crash/connection-pressure
# scenarios are exercised locally, not via FIS). Every experiment MUST name
# at least one stop condition (enforced by the validation block below, not
# merely documented) and every target MUST be an explicit resource ARN or an
# explicit resource-tag selector — never account-wide, never a wildcard.
variable "experiments" {
  type = map(object({
    description = string
    action_id   = string
    # FIS target resource type, e.g. "aws:ec2:instance". Selection is by
    # explicit resource ARNs only in this module — no tag-based, account-wide
    # selection is supported, so a misconfigured experiment cannot silently
    # widen its own blast radius.
    target_resource_type = string
    target_resource_arns = list(string)
    # CloudWatch alarm ARNs. FIS halts the experiment the instant any of
    # these alarms goes into ALARM state.
    stop_condition_alarm_arns = list(string)
  }))
  default = {}

  validation {
    condition = alltrue([
      for k, v in var.experiments : length(v.stop_condition_alarm_arns) > 0
    ])
    error_message = "every experiment must declare at least one stop-condition CloudWatch alarm ARN."
  }

  validation {
    condition = alltrue([
      for k, v in var.experiments : length(v.target_resource_arns) > 0
    ])
    error_message = "every experiment must target at least one explicit resource ARN."
  }

  validation {
    condition = alltrue(flatten([
      for k, v in var.experiments : [
        for arn in v.target_resource_arns : arn != "*" && !can(regex("\\*", arn))
      ]
    ]))
    error_message = "no experiment target ARN may contain a wildcard."
  }
}
