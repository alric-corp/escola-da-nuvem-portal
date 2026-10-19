"""Publica uma release preparada em releases/<id>/ com If-None-Match. Nunca sobrescreve nem apaga.

Repetir a publicação reconhece objetos idênticos; conteúdo diferente na mesma chave é conflito e falha.
O manifesto vai por último: uma publicação interrompida não deixa release ativável.
Antes do primeiro objeto, o HEAD atual da main é revalidado no GitHub (main_head_guard).
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from frontend_release import ReleaseError, publish_release  # noqa: E402
from release_cli import aws_clients, fail, main_head_guard, set_outputs, summary  # noqa: E402


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--release-dir", type=Path, required=True)
    parser.add_argument("--region", required=True)
    args = parser.parse_args(argv)
    s3, _, _ = aws_clients(args.region)
    result = publish_release(s3, args.bucket, args.release_dir, before_write=main_head_guard())
    set_outputs(**{"release-id": result["release_id"]})
    summary([f"### Release `{result['release_id']}` publicada (não ativada)",
             f"- objetos criados: {result['created']}; já idênticos: {result['identical']}"])


if __name__ == "__main__":
    try:
        main()
    except ReleaseError as err:
        fail(str(err))
