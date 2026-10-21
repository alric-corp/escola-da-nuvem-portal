"""C7.4: remove proteções em cópias temporárias; nunca edita o checkout nem usa AWS."""
import json
import pathlib
import shutil
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
REMINDERS = "frontend/handlers/reminders.js"
FEEDBACK = "frontend/handlers/feedback.js"
APP = "frontend/app.js"


def run():
    with tempfile.TemporaryDirectory(prefix="c74-mutations-") as directory:
        work = pathlib.Path(directory)
        shutil.copytree(ROOT / "frontend", work / "frontend", ignore=shutil.ignore_patterns("dist", "config.json"))
        (work / "tests").mkdir()
        node_suites = ("stale-responses.mjs", "report-context.mjs", "batch-stale-context.mjs", "feedback-async-context.mjs")
        for name in (*node_suites, "stale-browser.mjs"):
            shutil.copyfile(ROOT / "tests" / name, work / "tests" / name)
        (work / "package.json").write_text('{"type":"module"}')
        (work / "node_modules").symlink_to(ROOT / "node_modules", target_is_directory=True)
        originals = {name: (work / name).read_text() for name in (REMINDERS, FEEDBACK, APP)}

        def test(browser=False):
            if browser:
                shutil.copytree(work / "frontend", work / "frontend-dist", ignore=shutil.ignore_patterns("dist"), dirs_exist_ok=True)
                (work / "frontend-dist" / "config.json").write_text("{}")
                shutil.rmtree(work / "frontend" / "dist", ignore_errors=True)
                shutil.move(work / "frontend-dist", work / "frontend" / "dist")
            suites = ("stale-browser.mjs",) if browser else node_suites
            return subprocess.run(["node", "--test", "--test-reporter=tap", *("tests/" + name for name in suites)], cwd=work, capture_output=True, text=True, timeout=90)

        control = test()
        if control.returncode:
            raise RuntimeError("Controle unitário falhou: " + control.stdout[-2000:] + control.stderr)
        control = test(True)
        if control.returncode:
            raise RuntimeError("Controle browser falhou: " + control.stdout[-2000:] + control.stderr)
        mutations = [
            ("sender-generation", REMINDERS, "loadSender", "request === senderRequest && ", "", False),
            ("pending-generation", REMINDERS, "loadPending", "request === pendingRequest && ", "", False),
            ("mine-generation", FEEDBACK, "loadMine", "request === mineRequest && ", "", False),
            ("sender-success", REMINDERS, "loadSender", "if (current()) state.sender = sender;", "state.sender = sender;", False),
            ("sender-error", REMINDERS, "loadSender", "if (current()) state.senderError", "if (true) state.senderError", False),
            ("sender-finally", REMINDERS, "loadSender", "if (current()) { state.senderLoading", "if (true) { state.senderLoading", False),
            ("mine-success", FEEDBACK, "loadMine", "if (current()) Object.assign", "if (true) Object.assign", False),
            ("mine-error", FEEDBACK, "loadMine", "if (current()) list.error", "if (true) list.error", False),
            ("mine-finally", FEEDBACK, "loadMine", "if (current()) { list.loading", "if (true) { list.loading", False),
            ("pending-success", REMINDERS, "loadPending", "if (current()) {\n      state.pendingPreview", "if (true) {\n      state.pendingPreview", False),
            ("pending-error", REMINDERS, "loadPending", "if (current()) {\n      state.pendingError", "if (true) {\n      state.pendingError", False),
            ("sender-invalidation", REMINDERS, "invalidateReads", "senderRequest++;", "", False),
            ("pending-invalidation", REMINDERS, "invalidateReads", "pendingRequest++;", "", False),
            # As duas proteções originais agora estão separadas pela invalidação das galerias; remover ambas como antes.
            ("mine-invalidation", FEEDBACK, "invalidateReads", ("mineRequest++;", 'state.myFeedback = { items: [], nextCursor: null, loading: false, error: "" };'), ("", ""), False),
            ("list-ownership", FEEDBACK, "loadMine", " && state.myFeedback === list", "", False),
            ("verify-sender-success", REMINDERS, "verifySender", "if (!current()) return;", "", False),
            ("verify-sender-error", REMINDERS, "verifySender", "if (current()) throw err;", "throw err;", False),
            ("send-preview-refresh", REMINDERS, "sendReminder", "if (!current()) return;", "", False),
            ("send-error-after-refresh", REMINDERS, "sendReminder", "if (failure && current())", "if (failure)", False),
            ("navigation-render-hook", APP, "render", "  syncReadContext();", "", True),
            ("expired-session-hook", APP, "publicPage", "  syncReadContext();", "", True),
            ("report-context-invalidation", APP, "syncReadContext", "  reportRequest++;\n", "", False),
            ("boot-generation", APP, "boot", "const current = () => request === bootRequest;", "const current = () => true;", False),
            ("class-report-success", APP, "loadClassReport", "  if (!current()) return;\n", "", False),
            ("batch-invalidation", REMINDERS, "invalidateReads", "batchPreviewRequest++;", "", False),
            ("batch-preview-owner", REMINDERS, "loadBatchPreview", "state.me === owner && ", "", False),
            ("batch-send-owner", REMINDERS, "sendBatch", "state.me === owner && ", "", False),
            ("retry-upload-finally", FEEDBACK, "retryUploads", "if (epoch === userEpoch) {", "if (true) {", False),
        ]
        results = []
        for name, file, function, old, new, browser in mutations:
            for original, content in originals.items():
                (work / original).write_text(content)
            source = originals[file]
            start = source.index("function " + function + "(")
            end = source.index("\n}", start) + 2
            block = source[start:end]
            fragments = ((old, new),) if isinstance(old, str) else zip(old, new)
            for before, after in fragments:
                if block.count(before) != 1:
                    raise RuntimeError("Mutação ambígua ou ausente: " + name)
                block = block.replace(before, after, 1)
            (work / file).write_text(source[:start] + block + source[end:])
            result = test(browser)
            killed = result.returncode != 0 and "not ok" in result.stdout and ("AssertionError" in result.stdout or "ERR_ASSERTION" in result.stdout)
            results.append({"mutation": name, "killed": killed, "suite": "browser" if browser else "node"})
            print(json.dumps(results[-1]), flush=True)
            if not killed:
                raise RuntimeError("Mutação sobrevivente ou falha inesperada: " + name + "\n" + result.stdout[-2500:] + result.stderr)
        print(json.dumps({"controls": "PASS", "killed": len(results), "survived": 0, "checkout_modified": False}))


if __name__ == "__main__":
    run()
