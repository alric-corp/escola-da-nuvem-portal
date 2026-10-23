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
import urllib.parse
import urllib.request
from decimal import Decimal

AUX_MAX_PAGE_BYTES = 4 * 1024 * 1024


class CanvasError(Exception):
    pass


class _CanvasRedirect(urllib.request.HTTPRedirectHandler):
    def __init__(self, validate):
        self.validate = validate

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # A validação ocorre antes de o urllib encaminhar Authorization a um redirect.
        self.validate(newurl, urllib.parse.urlsplit(req.full_url).path)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class CanvasClient:
    def __init__(self, base_url, token, opener=None):
        self.site = base_url.rstrip("/")
        self.base = self.site + "/api/v1"
        self.token = token
        self._checked_url(self.base + "/")
        self.opener = opener or urllib.request.build_opener(_CanvasRedirect(self._checked_url)).open

    def _checked_url(self, url, expected_path=None):
        try:
            parsed, site = urllib.parse.urlsplit(url), urllib.parse.urlsplit(self.site)
            origin = lambda part: (part.scheme, part.hostname, part.port or 443)
            path = parsed.path
            valid = (isinstance(url, str) and url == url.strip() and not any(ord(c) < 32 for c in url)
                     and parsed.scheme == site.scheme == "https" and parsed.hostname
                     and origin(parsed) == origin(site) and not parsed.username and not parsed.password
                     and not site.username and not site.password and not parsed.fragment
                     and not site.query and not site.fragment and site.path in ("", "/")
                     and path.startswith("/api/v1/") and "\\" not in path and "//" not in path
                     and urllib.parse.unquote(path) == path and not {".", ".."}.intersection(path.split("/"))
                     and (expected_path is None or path == expected_path))
        except (TypeError, ValueError):
            valid = False
        if not valid:
            raise CanvasError("Endereço de leitura do Canvas fora do contexto autorizado.")
        return url

    def get_all(self, path, *, max_pages=None, deadline=None, fields=None, project=None):
        if not isinstance(path, str) or not path.startswith("/") or path.startswith("//"):
            raise CanvasError("Caminho de leitura do Canvas inválido.")
        url, out, visited = self.base + path, [], set()
        expected_path = urllib.parse.urlsplit(url).path
        while url:
            # Apenas coletores auxiliares optam por um orçamento. Nunca devolver uma
            # lista truncada como se toda a paginação tivesse sido concluída.
            if (max_pages is not None and len(visited) >= max_pages
                    or deadline is not None and time.monotonic() >= deadline):
                raise CanvasError("Coleta auxiliar Canvas excedeu o orçamento de leitura.")
            self._checked_url(url, expected_path)
            if url in visited:
                raise CanvasError("Paginação cíclica do Canvas.")
            visited.add(url)
            data, links = self._get(url, deadline=deadline) if deadline is not None else self._get(url)
            if deadline is not None and time.monotonic() >= deadline:
                raise CanvasError("Coleta auxiliar Canvas excedeu o orçamento de leitura.")
            if not isinstance(data, list):
                raise CanvasError("A lista do Canvas tem formato inválido.")
            # O coletor de entregas descarta corpo/comentários a cada página, sem
            # reter centenas de payloads pessoais até terminar o curso inteiro.
            if project is not None:
                out.extend(project(entry) for entry in data)
            elif fields is None:
                out.extend(data)
            else:
                out.extend({key: entry[key] for key in fields if key in entry} if isinstance(entry, dict) else entry
                           for entry in data)
            following, parsed_until = [], 0
            for match in re.finditer(r'<([^<>]+)>([^,]*)', links):
                if links[parsed_until:match.start()].strip(" ,\t"):
                    raise CanvasError("Cabeçalho de paginação do Canvas inválido.")
                parsed_until = match.end()
                relation = re.search(r';\s*rel\s*=\s*(?:"([^"]+)"|([^";\s,]+))', match[2], re.I)
                if not relation and re.search(r';\s*rel\s*=', match[2], re.I):
                    raise CanvasError("Cabeçalho de paginação do Canvas inválido.")
                if relation and "next" in (relation[1] or relation[2]).lower().split():
                    following.append(match[1])
            if len(following) > 1 or links[parsed_until:].strip(" ,\t"):
                raise CanvasError("Cabeçalho de paginação do Canvas inválido.")
            url = following[0] if following else None
        return out

    def _get(self, url, attempts=3, deadline=None):
        self._checked_url(url)
        request = urllib.request.Request(url, headers={"Authorization": "Bearer " + self.token})
        for attempt in range(attempts):
            remaining = None if deadline is None else deadline - time.monotonic()
            if remaining is not None and remaining <= 0:
                raise CanvasError("Coleta auxiliar Canvas excedeu o orçamento de leitura.")
            try:
                with self.opener(request, timeout=30 if remaining is None else min(30, remaining)) as res:
                    try:
                        if deadline is None:
                            # O caminho acadêmico mantém o comportamento existente.
                            data = json.load(res)
                        else:
                            # A projeção ocorre depois do parse. Limite o corpo antes
                            # dele para não carregar entregas/anexos arbitrariamente
                            # grandes em uma página auxiliar agrupada.
                            body = res.read(AUX_MAX_PAGE_BYTES + 1)
                            if len(body) > AUX_MAX_PAGE_BYTES:
                                raise CanvasError("Página auxiliar Canvas excedeu o limite de tamanho.")
                            data = json.loads(body)
                    except (ValueError, UnicodeError):
                        raise CanvasError("Resposta JSON do Canvas inválida.") from None
                    links = next((value for key, value in res.headers.items() if key.lower() == "link"), "")
                    if not isinstance(links, str):
                        raise CanvasError("Cabeçalho de paginação do Canvas inválido.")
                    return data, links
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
            remaining = None if deadline is None else deadline - time.monotonic()
            if remaining is not None and remaining <= 0:
                raise CanvasError("Coleta auxiliar Canvas excedeu o orçamento de leitura.")
            time.sleep(2 ** attempt if remaining is None else min(2 ** attempt, remaining))


def _number(value):
    text = format(Decimal(str(value)).normalize(), "f")
    return "0" if text in ("-0", "") else text


def course_students(client, course_id, *, include_enrollments=False):
    """Alunos matriculados no curso: a mesma lista que vira as linhas do CSV da sincronização
    e a matrícula (ROSTER) usada nas validações do envio manual."""
    extra = "&include[]=enrollments" if include_enrollments else ""
    return client.get_all(f"/courses/{course_id}/users?enrollment_type[]=student&include[]=email&per_page=100{extra}")


def course_csv(client, course_id, students=None):
    """CSV no formato da exportação de notas do Canvas, só com o que parse_csv usa. Recebe os
    alunos já lidos por course_students, se houver, para não pedir a matrícula duas vezes."""
    assignments = client.get_all(f"/courses/{course_id}/assignments?per_page=100")
    if students is None:
        students = course_students(client, course_id)
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


def _canvas_id(value):
    if (type(value) not in (int, str) or not re.fullmatch(r"[0-9]{1,32}", str(value))
            or int(value) < 1):
        raise CanvasError("Identificador do catálogo Canvas inválido.")
    return str(value)


def _catalog_items(client, course_id, module):
    module_id = _canvas_id(module.get("id"))
    count = module.get("items_count")
    if type(count) is not int or count < 0:
        raise CanvasError("Contagem de itens do módulo Canvas inválida.")
    path = f"/courses/{course_id}/modules/{module_id}/items"
    # O endereço fornecido é conferido, mas a requisição usa a rota construída de IDs validados.
    if "items_url" in module:
        client._checked_url(module["items_url"], "/api/v1" + path)
    entries = module.get("items")
    if entries is not None and not isinstance(entries, list):
        raise CanvasError("Itens inline do módulo Canvas inválidos.")
    if entries is None or len(entries) < count:
        entries = client.get_all(path + "?per_page=100")
    if not isinstance(entries, list) or len(entries) != count:
        raise CanvasError("Catálogo Canvas incompleto: contagem de itens divergente.")
    seen = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise CanvasError("Item do módulo Canvas inválido.")
        if "published" in entry and type(entry["published"]) is not bool:
            raise CanvasError("Estado de publicação do item Canvas inválido.")
        item_id = _canvas_id(entry.get("id"))
        if item_id in seen:
            raise CanvasError("Catálogo Canvas incompleto: item repetido.")
        seen.add(item_id)
        if "module_id" in entry and _canvas_id(entry["module_id"]) != module_id:
            raise CanvasError("Item Canvas não pertence ao módulo solicitado.")
        if "course_id" in entry and _canvas_id(entry["course_id"]) != course_id:
            raise CanvasError("Item Canvas não pertence ao curso solicitado.")
        if not isinstance(entry.get("type"), str) or not entry["type"]:
            raise CanvasError("Tipo de item Canvas inválido.")
    return entries


def course_catalog(client, course_id):
    """Catálogo completo, com fallback paginado apenas para módulos sem todos os itens inline.

    items_count refere-se ao universo de itens, antes de filtrar Assignment/publicação.
    Nenhum candidato é devolvido para persistência se qualquer módulo estiver incompleto.
    Tarefas repetidas preservam a primeira ocorrência na ordem do curso.
    """
    course_id = _canvas_id(course_id)
    prefix = f"{client.site}/courses/{course_id}/modules/items/"
    modules, items, seen = [], {}, set()
    candidates = client.get_all(f"/courses/{course_id}/modules?include[]=items&per_page=100")
    if not isinstance(candidates, list):
        raise CanvasError("Lista de módulos Canvas inválida.")
    for module in candidates:
        if not isinstance(module, dict):
            raise CanvasError("Módulo Canvas inválido.")
        module_id = _canvas_id(module.get("id"))
        if module_id in seen:
            raise CanvasError("Catálogo Canvas incompleto: módulo repetido.")
        seen.add(module_id)
        if "course_id" in module and _canvas_id(module["course_id"]) != course_id:
            raise CanvasError("Módulo Canvas não pertence ao curso solicitado.")
        if "published" in module and type(module["published"]) is not bool:
            raise CanvasError("Estado de publicação do módulo Canvas inválido.")
        if module.get("published") is False:
            continue
        name = module.get("name")
        if not isinstance(name, str) or not name.strip():
            raise CanvasError("Nome do módulo Canvas inválido.")
        name = " ".join(name.split())
        found = {}
        for entry in _catalog_items(client, course_id, module):
            if entry["type"] != "Assignment" or entry.get("published") is False:
                continue
            key = _canvas_id(entry.get("content_id"))
            url = entry.get("html_url")
            # Preserva a política anterior: links de fora do curso não entram no catálogo.
            if not isinstance(url, str) or not url.startswith(prefix):
                continue
            if url != prefix + _canvas_id(entry["id"]):
                raise CanvasError("Link do item Canvas incompatível com seu identificador.")
            if key not in items and key not in found:
                found[key] = {"module": len(modules), "url": url}
        if found:
            items.update(found)
            modules.append(name)
    return {"courseId": course_id, "modules": modules, "items": items}


def token_expires_at(client):
    """Data de expiração do próprio token (ISO 8601), ou None se ele não expira.

    O Canvas aceita a "dica" do token no lugar do ID: o prefixo da instância, "~" e os
    5 primeiros caracteres. Levanta CanvasError se não conseguir consultar.
    """
    prefix, _, rest = client.token.rpartition("~")
    hint = f"{prefix}~{rest[:5]}" if prefix else client.token[:5]
    data, _ = client._get(f"{client.base}/users/self/tokens/{urllib.parse.quote(hint, safe='')}")
    return data.get("expires_at")
