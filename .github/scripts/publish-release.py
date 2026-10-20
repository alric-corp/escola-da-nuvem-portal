"""Publica uma release preparada em releases/<id>/ com If-None-Match. Nunca sobrescreve nem apaga.

Repetir a publicação reconhece objetos idênticos; conteúdo diferente na mesma chave é conflito e falha.
O manifesto vai por último: uma publicação interrompida não deixa release ativável.
Antes do primeiro objeto, o HEAD atual da main é revalidado no GitHub (main_head_guard).
"""
import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from frontend_release import ReleaseError, publish_release  # noqa: E402
from release_cli import aws_clients, fail, load_baseline, main_head_guard, set_outputs, summary  # noqa: E402
from publication_approval import authorize_write, check_package, load_event  # noqa: E402


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--release-dir", type=Path, required=True)
    parser.add_argument("--region", required=True)
    args = parser.parse_args(argv)
    env = dict(os.environ)
    baseline = load_baseline()
    built_id = env.get("BUILT_RELEASE_ID", "")
    check_package(args.release_dir, env=env, built_release_id=built_id, baseline=baseline)

    def approve(manifest, assets, pointer, raw):
        authorize_write(manifest, assets, pointer, raw, env=env, event=load_event(env),
                         built_release_id=built_id, baseline=baseline)

    s3, _, _ = aws_clients(args.region)
    result = publish_release(s3, args.bucket, args.release_dir, before_write=main_head_guard(), approve=approve)
    set_outputs(**{"release-id": result["release_id"]})
    summary([f"### Release `{result['release_id']}` publicada (não ativada)",
             f"- objetos criados: {result['created']}; já idênticos: {result['identical']}"])


if __name__ == "__main__":
    try:
        main()
    except ReleaseError as err:
        fail(str(err))
