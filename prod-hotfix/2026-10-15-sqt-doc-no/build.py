#!/usr/bin/env python3
"""BUG-20261015-021 (De Carton and 5 other tenants): quotation save consumes two numbers.

SQT_SAVE_V2 is a PreAdd/PreUpdate table event on Quotation (prod only; dev deleted it on 2026-08-05).
Its Check Doc No resets sqt_no to the 'issued' sentinel whenever previous_status !== "Issued". SQT_SAVE's
follow-up update after numbering carries previous_status NULL (new quotation) or "Draft" (Draft -> Issued),
so every issue burns the number SQT_SAVE just allocated and takes the next one. Prod runs 2026-09-15..10-14:
44 of 44 resets replaced a real issued number; none was a Draft number being promoted.

Fix: number only a quotation that has no number. SQT_SAVE's own Check Doc No already writes the sentinel
for new and Draft -> Issued saves (web and mobile both save through SQT_SAVE).

  python3 build.py          # fetch prod SQT_SAVE_V2, patch, write SQT_SAVE_V2.prod.json
  python3 build.py --check  # same, print the diff only
"""
import difflib, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(HERE, "SQT_SAVE_V2.prod.json")
WF_ID = 1997959200371458049
NODE = "code_node_HbSgL6QL"

OLD = """if (
  {{table:sqt_no_type}} !== -9999 &&
  (!{{table:sqt_no}} ||
    {{table:sqt_no}} === null ||
    {{table:sqt_no}} === "" ||
    {{table:previous_status}} !== "Issued")
) {
  table.sqt_no = 'issued'
}"""
NEW = """// SQT_SAVE already marks new and Draft -> Issued saves; never renumber a quotation that has a number.
if (
  {{table:sqt_no_type}} !== -9999 &&
  (!{{table:sqt_no}} ||
    {{table:sqt_no}} === null ||
    {{table:sqt_no}} === "")
) {
  table.sqt_no = 'issued'
}"""


def fetch():
    # Table-event workflow with no su_code_workflow_history rows in prod: the working copy is what runs
    # (its 24 code bodies equal the script stored on run 2110280476215349249).
    out = subprocess.run([os.path.join(ROOT, ".dbtools", "db"), "--prod", "--json",
                          f"SELECT version_number, update_time, script_json FROM su_code_workflow WHERE id={WF_ID}"],
                         capture_output=True, text=True, check=True).stdout
    row = json.loads(out)[0]
    print(f"  prod SQT_SAVE_V2 v{row['version_number']} (working copy, updated {str(row['update_time'])[:19]})")
    return json.loads(row["script_json"])


def find(n, nid):
    if isinstance(n, dict):
        if n.get("id") == nid:
            return n
        for v in n.values():
            r = find(v, nid)
            if r is not None:
                return r
    elif isinstance(n, list):
        for v in n:
            r = find(v, nid)
            if r is not None:
                return r
    return None


def main():
    base = fetch()
    doc = json.loads(json.dumps(base))
    script = find(doc, NODE)["data"]["script"]
    if script["code"].count(OLD) != 1:
        sys.exit(f"  {NODE}: baseline text not found exactly once -- prod drifted, re-check before patching")
    script["code"] = script["code"].replace(OLD, NEW)

    a = json.dumps(base, indent=2, ensure_ascii=False).splitlines()
    b = json.dumps(doc, indent=2, ensure_ascii=False).splitlines()
    print("\n".join(difflib.unified_diff(a, b, "prod", "patched", lineterm="", n=0)))
    if "--check" not in sys.argv:
        with open(OUT, "w") as f:
            f.write(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
        print(f"  wrote {os.path.relpath(OUT, ROOT)}")


main()
