"""verify_dev.py: every item of the sales header custom fields project is live on DEV exactly as built (enabled version ==
out/dev/<NAME>.json), and the repo copies equal dev (.dbtools/wf --dev deployed). GD_COMPLETE_SUBMIT is the GD session's
since its v15 (G7 ported into their sources): there the check is that G7 is in the live version. Read-only.

usage: python3 scratchpad/salescf/deploy/verify_dev.py
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
R = os.path.abspath(os.path.join(PROJ, "..", ".."))
V = json.load(open(os.path.join(PROJ, "base", "dev", "versions.json")))
REPO = ["Sales Invoice/SIsaveWorkflow.json", "Sales Invoice/SOconvertSIworkflow.json", "Sales Invoice/GDconvertSIworkflow.json",
        "Sales Order/SOsaveWorkflow.json", "Goods Delivery/GDheadWorkflow.json", "Goods Delivery/AsyncV2/GD_BULK_PREPARE.json",
        "Goods Delivery/AsyncV2/GD_BULK_COMMIT.json", "Goods Delivery/SOconvertGDCreatedWorkflow.json", "Goods Delivery/SOconvertGDworkflow.json"]


# other sessions' changes on top of this project's versions (10-27, GD session): GOODS_DELIVERY v252 adds a tenant filter to
# two guard SQLs; GD_Convert_SI v32 / SO_Convert_SI v60 add a random tag to the run's Redis key name
THEIRS = {"GOODS_DELIVERY": ("sql_node_GdSoGuard", "sql_node_GdUomGuard"),
          "GD_Convert_SI": ("code_node_YRozjK8Z",), "SO_Convert_SI": ("code_node_YRozjK8Z",)}


def q(sql):
    p = subprocess.run([os.path.join(R, ".dbtools", "db"), "--dev", "--json", sql], capture_output=True, text=True)
    return json.loads("\n".join(l for l in p.stdout.splitlines() if not l.startswith("[DEV]")))


def find(o, nid):
    if isinstance(o, dict):
        if o.get("id") == nid:
            return o
        for v in o.values():
            r = find(v, nid)
            if r is not None:
                return r
    elif isinstance(o, list):
        for v in o:
            r = find(v, nid)
            if r is not None:
                return r
    return None


fails = 0
for name, v in sorted(V.items()):
    table, col = ("su_code_workflow_history", "script_json") if v["kind"] == "workflow" else ("su_code_tables_history", "form_json")
    r = q("SELECT version_number v, %s s FROM %s WHERE data_id=%s AND status='enabled' ORDER BY id DESC LIMIT 1" % (col, table, v["dataId"]))[0]
    if name == "GD_COMPLETE_SUBMIT":
        live = json.dumps(json.loads(r["s"]))
        same = all(s in live for s in ("'cf_defs', (SELECT JSON_OBJECTAGG", "const gsCfKey = function gsCfKey(", 'changed.push(\\"custom_fields\\")'))
        print("%-20s dev v%-5s %s" % (name, r["v"], "G7 LIVE (GD session's version)" if same else "G7 MISSING"))
        fails += 0 if same else 1
        continue
    live, built = json.loads(r["s"]), json.load(open(os.path.join(PROJ, "out", "dev", name + ".json"), encoding="utf-8"))
    # nodes another session changed on top of this project's version (their SQL only), compared without their code
    for nid in THEIRS.get(name, ()):
        for doc in (live, built):
            find(doc, nid)["data"]["script"]["code"] = ""
    same = live == built
    print("%-20s dev v%-5s %s" % (name, r["v"], ("IDENTICAL to out/dev" + (" (+ GD session's %s)" % ", ".join(THEIRS[name]) if name in THEIRS else ""))
                                  if same else "DIFFERS"))
    fails += 0 if same else 1
for f in REPO:
    out = subprocess.run([os.path.join(R, ".dbtools", "wf"), "--dev", "deployed", f], capture_output=True, text=True, cwd=R).stdout
    ok = "IDENTICAL" in out
    print("repo %-48s %s" % (f, "IDENTICAL" if ok else "DIFFERS"))
    fails += 0 if ok else 1
print("ALL LIVE AS BUILT" if not fails else "%d DIFFER" % fails)
sys.exit(1 if fails else 0)
