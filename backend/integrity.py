"""Integridade de uma publicação de notas antes de ela virar o estado oficial da turma.

Usada pela publicação manual de CSV e pelo Restore (portal.py). A sincronização automática
não passa por aqui: os dados dela vêm da própria matrícula do Canvas e já têm a proteção
contra turma vazia ou reduzida em sync_from_canvas.

Fontes de referência, todas já gravadas pelo canvas_sync (o portal não chama o Canvas):
- ROSTER#<curso>: matrícula do Canvas (IDs e hash do e-mail), atualizada a cada execução;
- CATALOG#<curso>: tarefas do curso em módulos, para reconhecer arquivo de outra turma.

O identificador do aluno é o ID do Canvas (coluna ID do CSV). Section não é usada: no export
real ela vem como "BRSAO267" (letra O), e uma linha fictícia pode repetir a Section real.
"""
import hashlib
import re

# Mínimo de alunos, em relação à referência, para publicar. O mesmo limite da sincronização
# automática (portal.SYNC_MIN_ROSTER) vale para envio manual e Restore.
SYNC_MIN_ROSTER = 0.8
# Arquivo de outra turma: as tarefas em comum com a referência (catálogo do curso ou publicação
# atual) são menos da metade do MENOR dos dois conjuntos. Assim nem um catálogo incompleto (só
# tarefas em módulos publicados) nem tarefas novas ainda fora dele bloqueiam um arquivo legítimo,
# e um arquivo de outro curso, que só coincide em poucas tarefas, continua bloqueado. IDs de tarefa
# do Canvas não se repetem entre cursos.
MIN_KNOWN_ACTIVITIES = 0.5
TEST_FILENAME_WORDS = {"demo", "test", "tests", "teste", "testes", "mock", "mocks", "fixture", "fixtures"}
MAX_LISTED_IDS = 20

ASSIGNMENT_ID = re.compile(r"\((\d+)\)\s*$")


def email_hash(email):
    """Hash do e-mail normalizado (trim + minúsculas), ou None sem e-mail.

    Serve só para comparar identidades entre o CSV e a matrícula sem guardar o e-mail em claro.
    Não é credencial nem autenticação: e-mails são previsíveis e o hash não tem sal.
    """
    normalized = str(email or "").strip().lower()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest() if normalized else None


def roster_record(course_id, students, captured_at):
    """Registro ROSTER#<curso> a partir dos alunos devolvidos pela API do Canvas. O e-mail é o
    mesmo que canvas.course_csv coloca na coluna SIS Login ID (login_id ou email)."""
    ids = {str(s["id"]): email_hash(s.get("login_id") or s.get("email")) for s in students}
    return {"courseId": str(course_id), "capturedAt": captured_at, "count": len(ids), "students": ids}


def looks_like_test_file(filename):
    words = re.split(r"[^a-z0-9]+", str(filename or "").lower())
    return any(w in TEST_FILENAME_WORDS for w in words)


def _issue(code, message, ids=None, count=None):
    issue = {"code": code, "count": count if count is not None else len(ids or []) or 1, "message": message}
    if ids:
        issue["ids"] = sorted(ids, key=lambda i: (len(i), i))[:MAX_LISTED_IDS]
    return issue


def _assignment_ids(activities):
    return {m.group(1) for m in (ASSIGNMENT_ID.search(a["id"]) for a in activities) if m}


def check(snapshot, *, canvas_course_id=None, roster=None, catalog=None, current=None, filename="",
          compare_size_with_current=True):
    """Relatório de integridade: {"critical": [...], "warnings": [...], "summary": {...}}.

    Qualquer item em "critical" impede publicar (ou restaurar). Cada item tem "code", "count",
    "message" e, quando se refere a alunos, "ids" (IDs do Canvas, nunca e-mail ou nome).
    """
    critical, warnings = [], []
    students = {s["id"]: s for s in snapshot["students"]}
    summary = {"studentsFound": len(students), "activitiesFound": len(snapshot["activities"]),
               "canvasConfigured": bool(canvas_course_id), "rosterCapturedAt": None, "studentsExpected": None,
               "studentsExtra": 0, "studentsMissing": 0, "activitiesKnown": None, "activitiesReference": None}

    if canvas_course_id and not roster:
        critical.append(_issue("rosterUnavailable", "Matrícula do Canvas ainda não disponível para validação. "
                               "Aguarde a próxima sincronização automática antes de publicar."))
    elif not canvas_course_id:
        warnings.append(_issue("rosterNotVerified", "Matrícula não conferida: turma sem curso Canvas configurado."))

    if roster:
        enrolled = roster["students"]
        summary.update(rosterCapturedAt=roster.get("capturedAt"), studentsExpected=roster.get("count", len(enrolled)))
        extra = [sid for sid in students if sid not in enrolled]
        missing = [sid for sid in enrolled if sid not in students]
        summary.update(studentsExtra=len(extra), studentsMissing=len(missing))
        if extra:
            critical.append(_issue("studentNotInRoster", f"{len(extra)} aluno(s) não pertence(m) à turma no Canvas.", extra))
        owner_of = {h: sid for sid, h in enrolled.items() if h}
        taken, changed = [], []
        for sid, student in students.items():
            h = email_hash(student.get("email"))
            if not h:
                continue
            if owner_of.get(h, sid) != sid:
                taken.append(sid)
            elif sid in enrolled and enrolled[sid] and enrolled[sid] != h:
                changed.append(sid)
        if taken:
            critical.append(_issue("emailBelongsToOtherStudent",
                                   f"{len(taken)} aluno(s) com e-mail que pertence a outro ID na matrícula do Canvas.", taken))
        if changed:
            warnings.append(_issue("emailDiffersFromRoster",
                                   f"{len(changed)} aluno(s) com e-mail diferente do registrado no Canvas para o mesmo ID.", changed))
        if missing:
            warnings.append(_issue("studentsMissingFromFile",
                                   f"{len(missing)} aluno(s) matriculado(s) no Canvas não estão no arquivo.", missing))
        if len(students) < SYNC_MIN_ROSTER * summary["studentsExpected"]:
            critical.append(_issue("rosterShrink", f"O arquivo tem {len(students)} alunos, bem menos que os "
                                   f"{summary['studentsExpected']} matriculados no Canvas.", count=summary["studentsExpected"] - len(students)))

    if compare_size_with_current and current and len(students) < SYNC_MIN_ROSTER * len(current["students"]):
        critical.append(_issue("publicationShrink", f"O arquivo tem {len(students)} alunos, bem menos que os "
                               f"{len(current['students'])} da publicação atual.", count=len(current["students"]) - len(students)))

    found = _assignment_ids(snapshot["activities"])
    reference, source = None, None
    if catalog and catalog.get("items"):
        reference, source = set(catalog["items"]), "catalog"
    elif current:
        reference, source = _assignment_ids(current["activities"]), "publication"
    if reference and found:
        known = len(found & reference)
        summary.update(activitiesKnown=known, activitiesReference=source)
        if known < MIN_KNOWN_ACTIVITIES * min(len(found), len(reference)):
            critical.append(_issue("activitiesFromOtherCourse", f"Só {known} de {len(found)} atividades do arquivo pertencem "
                                   "ao curso desta turma. O arquivo parece ser de outra turma.", count=len(found) - known))

    if looks_like_test_file(filename):
        warnings.append(_issue("testFilename", "Este arquivo parece ser de teste."))
    return {"critical": critical, "warnings": warnings, "summary": summary}


def issue_counts(report, import_warnings=()):
    """Só códigos e contagens (para AUDIT): nunca IDs, nomes, e-mails ou notas."""
    counts = [{"code": i["code"], "count": i["count"]} for i in report["warnings"]]
    if import_warnings:
        counts.append({"code": "importWarnings", "count": len(import_warnings)})
    return counts


def blocking_message(report, prefix):
    return prefix + " " + " ".join(i["message"] + (f" (IDs do Canvas: {', '.join(i['ids'])})" if i.get("ids") else "")
                                   for i in report["critical"])
