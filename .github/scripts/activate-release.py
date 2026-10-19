"""Ativa uma release já publicada: valida, grava o index.html com If-Match, invalida / e /index.html e faz o smoke."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from release_cli import run_activation  # noqa: E402

if __name__ == "__main__":
    run_activation("activate")
