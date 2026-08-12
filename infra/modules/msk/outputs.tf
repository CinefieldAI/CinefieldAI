output "cluster_arn" {
  description = "Cluster ARN. Consumed by the IAM module to scope kafka-cluster:* actions to this cluster only."
  value       = aws_msk_cluster.this.arn
}

output "bootstrap_brokers_sasl_iam" {
  description = <<-EOT
    IAM-authenticated bootstrap broker list — the value KAFKA_BROKERS takes.

    Marked sensitive not because a broker address is a credential (it is not;
    IAM authenticates) but because kafka-config.ts deliberately never logs or
    returns broker addresses, and a Terraform output printed into CI logs
    would undo that discipline for no benefit.
  EOT
  value       = aws_msk_cluster.this.bootstrap_brokers_sasl_iam
  sensitive   = true
}

output "zookeeper_connect_string" {
  description = "Zookeeper endpoints. Sensitive for the same reason as the broker list."
  value       = aws_msk_cluster.this.zookeeper_connect_string
  sensitive   = true
}
