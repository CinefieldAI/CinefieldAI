output "bucket_name" {
  description = "Feed this into each environment's backend.hcl as `bucket`."
  value       = aws_s3_bucket.state.id
}

output "dynamodb_table_name" {
  description = "Feed this into each environment's backend.hcl as `dynamodb_table`."
  value       = aws_dynamodb_table.lock.name
}

output "region" {
  value = var.region
}
