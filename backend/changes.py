"""Comparações de publicações; relatórios pessoais recebem só o próprio aluno."""
from decimal import Decimal

from grades import summary


def same_grade(a, b):
    """Compara notas como número: o CSV exportado traz "7.00" e a API do Canvas, "7"."""
    if a in (None, "EX") or b in (None, "EX"):
        return a == b
    return Decimal(a) == Decimal(b)


def snapshot_changes(before, after):
    before = before or {"students": [], "activities": []}
    old = {s["id"]: s for s in before["students"]}
    new = {s["id"]: s for s in after["students"]}
    old_a = {a["id"]: a for a in before["activities"]}
    new_a = {a["id"]: a for a in after["activities"]}
    student_ref = lambda s: {"id": s["id"], "name": s["name"]}
    activity_ref = lambda a: {"id": a["id"], "name": a["name"]}
    grades = []
    grade_count = 0
    for sid in sorted(old.keys() & new.keys()):
        for aid in sorted(old_a.keys() & new_a.keys()):
            previous, current = old[sid]["grades"].get(aid), new[sid]["grades"].get(aid)
            if not same_grade(previous, current):
                grade_count += 1
                if len(grades) < 100:
                    grades.append({"student": new[sid]["name"], "activity": new_a[aid]["name"],
                                   "before": previous, "after": current})
    return {"previousCount": len(old), "currentCount": len(new),
            "studentsAdded": [student_ref(new[k]) for k in sorted(new.keys() - old.keys())],
            "studentsRemoved": [student_ref(old[k]) for k in sorted(old.keys() - new.keys())],
            "studentsUpdated": [student_ref(new[k]) for k in sorted(old.keys() & new.keys())
                                if any(old[k].get(f) != new[k].get(f) for f in ("name", "email", "graduated"))],
            "activitiesAdded": [activity_ref(new_a[k]) for k in sorted(new_a.keys() - old_a.keys())],
            "activitiesRemoved": [activity_ref(old_a[k]) for k in sorted(old_a.keys() - new_a.keys())],
            "activitiesReleased": [activity_ref(new_a[k]) for k in new_a
                                   if new_a[k]["active"] and not old_a.get(k, {}).get("active")],
            "activitiesPaused": [activity_ref(old_a[k]) for k in old_a
                                 if old_a[k]["active"] and not new_a.get(k, {}).get("active")],
            "scalesChanged": [activity_ref(new_a[k]) for k in sorted(old_a.keys() & new_a.keys())
                              if old_a[k]["points"] != new_a[k]["points"]],
            "gradesChanged": grade_count, "gradeDetails": grades}


def change_counts(changes):
    return {key: len(value) if isinstance(value, list) else value
            for key, value in changes.items() if key != "gradeDetails"}


def student_history(before, snapshot, thresholds=None):
    """Resumo por aluno (médias e comparação com a publicação anterior), gravado uma vez
    na publicação para que o relatório do aluno não precise reler snapshots antigos."""
    before = before or {"students": [], "activities": []}
    prior_by_id = {s["id"]: s for s in before["students"]}
    result = {}
    for student in snapshot["students"]:
        s = summary(student, snapshot["activities"], thresholds)
        result[student["id"]] = {
            "kc": s["kc"], "lab": s["lab"], "total": s["total"],
            "changes": student_changes(prior_by_id.get(student["id"]), before["activities"], student,
                                        snapshot["activities"], thresholds),
        }
    return result


def student_changes(before_student, before_activities, student, activities, thresholds=None):
    if before_student is None:
        return None
    previous = summary(before_student, before_activities, thresholds)
    current = summary(student, activities, thresholds)
    old = {a["id"]: a for a in previous["activities"]}
    new = {a["id"]: a for a in current["activities"]}
    updates = []
    for aid, activity in new.items():
        prior = old.get(aid)
        if not prior or any(prior.get(k) != activity.get(k) for k in ("state", "percent", "points")):
            updates.append({"name": activity["name"], "before": prior["percent"] if prior else None,
                            "after": activity["percent"], "previousState": prior["state"] if prior else None,
                            "state": activity["state"]})
    return {"kc": round(current["kc"] - previous["kc"], 2) if current["kc"] is not None and previous["kc"] is not None else None,
            "lab": round(current["lab"] - previous["lab"], 2) if current["lab"] is not None and previous["lab"] is not None else None,
            "pendingBefore": previous["pending"], "pendingAfter": current["pending"],
            "activities": updates, "removed": [old[k]["name"] for k in old.keys() - new.keys()]}
