"""Read projections in the existing table. Candidates never grant access.

No remote work on import: writers prepare candidates before their canonical CAS;
readers use explicit readiness markers, otherwise the documented legacy path.
"""
from datetime import datetime, timezone
import uuid

from integrity import email_hash
from repository import Conflict

STATE = "DERIVED_ACCESS"
DIRECTORY = "COHORT_DIRECTORY"


def discovery_ready(repo):
    return (repo.get(STATE, "DISCOVERY") or {}).get("ready") is True


def candidates(repo, email):
    return repo.list("DISCOVERY_EMAIL#" + email_hash(email), "COHORT#")


def directory_write(repo, code):
    sk = "COHORT#" + code
    return DIRECTORY, sk, {"code": code}, repo.get(DIRECTORY, sk)


def create_writes(repo, cohort):
    """The revision protects migration's final directory cutover against a new cohort."""
    revision = repo.get(STATE, "DIRECTORY_REVISION")
    return [directory_write(repo, cohort["code"]),
            (STATE, "DIRECTORY_REVISION", {"revision": uuid.uuid4().hex}, revision),
            ("COHORT#" + cohort["code"], "HISTORY_READY", {"ready": True, "version": 1, "count": 0}, None)]


def prepare_discovery(repo, code, snapshot):
    # A constant candidate per email/cohort is a superset, not a second editable
    # roster. An old email only finds a candidate and fails canonical validation.
    # Repeated/competing preparations write identical values, without a large txn.
    seen = set()
    for student in snapshot["students"]:
        token = email_hash(student.get("email"))
        if token and token not in seen:
            repo.put("DISCOVERY_EMAIL#" + token, "COHORT#" + code, {"code": code})
            seen.add(token)
    return len(seen)


def history_key(publication):
    instant = datetime.fromisoformat(publication["publishedAt"].replace("Z", "+00:00"))
    if instant.tzinfo is None:
        raise ValueError("publishedAt must include its timezone")
    at = instant.astimezone(timezone.utc).isoformat(timespec="microseconds")
    # Reverse byte order, including a terminal sentinel: a reverse Query keeps
    # ascending PUB IDs for ties, as the old stable sort over ascending PUB# SK.
    inverse = bytes(255 - b for b in publication["id"].encode("utf-8")) + b"\xff"
    return "RECENT#" + at + "#" + inverse.hex()


def history_write(repo, code, publication):
    pk, sk = "COHORT#" + code, history_key(publication)
    return pk, sk, {"id": publication["id"], "publishedAt": publication["publishedAt"]}, repo.get(pk, sk)


def publication_history_writes(repo, code, publication):
    write = history_write(repo, code, publication)
    writes = [write]
    marker = repo.get("COHORT#" + code, "HISTORY_READY")
    if marker and marker.get("ready") is True:
        count = marker["count"] + (1 if write[3] is None else 0)
        writes.append(("COHORT#" + code, "HISTORY_READY", {**marker, "count": count}, marker))
    return writes


def recent_publications(repo, pk, limit=12):
    marker = repo.get(pk, "HISTORY_READY") or {}
    if marker.get("ready") is not True:
        return sorted(repo.list(pk, "PUB#"), key=lambda p: p["publishedAt"], reverse=True)[:limit]
    if hasattr(repo, "recent_references"):
        refs = repo.recent_references(pk, limit)
    else:
        rows, _ = repo.page(pk, "RECENT#", limit)
        refs = [row for _, row in rows]
    # A canonical publish may commit after the marker read and before Query.
    # Extra valid references are newer knowledge, not corruption. Missing
    # references still contradict the count that was actually observed.
    if len(refs) < min(marker["count"], limit):
        raise Conflict("Incomplete chronological projection")
    result = []
    for ref in refs:
        publication = repo.get(pk, "PUB#" + ref["id"])
        if publication is None or history_key(publication) != history_key(ref):
            # A ready projection with a missing/changed canonical row is not an
            # empty history. Never silently rebuild it during a student request.
            raise Conflict("Historical projection requires reconciliation")
        result.append(publication)
    return result


def migrate_cohort(repo, cohort, *, apply=False, discovery=True, history=True):
    """Idempotent/resumable unit, guarded against publication/restore/settings races."""
    code, pk = cohort["code"], "COHORT#" + cohort["code"]
    publications = repo.list(pk, "PUB#") if history else []
    current = repo.get(pk, "PUB#" + cohort["current"]) if cohort.get("current") else None
    if cohort.get("current") and current is None:
        raise Conflict("Current publication missing")
    snapshot = repo.snapshot(current["snapshot"]) if discovery and current else {"students": []}
    result = {"code": code, "publications": len(publications),
              "candidates": len({s["email"] for s in snapshot["students"] if s.get("email")}),
              "sourcePublication": cohort.get("current"), "applied": apply}
    if not apply:
        return result
    if discovery:
        prepare_discovery(repo, code, snapshot)
    if history:
        for publication in publications:
            write = history_write(repo, code, publication)
            repo.transaction([write], checks=[(pk, "PUB#" + publication["id"], publication)])
        if set(repo.keys(pk, "RECENT#")) != {history_key(p) for p in publications}:
            raise Conflict("Chronological projection/source changed; reconcile again")
    writes = [directory_write(repo, code)]
    if discovery:
        prior = repo.get(pk, "DISCOVERY_READY")
        writes.append((pk, "DISCOVERY_READY", {"ready": True, "publication": cohort.get("current")}, prior))
    if history:
        prior = repo.get(pk, "HISTORY_READY")
        writes.append((pk, "HISTORY_READY", {"ready": True, "version": 1, "count": len(publications)}, prior))
    checks = [(pk, "METADATA", cohort)]
    if current is not None:
        checks.append((pk, "PUB#" + current["id"], current))
    repo.transaction(writes, checks=checks)
    return result


def migrate(repo, *, apply=False, discovery=True, history=True, cutover=False, codes=None):
    """Scan is confined to this administrative tool (or the explicit legacy reader).

    A fresh invocation reconciles changed sources; no local cursor can certify an
    old revision. Completed items need no deletion and a partial run is repeatable.
    """
    if cutover and (not discovery or codes is not None):
        raise ValueError("Discovery cutover requires reconciliation of every cohort")
    revision = repo.get(STATE, "DIRECTORY_REVISION")
    cohorts = repo.legacy_cohorts() if hasattr(repo, "legacy_cohorts") else repo.cohorts()
    selected = [c for c in cohorts if codes is None or c["code"] in codes]
    results = [migrate_cohort(repo, c, apply=apply, discovery=discovery, history=history) for c in selected]
    if cutover:
        if apply:
            # New writers update DIRECTORY_REVISION for every new cohort. They
            # already prepare all candidates before publication; races in existing
            # cohorts either fail their per-cohort CAS or leave a correct writer.
            expected = repo.get(STATE, "DISCOVERY")
            repo.transaction([(STATE, "DISCOVERY", {"ready": True, "version": 1}, expected)],
                             checks=[(STATE, "DIRECTORY_REVISION", revision)])
    return {"dryRun": not apply, "cutover": bool(cutover and apply), "cohorts": results}


def disable(repo, *, apply=False, discovery=True, history=True):
    """Explicit recovery to legacy readers before reverting to old writers.

    Only readiness metadata changes. Canonical rows and every projection remain
    available for diagnosis/reconciliation. This is never automatic on deploy.
    """
    cohorts = repo.legacy_cohorts() if hasattr(repo, "legacy_cohorts") else repo.cohorts()
    if apply:
        if discovery:
            prior = repo.get(STATE, "DISCOVERY")
            repo.transaction([(STATE, "DISCOVERY", {"ready": False, "version": 1}, prior)])
        if history:
            for cohort in cohorts:
                pk = "COHORT#" + cohort["code"]
                prior = repo.get(pk, "HISTORY_READY")
                repo.transaction([(pk, "HISTORY_READY", {"ready": False, "version": 1}, prior)])
    return {"dryRun": not apply, "disabled": {"discovery": discovery, "history": history},
            "cohorts": [c["code"] for c in cohorts]}
