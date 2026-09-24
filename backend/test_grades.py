import csv
import io
import unittest

from grades import ValidationError, overview, parse_csv, summary


def canvas_csv(kc="7", lab="50", email="aluno@example.test", student_id="101", extra=None):
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["Student", "ID", "SIS Login ID", "001 KC (123)", "002 Lab (456)", "Graduated Final Points"])
    writer.writerow(["Points Possible", "", "", "10", "100", "1"])
    writer.writerow(["Costa, Marina", student_id, email, kc, lab, "0"])
    if extra:
        writer.writerow(extra)
    return out.getvalue()


class GradesTests(unittest.TestCase):
    def result(self, **kwargs):
        snapshot = parse_csv(canvas_csv(**kwargs))
        return summary(snapshot["students"][0], snapshot["activities"])

    def test_points_possible_normalizes_both_scales(self):
        result = self.result()
        self.assertEqual((result["kc"], result["lab"]), (70, 50))
        self.assertEqual(result["status"], "attention")

    def test_zero_is_completed_and_not_pending(self):
        result = self.result(kc="0", lab="0")
        self.assertEqual((result["pending"], result["progress"]), (0, 100))
        self.assertEqual(result["status"], "critical")

    def test_status_uses_unrounded_values(self):
        result = self.result(kc="6.99999", lab="94.99999")
        self.assertEqual((result["kc"], result["lab"]), (70, 95))
        self.assertEqual(result["status"], "critical")

    def test_pending_activity_counted_as_zero_when_released(self):
        snapshot = parse_csv(canvas_csv(kc=""), ["001 KC (123)", "002 Lab (456)"])
        result = summary(snapshot["students"][0], snapshot["activities"])
        self.assertEqual((result["kc"], result["pending"], result["progress"]), (0, 1, 50))

    def test_inactive_and_exempt_do_not_penalize_student(self):
        result = self.result(kc="EX", lab="")
        self.assertIsNone(result["total"])
        self.assertEqual(result["status"], "insufficient")
        self.assertEqual([a["state"] for a in result["activities"]], ["exempt", "unreleased"])

    def test_overview_aggregates_per_activity_across_students(self):
        csv = canvas_csv(kc="9", lab="50", extra=["Segundo Aluno", "202", "segundo@example.test", "", "98", "0"])
        snapshot = parse_csv(csv, ["001 KC (123)", "002 Lab (456)"])
        by_id = {a["id"]: a for a in overview(snapshot)["activities"]}
        kc, lab = by_id["001 KC (123)"], by_id["002 Lab (456)"]
        self.assertEqual((kc["completed"], kc["pending"], kc["needsReview"], kc["average"]), (1, 1, 0, 90))
        self.assertEqual((lab["completed"], lab["pending"], lab["needsReview"], lab["average"]), (2, 0, 1, 74))

    def test_overview_activity_with_no_grades_yet_has_no_average(self):
        snapshot = parse_csv(canvas_csv(kc="", lab=""), ["001 KC (123)", "002 Lab (456)"])
        by_id = {a["id"]: a for a in overview(snapshot)["activities"]}
        self.assertEqual((by_id["001 KC (123)"]["completed"], by_id["001 KC (123)"]["pending"]), (0, 1))
        self.assertIsNone(by_id["001 KC (123)"]["average"])

    def test_blank_lines_and_bom_are_ignored(self):
        self.assertEqual(len(parse_csv("\ufeff" + canvas_csv() + "\n\n")["students"]), 1)

    def test_invalid_values_fail_instead_of_becoming_zero(self):
        for value in ("NaN", "Infinity", "-1", "7abc", "11"):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                parse_csv(canvas_csv(kc=value))

    def test_duplicates_fail(self):
        with self.assertRaises(ValidationError):
            parse_csv(canvas_csv(extra=["Outro", "102", "aluno@example.test", "8", "90", "0"]))

    def test_missing_points_or_headers_fail(self):
        for text in ("foo,bar\nx,y", canvas_csv().replace("Points Possible", "Max points")):
            with self.assertRaises(ValidationError):
                parse_csv(text)

    def test_quoted_decimal_comma_and_html_remain_data(self):
        result = self.result(kc="7,5")
        self.assertEqual(result["kc"], 75)
        snap = parse_csv(canvas_csv().replace("Costa, Marina", "<img src=x onerror=alert(1)>, Marina"))
        self.assertIn("<img", snap["students"][0]["name"])

    def test_unknown_activity_selection_fails(self):
        with self.assertRaises(ValidationError):
            parse_csv(canvas_csv(), ["unknown"])

    def test_canvas_test_student_is_excluded_before_activity_inference(self):
        for name in ("aluno, Testar", "Student, Test", "Test Student", "Aluno de teste"):
            with self.subTest(name=name):
                text = canvas_csv(kc="", extra=[name, "999", "a" * 40, "10", "100", "0"])
                snap = parse_csv(text)
                self.assertEqual(len(snap["students"]), 1)
                self.assertFalse(snap["activities"][0]["active"])
                self.assertEqual(snap["activities"][0]["filled"], 0)
                self.assertEqual(snap["warnings"], ["Linha 4: aluno de teste do Canvas ignorado; não entra nas notas da turma."])

    def test_test_name_with_real_email_is_not_discarded(self):
        snap = parse_csv(canvas_csv(extra=["Student, Test", "999", "real@example.test", "10", "100", "0"]))
        self.assertEqual(len(snap["students"]), 2)
        self.assertEqual(snap["warnings"], [])

    def test_real_student_invalid_email_is_rejected_at_actual_line(self):
        for email in ("a" * 40, "invalid"):
            with self.subTest(email=email), self.assertRaisesRegex(ValidationError, r"E-mail inválido na linha 4\."):
                parse_csv(canvas_csv(extra=["Aluno Real", "202", email, "8", "90", "0"]))

    def test_missing_emails_preserve_students_grades_and_activity_inference(self):
        text = canvas_csv(email="", extra=["Outro Aluno", "202", "  ", "8", "90", "0"])
        snap = parse_csv(text)
        self.assertEqual(len(snap["students"]), 2)
        self.assertTrue(all(s["email"] is None for s in snap["students"]))
        self.assertEqual([summary(s, snap["activities"])["kc"] for s in snap["students"]], [70, 80])
        self.assertTrue(all(a["active"] and a["filled"] == 2 for a in snap["activities"]))
        self.assertEqual(len(snap["warnings"]), 2)
        self.assertTrue(snap["warnings"][0].startswith("Linha 3: aluno sem e-mail"))
        self.assertTrue(snap["warnings"][1].startswith("Linha 4: aluno sem e-mail"))

    def test_missing_email_does_not_relax_canvas_id_uniqueness(self):
        with self.assertRaisesRegex(ValidationError, "duplicados"):
            parse_csv(canvas_csv(email="", extra=["Outro Aluno", "101", "", "8", "90", "0"]))

    def test_error_line_survives_blank_lines_multiline_fields_and_test_rows(self):
        text = canvas_csv().replace('"Costa, Marina"', '"Costa,\n Marina"')
        text += '\n"Student, Test",999,' + 'a' * 40 + ',10,100,0\n'
        text += 'Aluno Real,202,invalid,8,90,0\n'
        with self.assertRaisesRegex(ValidationError, r"E-mail inválido na linha 7\."):
            parse_csv(text)

    def test_test_name_with_sis_identity_is_not_discarded(self):
        text = canvas_csv(extra=["Student, Test", "999", "a" * 40, "10", "100", "0"])
        records = list(csv.reader(io.StringIO(text)))
        records[0].append("SIS User ID")
        for row in records[1:]:
            row.append("institutional-id")
        output = io.StringIO()
        csv.writer(output).writerows(records)
        with self.assertRaisesRegex(ValidationError, "E-mail inválido na linha 4"):
            parse_csv(output.getvalue())


if __name__ == "__main__":
    unittest.main()
