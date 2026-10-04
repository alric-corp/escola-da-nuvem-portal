"""Extract public routes without importing the runtime or connecting to AWS.

This bounded AST reader follows the dispatch forms currently used by Portal.
Unknown routing forms fail closed. The four regex templates only name positional
captures; methods and concrete operations always come from the Python source.
"""
import ast
import json
import sys
from pathlib import Path


PATTERNS = {
    r"/requests/([^/]+)/reject": "/requests/{userId}/reject",
    r"/admin/feedback/([^/]+)/status": "/admin/feedback/{id}/status",
    r"/cohorts/([A-Z0-9-]+)/([a-z-]+)": "/cohorts/{code}/{operation}",
    r"/feedback/([^/]+)/attachments(?:/([^/]+)(/complete)?)?":
        "/feedback/{feedbackId}/attachments",
}


def values(node, name):
    found = []
    for part in ast.walk(node):
        if not isinstance(part, ast.Compare) or not isinstance(part.left, ast.Name) or part.left.id != name:
            continue
        assert len(part.ops) == 1
        right = part.comparators[0]
        if isinstance(part.ops[0], ast.Eq) and isinstance(right, ast.Constant) and isinstance(right.value, str):
            found.append(right.value)
        elif isinstance(part.ops[0], ast.In) and isinstance(right, (ast.Tuple, ast.List)):
            found.extend(ast.literal_eval(right))
    return found


def target(branch, owner):
    handlers = set()
    for part in ast.walk(branch):
        if not isinstance(part, ast.Return) or not isinstance(part.value, ast.Call):
            continue
        fn = part.value.func
        if isinstance(fn, ast.Attribute) and isinstance(fn.value, ast.Name) and fn.value.id == "self":
            handlers.add("Portal." + fn.attr)
        elif isinstance(fn, ast.Name) and fn.id == "class_report":
            handlers.add(fn.id)
    assert len(handlers) <= 1, "Ambiguous dispatch target: " + owner
    return next(iter(handlers), "Portal." + owner)


def extract(source):
    portal = next(n for n in ast.parse(source).body if isinstance(n, ast.ClassDef) and n.name == "Portal")
    methods = {n.name: n for n in portal.body if isinstance(n, ast.FunctionDef)}
    routes = []

    def add(verb, path, handler):
        assert verb in ("GET", "POST"), "Review new HTTP method"
        routes.append({"method": verb, "path": path, "handler": handler})

    regexes = {}
    for owner in ("dispatch", "_feedback_route"):
        function = methods[owner]
        for node in ast.walk(function):
            if not isinstance(node, ast.Assign) or not isinstance(node.value, ast.Call):
                continue
            fn = node.value.func
            if isinstance(fn, ast.Attribute) and isinstance(fn.value, ast.Name) and fn.value.id == "re" and fn.attr == "fullmatch":
                pattern = ast.literal_eval(node.value.args[0])
                assert pattern in PATTERNS, "Unmapped dispatcher regex: " + pattern
                if node in function.body:
                    regexes[(owner, node.targets[0].id)] = PATTERNS[pattern]
        for branch in function.body:
            if not isinstance(branch, ast.If):
                continue
            verbs, paths, operations = (values(branch.test, n) for n in ("method", "path", "operation"))
            handler = target(branch, owner)
            if operations:
                for operation in operations:
                    current_verbs = verbs
                    if not current_verbs:
                        delegated = methods[handler.removeprefix("Portal.")]
                        choices = [n for n in ast.walk(delegated) if isinstance(n, ast.Compare)
                                   and isinstance(n.left, ast.Name) and n.left.id == "method"
                                   and isinstance(n.comparators[0], ast.IfExp)]
                        assert len(choices) == 1, "Review delegated method guard"
                        choice = choices[0].comparators[0]
                        current_verbs = [ast.literal_eval(choice.body if operation in values(choice.test, "operation") else choice.orelse)]
                    for verb in current_verbs:
                        add(verb, PATTERNS[r"/cohorts/([A-Z0-9-]+)/([a-z-]+)"].replace("{operation}", operation), handler)
            elif verbs:
                if not paths:
                    names = {n.id for n in ast.walk(branch.test) if isinstance(n, ast.Name)}
                    paths = [p for (o, n), p in regexes.items() if o == owner and n in names]
                assert len(paths) == 1, "Unrecognized routing branch: " + ast.unparse(branch.test)
                for verb in verbs:
                    add(verb, paths[0], handler)
            else:
                assert handler in ("Portal._feedback_route", "Portal._attachment_route"), "Review routing delegation"
                expected = {
                    "Portal._feedback_route":
                        'path in ("/feedback", "/admin/feedback") or path.startswith(("/admin/feedback/", "/feedback/"))',
                    "Portal._attachment_route": 'path.startswith("/feedback/")',
                }
                assert ast.dump(branch.test) == ast.dump(ast.parse(expected[handler], mode="eval").body), "Review namespace delegation"

    base = PATTERNS[r"/feedback/([^/]+)/attachments(?:/([^/]+)(/complete)?)?"]
    attachment = methods["_attachment_route"]
    for branch in attachment.body:
        if not isinstance(branch, ast.If):
            continue
        verbs = values(branch.test, "method")
        if not verbs:
            continue
        names = {n.id for n in ast.walk(branch.test) if isinstance(n, ast.Name)}
        assert names in ({"attachment_id", "method"}, {"complete", "method"}), "Review attachment dispatch"
        path = base if "attachment_id" in names else base + "/{attachmentId}/complete"
        for verb in verbs:
            add(verb, path, target(branch, "_attachment_route"))
    guards = [n for n in attachment.body if isinstance(n, ast.Expr) and isinstance(n.value, ast.Call)
              and isinstance(n.value.func, ast.Name) and n.value.func.id == "require"
              and values(n.value.args[0], "method")]
    assert len(guards) == 1 and values(guards[0].value.args[0], "method") == ["GET"]
    add("GET", base, "Portal._attachment_route")
    add("GET", base + "/{attachmentId}", "Portal._attachment_route")
    signatures = {(r["method"], r["path"]) for r in routes}
    assert len(signatures) == len(routes), "Duplicate backend route"
    return sorted(routes, key=lambda r: (r["path"], r["method"]))


if __name__ == "__main__":
    print(json.dumps(extract(Path(sys.argv[1]).read_text())))
