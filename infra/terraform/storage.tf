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

# Anexos do feedback (imagens): privado, só a API (identity) lê e grava, pelos prefixos tmp/ e
# feedback/. O navegador envia direto por presigned POST (CORS só POST, só das origens do portal).
resource "aws_s3_bucket" "feedback" {
  bucket        = "${local.suffix}-feedback"
  force_destroy = false
  lifecycle {
    prevent_destroy = true
  }
}

locals {
  buckets = {
    portal   = aws_s3_bucket.portal.id
    imports  = aws_s3_bucket.imports.id
    feedback = aws_s3_bucket.feedback.id
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

# Retenção (todo/13): a prévia marca seus arquivos com portal-status=draft e a publicação
# troca para published (backend/portal.py). Arquivos sem tag (anteriores a esta regra) não
# são afetados. Com versionamento, a expiração cria um marcador de exclusão; a versão antiga
# do rascunho some no dia seguinte, e a de qualquer outro arquivo em 90 dias.
resource "aws_s3_bucket_lifecycle_configuration" "imports" {
  bucket     = aws_s3_bucket.imports.id
  depends_on = [aws_s3_bucket_versioning.private]
  rule {
    id     = "rascunhos-nao-publicados"
    status = "Enabled"
    filter {
      tag {
        key   = "portal-status"
        value = "draft"
      }
    }
    expiration {
      days = 30
    }
    noncurrent_version_expiration {
      noncurrent_days = 1
    }
  }
  rule {
    id     = "versoes-antigas"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
    expiration {
      expired_object_delete_marker = true
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
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

# Uploads não concluídos (tmp/) somem em 1 dia, junto com as versões antigas. Imagens aceitas
# (feedback/) não expiram; só versões antigas, em 90 dias.
resource "aws_s3_bucket_lifecycle_configuration" "feedback" {
  bucket     = aws_s3_bucket.feedback.id
  depends_on = [aws_s3_bucket_versioning.private]
  rule {
    id     = "temporarios"
    status = "Enabled"
    filter {
      prefix = "tmp/"
    }
    expiration {
      days = 1
    }
    noncurrent_version_expiration {
      noncurrent_days = 1
    }
  }
  rule {
    id     = "versoes-antigas-de-anexos"
    status = "Enabled"
    filter {
      prefix = "feedback/"
    }
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
  rule {
    id     = "marcadores-e-multipart"
    status = "Enabled"
    filter {}
    expiration {
      expired_object_delete_marker = true
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "feedback" {
  bucket = aws_s3_bucket.feedback.id
  cors_rule {
    allowed_methods = ["POST"]
    allowed_origins = local.allowed_origins
    allowed_headers = ["*"]
    max_age_seconds = 300
  }
}

resource "aws_s3_bucket_policy" "feedback" {
  bucket = aws_s3_bucket.feedback.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport", Effect = "Deny", Principal = "*", Action = "s3:*"
      Resource  = [aws_s3_bucket.feedback.arn, "${aws_s3_bucket.feedback.arn}/*"]
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
  # Prévias (DRAFT#) não publicadas expiram; a publicação regrava o item sem esse atributo.
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
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
