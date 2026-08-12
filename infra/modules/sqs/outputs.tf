output "queue_urls" {
  description = "Queue URLs by logical key. A URL identifies; it does not authenticate — IAM does — so this is safe to surface."
  value       = { for k, q in aws_sqs_queue.main : k => q.url }
}

output "queue_arns" {
  description = "Primary queue ARNs by logical key. Consumed by the IAM module to scope worker permissions to exactly these queues."
  value       = { for k, q in aws_sqs_queue.main : k => q.arn }
}

output "dlq_arns" {
  description = "Dead-letter queue ARNs by logical key."
  value       = { for k, q in aws_sqs_queue.dlq : k => q.arn }
}

output "all_arns" {
  description = "Every queue ARN, primary and DLQ. Convenience for KMS grants and CloudWatch alarms."
  value       = concat([for q in aws_sqs_queue.main : q.arn], [for q in aws_sqs_queue.dlq : q.arn])
}
