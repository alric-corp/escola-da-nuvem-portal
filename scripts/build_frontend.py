"""Build estático sem dependências npm. Nunca copia CSV, Terraform ou credenciais."""
import argparse
import json
import pathlib
import shutil

ROOT = pathlib.Path(__file__).resolve().parents[1]
FILES = ["index.html", "styles.css", "app.js", "api.js", "ui.js", "state.js", "handlers/access.js", "handlers/import.js", "handlers/admin-feedback.js", "auth.js", "canvas-links.js", "student-journey.js", "demo.js", "logo.png",
          "pages/landing.js", "pages/class-report.js", "pages/student.js", "pages/teacher.js", "pages/reminders.js",
          "pages/history.js", "pages/import.js", "pages/access.js", "pages/activities-overview.js",
          "pages/feedback.js", "pages/admin-feedback.js"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=pathlib.Path, help="JSON do output frontend_config do Terraform")
    args = parser.parse_args()
    config = json.loads(args.config.read_text()) if args.config else {}
    if args.config:
        required = {"apiUrl", "authDomain", "userPoolClientId", "redirectUri", "logoutUri", "scopes"}
        if not required.issubset(config):
            parser.error("Configuração incompleta: use terraform output -json frontend_config.")
        if any(not config[k].startswith("https://") for k in ("apiUrl", "authDomain", "redirectUri", "logoutUri")):
            parser.error("Os endpoints publicados devem usar HTTPS.")
    dest = ROOT / "frontend" / "dist"
    dest.mkdir(exist_ok=True)
    for name in FILES:
        (dest / name).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / "frontend" / name, dest / name)
    (dest / "config.json").write_text(json.dumps(config, indent=2) + "\n")
    print(f"Build concluído: {dest}")
    if not args.config:
        print("Sem configuração AWS: use ?demo=1 para explorar dados fictícios.")


if __name__ == "__main__":
    main()
