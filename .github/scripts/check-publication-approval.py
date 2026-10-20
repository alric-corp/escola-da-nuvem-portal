"""Valida o pacote e o vínculo aprovado no build e depois do download, antes do OIDC."""
import argparse
import os
from pathlib import Path

from frontend_release import ReleaseError
from publication_approval import check_package
from release_cli import fail, load_baseline, summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-dir", type=Path, required=True)
    args = parser.parse_args(argv)
    manifest = check_package(args.release_dir, env=dict(os.environ),
                             built_release_id=os.environ.get("BUILT_RELEASE_ID", ""), baseline=load_baseline())
    summary([f"### Contrato de publicação conferido: `{manifest['release_id']}`",
             "- evento original, source SHA, mode, release ID e bytes do manifesto conferidos; sem AWS"])


if __name__ == "__main__":
    try:
        main()
    except (ReleaseError, OSError, ValueError) as err:
        fail(str(err))
