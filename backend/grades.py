"""Regras de importação independentes de AWS e da interface."""
import csv
import io
import re
from decimal import Decimal, InvalidOperation


class ValidationError(ValueError):
    pass


def canvas_test_student(row):
    """Reconhece apenas nomes reservados com o formato de login da conta de teste.

    Nome sozinho não basta: alunos com e-mail válido continuam sendo importados.
    """
    name = " ".join(" ".join(reversed(row["Student"].strip().split(", "))).casefold().split())
    login = row["SIS Login ID"].strip()
    return (name in {"test student", "student test", "testar aluno", "aluno de teste"}
            and bool(re.fullmatch(r"\d{1,32}", row["ID"].strip()))
            and not row.get("SIS User ID", "").strip()
            and (not login or bool(re.fullmatch(r"[0-9a-fA-F]{40}", login))))


def number(value, field):
    try:
        result = Decimal(str(value).strip().replace(",", "."))
    except InvalidOperation:
        raise ValidationError(f"Valor inválido em {field}: {value!r}.") from None
    if not result.is_finite() or result < 0:
        raise ValidationError(f"Nota negativa ou não finita em {field}.")
    return result


def summary(student, activities):
    scores = {"kc": [], "lab": []}
    complete = pending = 0
    details = []
    for activity in activities:
        raw = student["grades"].get(activity["id"])
        active = activity["active"]
        exempt = raw == "EX"
        value = None if raw is None or exempt else Decimal(raw)
        percent = None if value is None else value / Decimal(activity["points"]) * 100
        state = "unreleased" if not active else "exempt" if exempt else "pending" if raw is None else "completed"
        if active and not exempt:
            scores[activity["kind"]].append(percent if percent is not None else Decimal(0))
            complete += raw is not None
            pending += raw is None
        details.append({**activity, "state": state,
                        "needsReview": state == "completed" and percent is not None and percent < (70 if activity["kind"] == "kc" else 95),
                        "score": None if value is None else float(value),
                        "percent": None if percent is None else round(float(percent), 2)})
    means = {k: sum(v) / len(v) if v else None for k, v in scores.items()}
    kc, lab = means["kc"], means["lab"]
    if student["graduated"]:
        status = "graduated"
    elif kc is None or lab is None:
        status = "insufficient"
    elif kc >= 70 and lab >= 95:
        status = "ok"
    elif kc < 70 and lab < 95:
        status = "critical"
    else:
        status = "attention"
    available = [x for x in means.values() if x is not None]
    return {"id": student["id"], "name": student["name"], "email": student["email"],
            "kc": None if kc is None else round(float(kc), 2),
            "lab": None if lab is None else round(float(lab), 2),
            "total": round(float(sum(available) / len(available)), 2) if available else None,
            "progress": round(complete / (complete + pending) * 100, 2) if complete + pending else None,
            "pending": pending, "completed": complete, "status": status, "activities": details}


def parse_csv(text, active_ids=None):
    if not isinstance(text, str) or len(text.encode("utf-8")) > 2_000_000:
        raise ValidationError("Envie um CSV UTF-8 de até 2 MB.")
    try:
        reader = csv.reader(io.StringIO(text.lstrip("\ufeff")), strict=True)
        headers = [h.strip() for h in next(reader)]
        records = []
        while True:
            line = reader.line_num + 1
            try:
                row = next(reader)
            except StopIteration:
                break
            if any(v.strip() for v in row):
                records.append((line, row))
    except (csv.Error, StopIteration):
        raise ValidationError("Arquivo CSV vazio ou malformado.") from None
    required = {"Student", "ID", "SIS Login ID"}
    if not required.issubset(headers):
        raise ValidationError("O CSV deve conter Student, ID e SIS Login ID, separado por vírgulas.")
    if len(set(headers)) != len(headers):
        raise ValidationError("Há cabeçalhos duplicados no CSV.")
    if any(len(r) != len(headers) for _, r in records):
        raise ValidationError("Há linhas com quantidade de campos diferente do cabeçalho.")
    rows = [(line, dict(zip(headers, r))) for line, r in records]
    points_rows = [r for _, r in rows if r["Student"].strip() == "Points Possible"]
    if len(points_rows) != 1:
        raise ValidationError("Mantenha exatamente uma linha Points Possible para normalizar as notas.")
    points_row = points_rows[0]
    rows = [(line, r) for line, r in rows if r is not points_row]
    warnings = []
    student_rows = []
    for line, row in rows:
        if canvas_test_student(row):
            warnings.append(f"Linha {line}: aluno de teste do Canvas ignorado; não entra nas notas da turma.")
        else:
            student_rows.append((line, row))
    rows = student_rows
    if not rows or len(rows) > 500:
        raise ValidationError("O arquivo deve conter entre 1 e 500 alunos.")
    activities = []
    for header in headers:
        match = re.search(r"^\d+.*?\b(KC|LAB)\b", header, re.I)
        # Canvas também pode exportar nomes com underscore junto ao tipo.
        if not match:
            match = re.search(r"^\d+.*?(KC|LAB)(?:\b|_)", header, re.I)
        if not match:
            continue
        points = number(points_row[header], header)
        if points <= 0:
            raise ValidationError(f"Points Possible deve ser maior que zero em {header}.")
        filled = sum(bool(r[header].strip()) for _, r in rows)
        activities.append({"id": header, "name": re.sub(r"\s*\(\d+\)\s*$", "", header),
                           "kind": match[1].lower(), "points": str(points),
                           "active": filled >= min(5, len(rows)), "filled": filled})
    if not activities or len(activities) > 200:
        raise ValidationError("São necessárias de 1 a 200 atividades numeradas KC/Lab.")
    if active_ids is not None:
        if not isinstance(active_ids, list) or any(not isinstance(x, str) for x in active_ids):
            raise ValidationError("A seleção de atividades deve ser uma lista de identificadores.")
        if set(active_ids) - {a["id"] for a in activities}:
            raise ValidationError("Uma atividade selecionada não existe neste CSV.")
        for a in activities:
            a["active"] = a["id"] in active_ids
    students, ids, emails = [], set(), set()
    for i, row in rows:
        student_id, email = row["ID"].strip(), row["SIS Login ID"].strip().lower()
        if not re.fullmatch(r"\d{1,32}", student_id) or not row["Student"].strip():
            raise ValidationError(f"Aluno sem nome ou ID Canvas numérico na linha {i}.")
        if email and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            raise ValidationError(f"E-mail inválido na linha {i}.")
        if student_id in ids or (email and email in emails):
            raise ValidationError("Há IDs Canvas ou e-mails duplicados no arquivo.")
        ids.add(student_id)
        if email:
            emails.add(email)
        else:
            warnings.append(f"Linha {i}: aluno sem e-mail no Canvas. As notas serão importadas, "
                            "mas novos vínculos de acesso dependem da correção do e-mail no Canvas e de uma nova publicação.")
        grades = {}
        for a in activities:
            value = row[a["id"]].strip()
            if not value:
                grades[a["id"]] = None
            elif value.upper() == "EX":
                grades[a["id"]] = "EX"
            else:
                score = number(value, f"{a['name']} / aluno {student_id}")
                if score > Decimal(a["points"]):
                    raise ValidationError(f"Nota acima de Points Possible: {a['name']} / aluno {student_id}.")
                grades[a["id"]] = str(score)
        students.append({"id": student_id, "email": email or None,
                         "name": " ".join(reversed(row["Student"].strip().split(", "))),
                         "graduated": row.get("Graduated Final Points", "").strip().replace(",", ".") in ("1", "1.0", "1.00"),
                         "grades": grades})
    return {"activities": activities, "students": students, "warnings": warnings}


def overview(snapshot):
    rows = [summary(s, snapshot["activities"]) for s in snapshot["students"]]
    # completed + pending é o denominador natural para "% sem nota" e "% em revisão":
    # o mesmo universo (liberada e não dispensada) usado pela média do aluno em summary().
    stats = {a["id"]: {"completed": 0, "pending": 0, "needsReview": 0, "scores": []} for a in snapshot["activities"]}
    for row in rows:
        for detail in row["activities"]:
            st = stats[detail["id"]]
            if detail["state"] == "completed":
                st["completed"] += 1
                if detail["percent"] is not None:
                    st["scores"].append(detail["percent"])
                if detail["needsReview"]:
                    st["needsReview"] += 1
            elif detail["state"] == "pending":
                st["pending"] += 1
    activities = [{**a, "completed": stats[a["id"]]["completed"], "pending": stats[a["id"]]["pending"],
                  "needsReview": stats[a["id"]]["needsReview"],
                  "average": round(sum(stats[a["id"]]["scores"]) / len(stats[a["id"]]["scores"]), 2)
                  if stats[a["id"]]["scores"] else None}
                 for a in snapshot["activities"]]
    return {"activities": activities,
            "warnings": snapshot.get("warnings", []),
            "students": [{k: v for k, v in s.items() if k != "activities"} for s in rows],
            "count": len(rows)}
