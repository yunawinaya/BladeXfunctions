"""Write code/outputs.json: what the builder declares and embeds for the plan-core nodes - each node's body files (joined
with "\\n"), its returned keys with the arrays / objects among them (wfkit K.code(arrays=, objects=): an object or a number
the platform must keep as is), and every read's node key, round, columns and title (sql_node_VP<key> / sql_node_VS<key>).

usage: python3 outputs.py           (writes code/outputs.json)
       python3 outputs.py --check   (exit 1 when code/outputs.json is not what this gives)
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "lift"))
from sql import ROUND1, ROUND2, SUBMIT_SQL, COLUMNS, SUBMIT_COLUMNS, TITLES  # noqa: E402
import lift  # noqa: E402

OUT = os.path.join(ROOT, "code", "outputs.json")
BASE = ["lift/runtime.js", "lift/lifted_prepare.js", "code/prepare/adapter.js"]


def build():
    nodes = lift.nodes_by_id(lift.SOURCES[0][0])
    prep_decl = [(r["name"], r.get("bsonType")) for r in nodes["code_node_grRvPrep"]["data"]["response_json"]]
    own = ["route", "code", "message", "unlockOk", "revertFrom", "lineCount", "refuse", "refuseMessage"]
    sql_vals = ["sqlMinLiveId", "sqlPlantId", "sqlItemIds", "sqlBatchIds", "sqlHuIds", "sqlPoIds", "sqlPoLineIds"]
    prep_fields = own + [n for n, _ in prep_decl if n not in own] + sql_vals
    out = {
        "files": {
            "VPprep": BASE + ["code/prepare/prep.js", "code/prepare/prep_tail.js"],
            "VPplan": BASE + ["code/prepare/plan.js", "code/prepare/plan_tail.js"],
            "VSgate": BASE + ["code/prepare/prep.js", "code/submit/gate.js", "code/submit/gate_tail.js"],
        },
        "VPprep": {
            "fields": prep_fields,
            "arrays": [n for n, t in prep_decl if t == "array"],
            "objects": ["unlockOk", "lineCount", "refuse"] + [n for n, t in prep_decl if t in ("int", "any") and n != "refuse"],
        },
        "VPplan": {
            "fields": ["route", "code", "message", "payload", "partRows", "lineCount", "movementCount", "unlockOk", "previousStatus", "errorDetails"],
            "arrays": ["partRows"],
            "objects": ["lineCount", "movementCount", "unlockOk"],
        },
        "VSgate": {
            "fields": ["route", "code", "message", "reason", "lineCount", "previousStatus"],
            "arrays": [],
            "objects": ["lineCount"],
        },
        "sql": {k: {"round": 1 if k in ROUND1 else 2, "cols": COLUMNS[k], "title": TITLES[k]} for k in list(ROUND1) + list(ROUND2)},
        "submit_sql": {k: {"cols": SUBMIT_COLUMNS[k], "title": TITLES[k]} for k in SUBMIT_SQL},
    }
    for f in [x for v in out["files"].values() for x in v]:
        assert os.path.exists(os.path.join(ROOT, f)), f
    return json.dumps(out, indent=1) + "\n"


def main():
    text = build()
    if "--check" in sys.argv:
        same = os.path.exists(OUT) and open(OUT).read() == text
        print(("IDENTICAL" if same else "DIFFERS") + ": " + OUT)
        sys.exit(0 if same else 1)
    open(OUT, "w").write(text)
    print(OUT)


if __name__ == "__main__":
    main()
