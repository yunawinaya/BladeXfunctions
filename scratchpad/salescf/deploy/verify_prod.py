"""verify_prod.py: after the user's prod paste of the sales header custom fields, is each item live on PROD as pasted? Compares
each item's enabled prod version (by workflow / form id, so look-alike names and shared node ids cannot fool it) with its
paste file: PASTED = identical, NOT YET = prod still runs the base file, DIFFERS = something else is live. Read-only.

usage: python3 scratchpad/salescf/deploy/verify_prod.py [si] [gd]
"""
import glob
import json
import os
import re
import subprocess
import sys

R = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
V = json.load(open(os.path.join(R, "scratchpad", "salescf", "base", "prod", "versions.json")))
LABEL = {"SalesInvoice_form": "form_sales_invoice", "GoodsDelivery_form": "form_goods_delivery"}
# the GD session's cache-key fix (10-27), pasted on top of this project's two converters: compared without that node's code
THEIRS = {"GD_Convert_SI": ("code_node_YRozjK8Z",), "SO_Convert_SI": ("code_node_YRozjK8Z",)}


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

def q(sql):
    p = subprocess.run([os.path.join(R, ".dbtools", "db"), "--prod", "--json", sql], capture_output=True, text=True)
    return json.loads("\n".join(l for l in p.stdout.splitlines() if not l.startswith("[PROD]")))


fails = 0
for part in sys.argv[1:] or ["si", "gd"]:
    for paste in sorted(glob.glob(os.path.join(R, "prod-hotfix", "2026-10-27-sales-header-cf-" + part, "*.prod_paste.json"))):
        label = re.match(r"\d+_(.+)\.prod_paste\.json$", os.path.basename(paste)).group(1)
        name = LABEL.get(label, label)
        v = V[name]
        table, col = ("su_code_workflow_history", "script_json") if v["kind"] == "workflow" else ("su_code_tables_history", "form_json")
        r = q("SELECT version_number v, create_time t, %s s FROM %s WHERE data_id=%s AND status='enabled' ORDER BY id DESC LIMIT 1"
              % (col, table, v["dataId"]))[0]
        live = json.loads(r["s"])
        base = json.load(open(glob.glob(paste.replace(".prod_paste.json", ".prod_v*_base.json"))[0], encoding="utf-8"))
        want = json.load(open(paste, encoding="utf-8"))
        state = "PASTED" if live == want else "NOT YET (base)" if live == base else "DIFFERS"
        if state == "DIFFERS" and name in THEIRS:
            for nid in THEIRS[name]:
                for doc in (live, want):
                    find(doc, nid)["data"]["script"]["code"] = ""
            state = "PASTED (+ GD session's %s)" % ", ".join(THEIRS[name]) if live == want else state
        old = paste.replace(".prod_paste.json", ".prod_v48_pasted.json")
        if state == "DIFFERS" and os.path.exists(old) and live == json.load(open(old, encoding="utf-8")):
            state = "OLD PASTE (v48, cf declared string): re-paste this item"
        print("%-3s %-20s id %s  prod v%-5s %s  %s" % (part, name, v["dataId"], r["v"], r["t"], state))
        fails += 0 if state.startswith("PASTED") else 1
sys.exit(1 if fails else 0)
