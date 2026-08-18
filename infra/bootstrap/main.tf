/**
 * Cinefield Terraform remote-state backend (Phase 18-A).
 *
 * ONE bucket, ONE lock table, shared across every environment root — each
 * environment gets its own STATE KEY inside the bucket (see each
 * environment's own backend.hcl.example), never its own bucket. A second
 * bucket
 * per environment would just be a second thing to secure identically to the
 * first for no isolation benefit: the bucket already denies all public
 * access and every environment's state is already scoped by key/path, and
 * IAM (not bucket count) is what should gate who can read staging state vs
 * production state.
 *
 * CODE_COMPLETE, LIVE_EXTERNAL_REQUIRED. This root is written to be
 * `validate`-clean (verified: see infra/README.md) but has never been
 * applied — creating it for real is a live AWS account action requiring
 * credentials this repository does not have and a decision about which
 * account, which nobody has made yet.
 */

resource "aws_s3_bucket" "state" {
  bucket = "${var.name_prefix}-${var.region}"

  # Losing this bucket loses every environment's understanding of what it
  # manages — Terraform would try to recreate everything from scratch
  # against infrastructure that already exists. That is a categorically
  # different risk than losing an application queue, which is why this is
  # one of the few resources in this repository that gets prevent_destroy.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    # A corrupted or bad apply overwrites the state object; versioning is
    # the only way back from that short of hand-editing history.
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket = aws_s3_bucket.state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Every environment's state object carries account ids, and production's
# carries the IAM role/queue ARNs `docs/security/least-privilege.md`
# documents. Loss here is an operational headache; disclosure is worse.
resource "aws_s3_bucket_policy" "deny_insecure_transport" {
  bucket = aws_s3_bucket.state.id
  policy = data.aws_iam_policy_document.deny_insecure_transport.json
}

data "aws_iam_policy_document" "deny_insecure_transport" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"
    principals {
      type        = "AWS"
      identifiers = ["*"]
    }
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_dynamodb_table" "lock" {
  name         = "${var.name_prefix}-lock"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  # A lost lock table means two applies can race each other against the
  # same state object — the exact failure mode remote state locking exists
  # to prevent. Same catastrophic-loss reasoning as the bucket above.
  lifecycle {
    prevent_destroy = true
  }
}
