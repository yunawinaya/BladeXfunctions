"""PO_Convert_GR code_node_PoGrMap old vs new on every recorded dev run, through phase0's run_js.
usage: python3 test_po_convert.py <fixtures_dir>   (fixtures from pull_fixtures.py)"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "phase0"))
from test_guards import run_js  # noqa: E402

OLD = open(os.path.join(HERE, "PoGrMap_old.js"), encoding="utf-8").read()
NEW = open(os.path.join(HERE, "PoGrMap_new.js"), encoding="utf-8").read()


class Absent(dict):
    """run_js values: the recorded variable map; a param the run predates resolves to null."""

    def __missing__(self, key):
        if key.startswith("workflowparams:"):
            return "null"
        raise KeyError(key)

    def __contains__(self, key):
        return True


fails = 0
runs = json.load(open(os.path.join(sys.argv[1], "po_convert_runs.json"), encoding="utf-8"))
for run in runs:
    values = Absent({k: json.dumps(v, ensure_ascii=False) for k, v in run["variableMap"].items()})
    a, b = run_js(OLD, values), run_js(NEW, values)
    same = json.dumps(a, sort_keys=False) == json.dumps(b, sort_keys=False)
    out = a.get("grData") or a.get("grList")
    print(("ok   " if same else "FAIL ") + "run %s code %s gr_data/gr_list identical: %s (%d B)"
          % (run["id"], a.get("result_code"), same, len(json.dumps(out or ""))))
    fails += 0 if same else 1
print("failures:", fails)
sys.exit(1 if fails else 0)
