output "experiment_template_ids" {
  value       = { for k, v in aws_fis_experiment_template.this : k => v.id }
  description = "FIS experiment template ids by scenario key. Ids only — no target/role material."
}
