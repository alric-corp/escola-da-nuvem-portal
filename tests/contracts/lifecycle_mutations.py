"""C7.5: remove proteções em cópias temporárias; nunca edita o checkout nem usa AWS.

Uma mutação só conta como morta se (1) o arquivo mutado continua sintaticamente válido (node --check) e
(2) uma suíte falha por asserção. Erro de sintaxe ou de importação não mata nada: aborta o script.
"""
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
ADMIN = "frontend/handlers/admin-feedback.js"
FEEDBACK = "frontend/handlers/feedback.js"
IMPORT = "frontend/handlers/import.js"
APP = "frontend/app.js"
PAGE_MINE = "frontend/pages/feedback.js"
PAGE_ADMIN = "frontend/pages/admin-feedback.js"
FILES = (ADMIN, FEEDBACK, IMPORT, APP, PAGE_MINE, PAGE_ADMIN)
SUITES = {  # ordem de tentativa: a primeira que falhar por asserção mata a mutação
    "unit": ["node", "--test", "--test-reporter=tap", "tests/feedback-lifecycle.mjs"],
    "arch": ["node", "--test", "--test-reporter=tap", "tests/architecture.mjs"],
    "browser": ["node", "tests/feedback-lifecycle-browser.mjs"],
}

# (nome, arquivo, função (None = arquivo todo), trecho original, substituição)
MUTATIONS = [
    ("409-tratado-como-sucesso", ADMIN, "saveStatus", "    throw err;\n  }", "    return;\n  }"),
    ("409-sem-atualizar-a-tela", ADMIN, "saveStatus", "    if (err.status === 409 && state.adminFeedback === a) await load(true, { quiet: true });\n", ""),
    ("409-refresh-esvazia-a-tela", ADMIN, "load", "  if (!quiet) {\n    Object.assign(a, { loading: true", "  if (true) {\n    Object.assign(a, { loading: true"),
    ("409-item-fora-do-filtro-continua-selecionado", ADMIN, "load", "    if (quiet && !a.items.some((f) => f.id === a.selectedId)) a.selectedId = null;\n", ""),
    ("cursor-avanca-apos-erro", ADMIN, "load", "if (request === adminFeedbackRequest && !quiet) a.error =", "if (request === adminFeedbackRequest && !quiet) a.nextCursor = null, a.error ="),
    ("admin-reset-sem-limpar-estado", ADMIN, "resetForUser", "  state.adminFeedback = newAdminFeedback();\n", ""),
    ("feedback-reset-sem-liberar-urls", FEEDBACK, "resetForUser", "  releaseFiles(state.feedbackFiles);\n", ""),
    ("feedback-reset-sem-limpar-rascunho", FEEDBACK, "resetForUser", '  state.feedbackDraft = { type: "", title: "", description: "" };\n', ""),
    ("feedback-reset-sem-geracao", FEEDBACK, "resetForUser", "  userEpoch++;\n", ""),
    ("envio-de-A-grava-no-estado-de-B", FEEDBACK, "submit", "    if (epoch !== userEpoch) return;\n    state.feedbackDraft", "    state.feedbackDraft"),
    ("envio-de-A-finaliza-no-estado-de-B", FEEDBACK, "submit", "    if (epoch === userEpoch) {\n      state.feedbackSending = false;", "    if (true) {\n      state.feedbackSending = false;"),
    ("upload-de-A-conclui-no-estado-de-B", FEEDBACK, "sendFormImages", "  if (epoch !== userEpoch) return false;\n", ""),
    ("upload-continua-laco-apos-troca", FEEDBACK, "uploadImages", "    if (!owned()) return failed;\n", ""),
    ("upload-s3-apos-troca", FEEDBACK, "uploadImage", '  if (slot.status === "READY") return;\n  if (!owned()) throw new Error("Usuário trocado durante o envio.");\n', '  if (slot.status === "READY") return;\n'),
    ("upload-conclui-anexo-apos-troca", FEEDBACK, "uploadImage", '  if (!owned()) throw new Error("Usuário trocado durante o envio.");\n  await api.feedback.completeAttachment', "  await api.feedback.completeAttachment"),
    ("cartao-avisa-apos-troca", FEEDBACK, "addPickedImages", "    if (epoch !== userEpoch) return;\n    card.message", "    card.message"),
    ("cartao-recarrega-apos-troca", FEEDBACK, "addPickedImages", "    if (epoch === userEpoch) {\n      await loadMine();", "    if (true) {\n      await loadMine();"),
    ("urls-sem-revogar-ao-remover", FEEDBACK, "removeFile", "  releaseFiles(removed);\n", ""),
    ("urls-revogacao-prematura", FEEDBACK, "removeFile", "  releaseFiles(removed);", "  releaseFiles(state.feedbackFiles);"),
    ("urls-sem-revogar-ao-descartar", FEEDBACK, "discardUploads", "  releaseFiles(state.feedbackFiles);\n", ""),
    ("urls-sem-revogar-apos-envio", FEEDBACK, "sendFormImages", "  releaseFiles(state.feedbackFiles);\n", ""),
    ("urls-sem-revogar-no-cartao", FEEDBACK, "addPickedImages", "    releaseFiles(entries);\n", ""),
    # A lista do aluno (studentFeedbackList, Expansão 3) e a do instrutor ou admin pelo rodapé (myFeedbackList) são funções
    # diferentes: as duas levam as mesmas mutações.
    ("pagina-aluno-esconde-itens-no-erro", PAGE_MINE, "studentFeedbackList", "if (list.error && !list.items.length)", "if (list.error)"),
    ("pagina-rodape-esconde-itens-no-erro", PAGE_MINE, "myFeedbackList", "if (list.error && !list.items.length)", "if (list.error)"),
    ("pagina-admin-esconde-itens-no-erro", PAGE_ADMIN, "inbox", "if (a.error && !a.items.length)", "if (a.error)"),
    ("pagina-aluno-retry-recomeca", PAGE_MINE, "studentFeedbackList", 'data-action="feedback-more">Tentar novamente', 'data-action="feedback-retry">Tentar novamente'),
    ("pagina-rodape-retry-recomeca", PAGE_MINE, "myFeedbackList", 'data-action="feedback-more">Tentar novamente', 'data-action="feedback-retry">Tentar novamente'),
    ("pagina-admin-retry-recomeca", PAGE_ADMIN, "inbox", 'data-action="admin-feedback-more">Tentar novamente', 'data-action="admin-feedback-retry">Tentar novamente'),
    ("rascunho-obsoleto-no-map", IMPORT, "restoreDraft", "  drafts.delete(state.code);\n", ""),
    ("boot-sem-reset-do-feedback", APP, "boot", "    feedbackHandlers.resetForUser(state.me.email);\n", ""),
    ("boot-sem-reset-do-admin", APP, "boot", "    adminFeedbackHandlers.resetForUser(state.me.email);\n", ""),
    ("logout-sem-reset-do-feedback", APP, "signOut", '  feedbackHandlers.resetForUser("");\n', ""),
    ("logout-sem-reset-do-admin", APP, "signOut", '  adminFeedbackHandlers.resetForUser("");\n', ""),
    ("foco-nao-restaurado", APP, "restoreFocus", "    if (target) return target.focus({ preventScroll: true });", "    if (target) return;"),
    ("foco-roubado-do-usuario", APP, "restoreFocus", "  if (active && active !== document.body && active.isConnected) return;\n", ""),
    ("foco-sem-restaurar-ao-salvar", APP, None, '    }).then(() => restoreFocus("#fb-status-select", ".fb-open"));', "    });"),
    ("foco-sem-restaurar-ao-voltar", APP, None, '    restoreFocus(`[data-fb-open="${CSS.escape(opened)}"]`, ".fb-open");\n', ""),
    ("foco-sem-restaurar-ao-abrir-anexos", APP, None, ".then(() => restoreFocus(toggle));", ";"),
    ("foco-sem-restaurar-ao-fechar-anexos", APP, None, "      feedbackHandlers.closeAttachments(id);\n      restoreFocus(toggle);\n", "      feedbackHandlers.closeAttachments(id);\n"),
]


def function_block(source, name):
    start = source.index("function " + name + "(")
    end = source.index("\n}", start) + 2
    return start, end


def run():
    with tempfile.TemporaryDirectory(prefix="c75-mutations-") as directory:
        work = pathlib.Path(directory)
        shutil.copytree(ROOT / "frontend", work / "frontend", ignore=shutil.ignore_patterns("dist", "config.json"))
        shutil.copytree(ROOT / "tests", work / "tests", ignore=shutil.ignore_patterns("contracts", "integration", "__pycache__"))
        shutil.copytree(ROOT / "scripts", work / "scripts", ignore=shutil.ignore_patterns("__pycache__"))
        shutil.copyfile(ROOT / "package.json", work / "package.json")
        (work / "node_modules").symlink_to(ROOT / "node_modules", target_is_directory=True)
        originals = {name: (work / name).read_text() for name in FILES}

        def prepare_browser():
            shutil.rmtree(work / "frontend-dist", ignore_errors=True)
            shutil.copytree(work / "frontend", work / "frontend-dist", ignore=shutil.ignore_patterns("dist"))
            (work / "frontend-dist" / "config.json").write_text("{}")
            shutil.rmtree(work / "frontend" / "dist", ignore_errors=True)
            shutil.move(work / "frontend-dist", work / "frontend" / "dist")

        def execute(kind):
            if kind == "browser":
                prepare_browser()
            return subprocess.run(SUITES[kind], cwd=work, capture_output=True, text=True, timeout=240)

        def failed_by_assertion(kind, result):
            out = result.stdout + result.stderr
            if result.returncode == 0:
                return False
            if "SyntaxError" in out or "ERR_MODULE_NOT_FOUND" in out or "is not a function" in out and kind != "browser":
                raise RuntimeError("Falha que não é de asserção (" + kind + "): " + out[-1500:])
            return "ERR_ASSERTION" in out or "AssertionError" in out or "FALHOU:" in out

        for kind in SUITES:
            control = execute(kind)
            if control.returncode:
                raise RuntimeError("Controle falhou (" + kind + "): " + (control.stdout + control.stderr)[-2500:])

        results = []
        only = set(filter(None, os.environ.get("MUT_ONLY", "").split(",")))  # diagnóstico: MUT_ONLY=a,b MUT_DEBUG=1
        for name, file, function, old, new in MUTATIONS:
            if only and name not in only:
                continue
            for original, content in originals.items():
                (work / original).write_text(content)
            source = originals[file]
            if function:
                start, end = function_block(source, function)
            else:
                start, end = 0, len(source)
            block = source[start:end]
            if block.count(old) != 1:
                raise RuntimeError("Mutação ambígua ou ausente: " + name)
            (work / file).write_text(source[:start] + block.replace(old, new, 1) + source[end:])
            check = subprocess.run(["node", "--check", str(work / file)], capture_output=True, text=True)
            if check.returncode:
                raise RuntimeError("Mutação com erro de sintaxe (não conta): " + name + "\n" + check.stderr)
            killed_by = None
            order = (["browser", "arch", "unit"] if name.startswith(("foco-", "boot-")) else
                     ["arch", "unit", "browser"] if name.startswith("logout-") else list(SUITES))
            for kind in order:
                result = execute(kind)
                if os.environ.get("MUT_DEBUG"):
                    print(kind, result.returncode, (result.stdout + result.stderr)[-1200:], flush=True)
                if failed_by_assertion(kind, result):
                    killed_by = kind
                    break
            results.append({"mutation": name, "killed": killed_by is not None, "by": killed_by})
            print(json.dumps(results[-1]), flush=True)
        survivors = [r["mutation"] for r in results if not r["killed"]]
        print(json.dumps({"controls": "PASS", "killed": len(results) - len(survivors), "survived": len(survivors), "checkout_modified": False}))
        if survivors:
            raise RuntimeError("Mutações sobreviventes: " + ", ".join(survivors))


if __name__ == "__main__":
    run()
