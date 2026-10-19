"""Valida uma release preparada, sem AWS: manifesto, MIME, imports, caminhos, ponteiro, config e dados sensíveis.

Opcionalmente compara com o que está publicado hoje (HTTPS público, sem credencial):
  --check-live  moderna: config igual à da versão no ar, isto é, a da release ativa moderna ou /config.json
                (legado e baseline); mudança só com --allow-config-change;
                baseline: os 30 arquivos servidos na raiz iguais aos fixados em baseline.json.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from frontend_release import (ReleaseError, live_equivalence_problems, load_release_dir,  # noqa: E402
                              published_config, validate_release)
from release_cli import BASELINE, fail, http_fetch, load_baseline, summary  # noqa: E402


def main(argv=None, fetch=http_fetch):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-dir", type=Path, required=True)
    parser.add_argument("--public-origin", default="")
    parser.add_argument("--baseline", type=Path, default=BASELINE)
    parser.add_argument("--check-live", action="store_true")
    parser.add_argument("--allow-config-change", action="store_true")
    args = parser.parse_args(argv)
    baseline = load_baseline(args.baseline)
    manifest, _, _ = load_release_dir(args.release_dir)
    live_config, live_path = None, None
    if args.check_live and manifest["mode"] == "modern":
        live_config, live_path = published_config(fetch, args.public_origin)
    if args.check_live and manifest["mode"] == "baseline":
        problems = live_equivalence_problems(baseline, fetch, args.public_origin)
        if problems:
            raise ReleaseError("Baseline não equivale ao publicado: " + " | ".join(problems))
    manifest = validate_release(args.release_dir, public_origin=args.public_origin or None,
                                baseline=baseline if manifest["mode"] == "baseline" else None,
                                live_config=live_config, allow_config_change=args.allow_config_change)
    summary([f"### Release `{manifest['release_id']}` válida",
             f"- imports relativos e dentro da release; MIME e cache conferidos; nenhum dado sensível",
             f"- equivalência com o publicado: {'conferida' if args.check_live else 'não pedida'}"
             + (f" (config comparada com {live_path})" if live_path else "")])
    return manifest


if __name__ == "__main__":
    try:
        main()
    except ReleaseError as err:
        fail(str(err))
