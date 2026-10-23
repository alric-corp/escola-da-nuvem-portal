#!/usr/bin/env python3
"""Administrative reconciliation, dry-run by default. Never invoked by the API."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from derived_access import disable, migrate
from repository import Repository


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="explicitly persist derived records")
    parser.add_argument("--cutover-discovery", action="store_true", help="enable discovery only after full reconciliation")
    parser.add_argument("--disable", action="store_true", help="return to legacy readers before code rollback; no deletion")
    parser.add_argument("--only", choices=("discovery", "history"), help="independent projection reconciliation")
    parser.add_argument("--cohort", action="append", help="resume selected cohorts (cannot cut over globally)")
    args = parser.parse_args()
    if args.disable:
        if args.cutover_discovery or args.cohort:
            parser.error("--disable cannot be combined with cutover or selected cohorts")
        result = disable(Repository(), apply=args.apply, discovery=args.only != "history", history=args.only != "discovery")
    else:
        result = migrate(Repository(), apply=args.apply, cutover=args.cutover_discovery,
                         discovery=args.only != "history", history=args.only != "discovery", codes=args.cohort)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
