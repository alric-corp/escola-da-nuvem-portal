#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TERRAFORM_DIR="$REPO_DIR/infra/terraform"
CONFIG_FILE="$(mktemp "${TMPDIR:-/tmp}/portal-config.XXXXXX.json")"

cleanup() {
  rm -f "$CONFIG_FILE"
}
trap cleanup EXIT

command -v terraform >/dev/null || { echo "Erro: terraform não encontrado." >&2; exit 1; }
command -v aws >/dev/null || { echo "Erro: aws CLI não encontrado." >&2; exit 1; }
command -v python3 >/dev/null || { echo "Erro: python3 não encontrado." >&2; exit 1; }

echo "Lendo os outputs do Terraform..."
WEB_BUCKET="$(terraform -chdir="$TERRAFORM_DIR" output -raw frontend_bucket)"
DISTRIBUTION_ID="$(terraform -chdir="$TERRAFORM_DIR" output -raw cloudfront_distribution_id)"

if [[ -z "$WEB_BUCKET" || -z "$DISTRIBUTION_ID" ]]; then
  echo "Erro: bucket ou distribuição não foram encontrados nos outputs do Terraform." >&2
  exit 1
fi

echo "Gerando o frontend..."
terraform -chdir="$TERRAFORM_DIR" output -json frontend_config > "$CONFIG_FILE"
python3 -B "$REPO_DIR/scripts/build_frontend.py" --config "$CONFIG_FILE"

echo "Publicando frontend/dist no bucket s3://$WEB_BUCKET/..."
aws s3 sync "$REPO_DIR/frontend/dist/" "s3://$WEB_BUCKET/" \
  --cache-control 'public,max-age=300'

echo "Solicitando invalidação do CloudFront ($DISTRIBUTION_ID)..."
INVALIDATION_ID="$(aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths '/*' \
  --query 'Invalidation.Id' \
  --output text)"

echo "Publicação concluída. Invalidação: $INVALIDATION_ID"
