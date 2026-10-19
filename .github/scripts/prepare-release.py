"""Prepara uma release imutável do frontend, sem AWS.

  --source main      empacota o commit do checkout (HEAD), com config por release vinda de FRONTEND_CONFIG_JSON
  --source baseline  empacota o SHA fixado em .github/release/baseline.json (lê /config.json da raiz)

Nenhuma entrada escolhe commit: a baseline é constante revisada em PR. O builder usado é sempre o
scripts/build_frontend.py do próprio commit empacotado.
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from frontend_release import (ReleaseError, SHA_RE, build_release, canonical_config_bytes,  # noqa: E402
                              validate_config, write_release)
from release_cli import Git, fail, load_baseline, set_outputs, summary  # noqa: E402


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", choices=("main", "baseline"), required=True)
    parser.add_argument("--repo", type=Path, required=True, help="Checkout do pipeline (main)")
    parser.add_argument("--work", type=Path, required=True, help="Diretório temporário, ainda inexistente")
    parser.add_argument("--out", type=Path, required=True, help="Diretório das releases preparadas")
    parser.add_argument("--public-origin", default="", help="https://<domínio> (obrigatório em main)")
    args = parser.parse_args(argv)
    repo, work = args.repo.resolve(), args.work.resolve()
    work.mkdir(parents=True, exist_ok=False)
    baseline = load_baseline(repo / ".github" / "release" / "baseline.json")
    git = Git(repo)

    if args.source == "main":
        source_sha = git._git("rev-parse", "HEAD").stdout.strip()
        if os.environ.get("GITHUB_SHA") and os.environ["GITHUB_SHA"] != source_sha:
            fail("O checkout não está no commit desta execução.")
        app, mode = repo, "modern"
        config = validate_config(json.loads(os.environ.get("FRONTEND_CONFIG_JSON") or "null"), args.public_origin)
        config_file = work / "frontend-config.json"
        config_file.write_bytes(canonical_config_bytes(config))
        builder_args = ["--config", str(config_file)]
    else:
        source_sha = baseline["source_sha"]
        if not git.on_first_parent(source_sha):
            fail("A baseline fixada não está na first-parent da main.")
        app, mode = work / "app", "baseline"
        git.archive(source_sha, app)
        builder_args = []
    if not SHA_RE.fullmatch(source_sha):
        fail("SHA da versão inválido.")

    builder = app / "scripts" / "build_frontend.py"
    subprocess.run([sys.executable, "-B", str(builder), *builder_args], check=True, stdout=subprocess.DEVNULL)
    dist = app / "frontend" / "dist"
    if mode == "modern" and (dist / "config.json").read_bytes() != config_file.read_bytes():
        fail("O builder gravou uma config diferente da validada.")
    routes_file = work / "api-routes.json"
    subprocess.run(["node", str(repo / ".github" / "scripts" / "release-api-routes.mjs"), "--api", str(dist / "api.js"),
                    "--source-openapi", str(app / "openapi" / "portal.yaml"),
                    "--contract-openapi", str(repo / "openapi" / "portal.yaml"), "--out", str(routes_file)], check=True)
    api = json.loads(routes_file.read_text(encoding="utf-8"))
    manifest, assets, pointer = build_release(mode, source_sha, dist, builder, api)
    release_dir = write_release(args.out.resolve(), manifest, assets, pointer)
    set_outputs(**{"release-id": manifest["release_id"], "release-dir": str(release_dir), "mode": mode})
    summary([f"### Release preparada: `{manifest['release_id']}`",
             f"- modo: {mode}; commit: `{source_sha}`",
             f"- arquivos: {len(manifest['files'])}; rotas da API: {len(manifest['api']['routes'])}",
             f"- config: {'por release' if mode == 'modern' else '/config.json da raiz (legado)'}"])


if __name__ == "__main__":
    try:
        main()
    except ReleaseError as err:
        fail(str(err))
    except subprocess.CalledProcessError as err:
        fail(f"Passo externo falhou ({err.cmd[0]}): código {err.returncode}.")
