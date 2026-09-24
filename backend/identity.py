"""Identidade da sessão; a validação criptográfica é feita pelo JWT authorizer.

Nenhum dado do corpo/query string concede papéis. Esta rota não concede acesso
a notas: os futuros endpoints devem consultar os vínculos de turma por `sub`.
"""

import json
import re


def response(status, payload):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
        },
        "body": json.dumps(payload),
    }


def groups_from_claim(value):
    # API Gateway pode representar o claim de array como string.
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            value = re.split(r"[\s,]+", value.strip("[]"))
    if not isinstance(value, list):
        return []
    return sorted({g for g in value if isinstance(g, str) and g in {"admin", "instructor", "student"}})


def handler(event, context):
    if event.get("routeKey") != "GET /me":
        return response(404, {"error": "not_found"})
    claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
    if not claims.get("sub") or claims.get("token_use") != "access":
        return response(401, {"error": "unauthorized"})
    if "portal/access" not in claims.get("scope", "").split():
        return response(403, {"error": "insufficient_scope"})
    return response(200, {
        "userId": claims["sub"],
        "roles": groups_from_claim(claims.get("cognito:groups", [])),
    })
