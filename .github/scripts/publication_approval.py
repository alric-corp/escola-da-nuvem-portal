"""Vínculo da publicação à aprovação externa; nunca recebe um booleano para dispensá-la.

O evento original do runner decide manual/automático e main/baseline. Outputs do gate são
reconferidos contra esse evento. A última guarda examina os mesmos bytes em memória enviados ao S3.
"""
import json
import re
from pathlib import Path

from frontend_release import (RELEASE_ID_RE, SHA_RE, ReleaseError, baseline_problems,
                              load_release_dir, manifest_problems, sha256_hex, validate_release)

SHA256_RE = re.compile(r"[0-9a-f]{64}")


def input_problems(env, operation, source):
    if env.get("GITHUB_EVENT_NAME") != "workflow_dispatch":
        return []
    required = source == "main" and operation in ("publish", "deploy")
    problems = []
    for name, pattern in (("APPROVED_RELEASE_ID", RELEASE_ID_RE), ("APPROVED_MANIFEST_SHA256", SHA256_RE)):
        if (required or env.get(name)) and not pattern.fullmatch(env.get(name, "")):
            problems.append(f"{name.lower()} obrigatório e no formato completo esperado.")
    return problems


def load_event(env):
    try:
        event = json.loads(Path(env["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
    except (KeyError, OSError, ValueError):
        raise ReleaseError("Evento original do GitHub ausente ou ilegível; publicação recusada.") from None
    if not isinstance(event, dict):
        raise ReleaseError("Evento original do GitHub inválido.")
    return event


def publication_context(env, event):
    # Importação tardia: release_gate reutiliza input_problems no gate sem criar ciclo.
    from release_gate import run_parameters

    if env.get("GITHUB_EVENT_NAME") == "workflow_dispatch":
        inputs = event.get("inputs") if isinstance(event, dict) else None
        if not isinstance(inputs, dict):
            raise ReleaseError("Inputs do evento workflow_dispatch ausentes.")
        actual = dict(env)
        for key in ("operation", "source", "expected_main_sha", "approved_release_id", "approved_manifest_sha256"):
            value = inputs.get(key, "")
            if not isinstance(value, str):
                raise ReleaseError(f"Input {key} não é texto.")
            if env.get(key.upper(), "") != value:
                raise ReleaseError(f"{key} diverge do evento original do GitHub.")
            actual[key.upper()] = value
        operation, source, expected = actual["OPERATION"], actual["SOURCE"], actual["EXPECTED_MAIN_SHA"]
        problems = input_problems(actual, operation, source)
    elif env.get("GITHUB_EVENT_NAME") == "workflow_run":
        (operation, source, expected), problems = run_parameters(env, event)
        # Inputs manuais não escolhem o caminho automático, mesmo se injetados no payload/env.
        for key, value in (("OPERATION", operation), ("SOURCE", source), ("EXPECTED_MAIN_SHA", expected)):
            if env.get(key) != value:
                problems.append(f"{key} diverge do CI que originou o workflow_run.")
    else:
        raise ReleaseError("Evento não autorizado para publicação.")
    if operation not in ("prepare", "publish", "deploy") or source not in ("main", "baseline"):
        problems.append("Operação/origem não constrói uma release autorizada.")
    if not SHA_RE.fullmatch(expected) or expected != env.get("GITHUB_SHA") or env.get("GITHUB_REF") != "refs/heads/main":
        problems.append("Source SHA: expected_main_sha/GITHUB_SHA/main precisam coincidir integralmente.")
    if problems:
        raise ReleaseError(" | ".join(problems))
    return operation, source, expected


def approve_snapshot(manifest, assets, pointer, manifest_bytes, *, env, event, built_release_id, baseline):
    """Recusa antes do primeiro PutObject; hash dos bytes, sem recanonicalizar a aprovação."""
    operation, source, expected = publication_context(env, event)
    problems = manifest_problems(manifest)  # recalcula release_id/content_digest
    if not RELEASE_ID_RE.fullmatch(built_release_id) or manifest.get("release_id") != built_release_id:
        problems.append("Release ID diverge do identificador produzido pela construção.")
    if source == "main":
        if manifest.get("mode") != "modern":
            problems.append("source=main exige mode=modern.")
        if manifest.get("source_sha") != expected:
            problems.append("Source SHA do manifesto diverge do SHA completo autorizado.")
    else:
        problems += baseline_problems(manifest, assets, pointer, baseline)
    if env.get("GITHUB_EVENT_NAME") == "workflow_dispatch" and source == "main" and operation in ("publish", "deploy"):
        if manifest.get("release_id") != env.get("APPROVED_RELEASE_ID"):
            problems.append("Release ID diverge de approved_release_id.")
        if sha256_hex(manifest_bytes) != env.get("APPROVED_MANIFEST_SHA256"):
            problems.append("SHA-256 dos bytes de manifest.json diverge de approved_manifest_sha256.")
    if problems:
        raise ReleaseError("Aprovação da publicação recusada: " + " | ".join(problems))


def check_package(release_dir, *, env, built_release_id, baseline):
    """Build e pré-OIDC: valida conteúdo, imports e configuração, depois a aprovação externa."""
    validate_release(release_dir, public_origin=env.get("PUBLIC_ORIGIN"), baseline=baseline)
    raw = (release_dir / "manifest.json").read_bytes()
    manifest, assets, pointer = load_release_dir(release_dir, manifest_bytes=raw)
    approve_snapshot(manifest, assets, pointer, raw, env=env, event=load_event(env),
                     built_release_id=built_release_id, baseline=baseline)
    return manifest


def authorize_write(manifest, assets, pointer, manifest_bytes, *, env, event, built_release_id, baseline):
    """O publicador nunca aceita prepare/verify como dispensa da aprovação manual."""
    if publication_context(env, event)[0] not in ("publish", "deploy"):
        raise ReleaseError("Operação não autoriza escrita de publicação.")
    approve_snapshot(manifest, assets, pointer, manifest_bytes, env=env, event=event,
                     built_release_id=built_release_id, baseline=baseline)
