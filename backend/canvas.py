"""Leitura das notas pela API do Canvas (todo/17).

Monta, a partir da API, o mesmo CSV que o Canvas exporta (Notas → Exportar), para que
parse_csv aplique exatamente as mesmas regras do fluxo manual: validação, descarte do
aluno de teste, nomes, e-mails e seleção de atividades liberadas.
"""
import csv
import io
import json
import re
import time
import urllib.error
import urllib.request
from decimal import Decimal


class CanvasError(Exception):
    pass


class CanvasClient:
    def __init__(self, base_url, token, opener=urllib.request.urlopen):
        self.site = base_url.rstrip("/")
        self.base = self.site + "/api/v1"
        self.token = token
        self.opener = opener

    def get_all(self, path):
        url, out = self.base + path, []
        while url:
            data, links = self._get(url)
            out.extend(data if isinstance(data, list) else [data])
            nxt = re.search(r'<([^>]+)>; rel="next"', links)
            url = nxt.group(1) if nxt else None
        return out

    def _get(self, url, attempts=3):
        request = urllib.request.Request(url, headers={"Authorization": "Bearer " + self.token})
        for attempt in range(attempts):
            try:
                with self.opener(request, timeout=30) as res:
                    return json.load(res), res.headers.get("Link", "")
            except urllib.error.HTTPError as err:
                if err.code == 401:
                    raise CanvasError("Token do Canvas recusado (expirado ou revogado).") from None
                if err.code == 403:
                    raise CanvasError("O token do Canvas não tem acesso a este curso.") from None
                if err.code == 404:
                    raise CanvasError("Curso não encontrado no Canvas.") from None
                if err.code not in (429, 500, 502, 503, 504) or attempt == attempts - 1:
                    raise CanvasError(f"Canvas respondeu HTTP {err.code}.") from None
            except (urllib.error.URLError, TimeoutError):
                if attempt == attempts - 1:
                    raise CanvasError("Não foi possível conectar ao Canvas.") from None
            time.sleep(2 ** attempt)


def _number(value):
    text = format(Decimal(str(value)).normalize(), "f")
    return "0" if text in ("-0", "") else text


def course_csv(client, course_id):
    """CSV no formato da exportação de notas do Canvas, só com o que parse_csv usa."""
    assignments = client.get_all(f"/courses/{course_id}/assignments?per_page=100")
    students = client.get_all(f"/courses/{course_id}/users?enrollment_type[]=student&include[]=email&per_page=100")
    submissions = client.get_all(
        f"/courses/{course_id}/students/submissions?student_ids[]=all&workflow_state=graded&per_page=100")
    graduated = next((a for a in assignments if a["name"].strip().lower() == "graduated"), None)
    columns = [a for a in assignments if a is not graduated]
    header = ["Student", "ID", "SIS Login ID"] + [f"{a['name']} ({a['id']})" for a in columns] + ["Graduated Final Points"]
    points = ["Points Possible", "", ""] + [_number(a.get("points_possible") or 0) for a in columns] + ["1"]
    grade = {}
    for s in submissions:
        value = "EX" if s.get("excused") else (None if s.get("score") is None else _number(s["score"]))
        if value is not None:
            grade[s["user_id"], s["assignment_id"]] = value
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(header)
    writer.writerow(points)
    for st in students:
        email = (st.get("login_id") or st.get("email") or "").strip()
        graduated_value = grade.get((st["id"], graduated["id"]), "") if graduated else ""
        writer.writerow([st.get("sortable_name") or st.get("name") or "", str(st["id"]), email]
                        + [grade.get((st["id"], a["id"]), "") for a in columns] + [graduated_value])
    return out.getvalue(), len(students)


def course_catalog(client, course_id):
    """Módulo e link de cada tarefa, na ordem do curso (todo/12, parte 2).

    Associa pelo ID da tarefa (o mesmo que aparece entre parênteses na coluna do CSV), não
    pelo título: títulos de itens de módulo e de tarefas nem sempre coincidem. Só entram
    itens publicados, com link para um item de módulo do próprio curso.
    """
    prefix = f"{client.site}/courses/{course_id}/modules/items/"
    modules, items = [], {}
    for module in client.get_all(f"/courses/{course_id}/modules?include[]=items&per_page=100"):
        if module.get("published") is False:
            continue
        name = " ".join(str(module.get("name") or "").split())
        found = {}
        for item in module.get("items") or []:
            key = str(item.get("content_id"))
            # Tarefa repetida (no mesmo módulo ou em outro): vale a primeira ocorrência.
            if (item.get("type") == "Assignment" and item.get("published") is not False
                    and str(item.get("html_url") or "").startswith(prefix) and key not in items and key not in found):
                found[key] = {"module": len(modules), "url": item["html_url"]}
        if name and found:
            items.update(found)
            modules.append(name)
    return {"courseId": str(course_id), "modules": modules, "items": items}
