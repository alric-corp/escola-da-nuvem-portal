resource "aws_s3_bucket" "portal" {
  bucket        = "${local.suffix}-web"
  force_destroy = false
}

resource "aws_s3_bucket" "imports" {
  bucket        = "${local.suffix}-imports"
  force_destroy = false
  lifecycle {
    prevent_destroy = true
  }
}

locals {
  buckets = {
    portal  = aws_s3_bucket.portal.id
    imports = aws_s3_bucket.imports.id
  }
}

resource "aws_s3_bucket_public_access_block" "private" {
  for_each                = local.buckets
  bucket                  = each.value
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "private" {
  for_each = local.buckets
  bucket   = each.value
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "private" {
  for_each = local.buckets
  bucket   = each.value
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "private" {
  for_each = local.buckets
  bucket   = each.value
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_policy" "imports" {
  bucket = aws_s3_bucket.imports.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport", Effect = "Deny", Principal = "*", Action = "s3:*"
      Resource  = [aws_s3_bucket.imports.arn, "${aws_s3_bucket.imports.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}

resource "aws_dynamodb_table" "portal" {
  name                        = local.name
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "PK"
  range_key                   = "SK"
  deletion_protection_enabled = true
  attribute {
    name = "PK"
    type = "S"
  }
  attribute {
    name = "SK"
    type = "S"
  }
  point_in_time_recovery {
    enabled = true
  }
  server_side_encryption {
    enabled = true
  }
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_dynamodb_table_item" "initial_cohort" {
  table_name = aws_dynamodb_table.portal.name
  hash_key   = aws_dynamodb_table.portal.hash_key
  range_key  = aws_dynamodb_table.portal.range_key
  item = jsonencode({
    PK         = { S = "COHORT#${var.initial_cohort}" }
    SK         = { S = "METADATA" }
    cohortCode = { S = var.initial_cohort }
    entityType = { S = "cohort" }
    status     = { S = "active" }
  })
  lifecycle {
    # Após o cadastro inicial, o conteúdo pertence à aplicação.
    ignore_changes  = [item]
    prevent_destroy = true
  }
}
