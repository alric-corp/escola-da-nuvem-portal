"""C7.6 (TODO 25): higiene do backend. Fica aqui, e não em backend/, para não entrar no pacote das Lambdas.

Nenhum aviso é desligado globalmente: o teste de compilação os trata como erro, só dentro do próprio teste.
"""
import pathlib
import sys
import unittest
import warnings

BACKEND = pathlib.Path(__file__).resolve().parents[2] / "backend"
sys.path.insert(0, str(BACKEND))
import feedback


class CompilationWarningTests(unittest.TestCase):
    def test_backend_modules_compile_without_syntax_or_deprecation_warnings(self):
        """Escape inválido (ex.: '\;') vira SyntaxWarning no Python 3.12+ (runtime das Lambdas: 3.13)."""
        problems = []
        for path in sorted(BACKEND.glob("*.py")):
            with warnings.catch_warnings():
                warnings.simplefilter("error", SyntaxWarning)
                warnings.simplefilter("error", DeprecationWarning)
                try:
                    compile(path.read_text(encoding="utf-8"), str(path), "exec")
                except (SyntaxError, SyntaxWarning, DeprecationWarning) as err:
                    problems.append(f"{path.name}: {err}")
        self.assertEqual(problems, [])


class ContentDispositionTests(unittest.TestCase):
    """O ASCII do filename recusa aspas, barra invertida e ponto e vírgula; o nome real vai percent-encoded."""

    def ascii_part(self, name):
        header = feedback.content_disposition(name)
        self.assertTrue(header.startswith('inline; filename="'))
        return header[len('inline; filename="'):header.index('"; filename*=')]

    def test_plain_name_is_kept(self):
        self.assertEqual(feedback.content_disposition("captura.png"),
                         "inline; filename=\"captura.png\"; filename*=UTF-8''captura.png")

    def test_quote_backslash_and_semicolon_are_replaced(self):
        self.assertEqual(self.ascii_part('a"b'), "a_b")
        self.assertEqual(self.ascii_part("a\\b"), "a_b")
        self.assertEqual(self.ascii_part("a;b"), "a_b")
        self.assertEqual(self.ascii_part('x"\;y'), "x___y")

    def test_accents_and_non_ascii_are_replaced_in_ascii_but_encoded_in_the_real_name(self):
        header = feedback.content_disposition("relatório é.png")
        self.assertEqual(self.ascii_part("relatório é.png"), "relat_rio _.png")
        self.assertTrue(header.endswith("filename*=UTF-8''relat%C3%B3rio%20%C3%A9.png"))

    def test_control_characters_and_empty_name(self):
        self.assertEqual(self.ascii_part("a\nb\tc"), "a_b_c")
        self.assertEqual(self.ascii_part(""), "imagem")

    def test_user_text_never_breaks_out_of_the_header(self):
        header = feedback.content_disposition('evil";\r\nSet-Cookie: x=1')
        self.assertNotIn("\r", header)
        self.assertNotIn("\n", header)
        self.assertEqual(header.count('"'), 2)


if __name__ == "__main__":
    unittest.main()
