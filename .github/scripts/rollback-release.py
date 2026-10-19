"""Rollback para uma release anterior já publicada, pelo mesmo caminho da ativação, com proteções adicionais.

Exige manifesto íntegro, piso histórico (baseline.json), rotas da API contidas nas da release ativa e, quando os
contratos OpenAPI diferem, a confirmação explícita do release_id alvo. A inclusão de rotas é condição necessária,
não prova de compatibilidade de payloads, autenticação ou semântica: a revisão do environment continua obrigatória.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from release_cli import run_activation  # noqa: E402

if __name__ == "__main__":
    run_activation("rollback")
