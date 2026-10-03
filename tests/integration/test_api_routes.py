"""Contrato entre o dispatcher do backend e as rotas publicadas no API Gateway, sem AWS e sem importar o backend.

O API Gateway só encaminha as rotas listadas em infra/terraform/api.tf. Uma operação que o backend trata, mas que não
está lá, nunca chega à Lambda: o navegador recebe 404 sem CORS e mostra falha de rede (a participação ficou assim da
C7.2.1 até a C7.2.4.1). Fica aqui, e não em backend/, porque o pacote das Lambdas exclui só os test_*.py listados.

Portal.dispatch é lido pela AST: cada comparação com `operation` (== ou in) é uma operação de turma, com o método quando
ele vem na mesma condição (sem método, o handler decide). As rotas fora de /cohorts/{code}/ (me, cohorts, requests,
feedback) são cobertas pelo contrato do frontend em tests/api.mjs, que compara todas as rotas nos dois sentidos.
"""
import ast
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]


def gateway_routes():
    """Route keys de todos os aws_apigatewayv2_route do api.tf; formato desconhecido falha em vez de passar calado."""
    tf = (ROOT / "infra" / "terraform" / "api.tf").read_text(encoding="utf-8")
    keys = []
    for match in re.finditer(r'^resource "aws_apigatewayv2_route" "(\w+)" \{$', tf, re.M):
        block = tf[match.start():tf.index("\n}\n", match.start())]
        literal = re.search(r'route_key\s+= "([^"]+)"', block)
        listed = re.search(r"for_each = toset\(\[(.*?)\]\)", block, re.S)
        if not (literal or (listed and re.search(r"route_key\s+= each\.value", block))):
            raise AssertionError(f"{match.group(1)}: route_key em formato não reconhecido")
        keys += [literal.group(1)] if literal else re.findall(r'"([^"]+)"', listed.group(1))
    return keys


def dispatcher_operations():
    """{operação de turma: métodos fixados na mesma condição} a partir de Portal.dispatch."""
    tree = ast.parse((ROOT / "backend" / "portal.py").read_text(encoding="utf-8"))
    dispatch = next(node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef) and node.name == "dispatch")
    operations = {}
    for node in ast.walk(dispatch):
        if not isinstance(node, ast.If):
            continue
        tests = node.test.values if isinstance(node.test, ast.BoolOp) and isinstance(node.test.op, ast.And) else [node.test]
        found = {"operation": [], "method": []}
        for test in tests:
            if isinstance(test, ast.Compare) and isinstance(test.left, ast.Name) and test.left.id in found:
                right = test.comparators[0]
                values = right.elts if isinstance(right, (ast.Tuple, ast.List, ast.Set)) else [right]
                found[test.left.id] += [value.value for value in values if isinstance(value, ast.Constant)]
        for operation in found["operation"]:
            operations.setdefault(operation, set()).update(found["method"])
    return operations


class GatewayContractTests(unittest.TestCase):
    def test_cohort_operations_and_gateway_routes_match(self):
        keys = gateway_routes()
        self.assertEqual(len(keys), len(set(keys)), "route key repetida no api.tf")
        published = {}
        for key in keys:
            method, path = key.split(" ", 1)
            match = re.fullmatch(r"/cohorts/\{[^}]+\}/([a-z-]+)", path)
            if match:
                published.setdefault(match.group(1), set()).add(method)
        operations = dispatcher_operations()
        self.assertEqual(sorted(set(operations) - set(published)), [], "operações do backend sem rota no API Gateway")
        self.assertEqual(sorted(set(published) - set(operations)), [], "rotas de turma sem operação no backend")
        for operation, methods in sorted(operations.items()):
            if methods:
                self.assertEqual(published[operation], methods, f"métodos de {operation}: backend x API Gateway")
        self.assertEqual(operations["participation"], {"POST"})


if __name__ == "__main__":
    unittest.main()
