"""Replay code_node_CfNeed<n> on recorded DEV runs that reached its update node: placeholders from that run's own node
outputs and request params. Web-form edits should answer NO (no read on the common path).   python3 replay_cf.py [N]"""
import collections
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "grv2"))
from dbq import q  # noqa: E402
from patch_cf import CFG, nodes_of  # noqa: E402

PH = re.compile(r"\{\{([^}]+)\}\}")
LIMIT = int(sys.argv[1]) if len(sys.argv) > 1 else 15


def lookup(path, outs, params):
    kind, rest = path.split(":", 1)
    parts = rest.split(".")
    if kind == "node":
        cur = outs.get(parts[0])
        parts = parts[1:]
    elif kind == "workflowparams":
        cur = params
    else:
        raise KeyError(path)
    for p in parts:
        if isinstance(cur, str):
            try:
                cur = json.loads(cur)
            except Exception:
                return None
        if isinstance(cur, list) and p.isdigit():
            cur = cur[int(p)] if int(p) < len(cur) else None
        elif isinstance(cur, dict):
            cur = cur.get(p)
        else:
            return None
    return cur


def run(code, outs, params):
    src = "const __f = () => {\n" + PH.sub(lambda m: json.dumps(lookup(m.group(1), outs, params), ensure_ascii=False), code) + \
          "\n};\nprocess.stdout.write(JSON.stringify(__f()));"
    r = subprocess.run(["node", "-e", src], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr[:300])
    return json.loads(r.stdout)


for name, (updates, *_rest) in sorted(CFG.items()):
    doc = json.load(open(os.path.join(HERE, "out", name + ".json")))
    wid = json.load(open(os.path.join(HERE, "base", "versions.json")))[name]["dataId"]
    rows = q("--dev", f"SELECT CAST(id AS CHAR) id, create_time t FROM su_code_workflow_inst WHERE workflow_id = {wid} AND LENGTH(nodes_data) < 8000000 ORDER BY id DESC LIMIT {LIMIT}")
    c = collections.Counter()
    for r in rows:
        full = q("--dev", f"SELECT request_json_data rq, nodes_data nd FROM su_code_workflow_inst WHERE id = {r['id']}")[0]
        outs = {}
        for n in json.loads(full["nd"] or "[]"):
            try:
                body = json.loads(n.get("response_json_data")) if isinstance(n.get("response_json_data"), str) else n.get("response_json_data")
            except Exception:
                body = None
            outs[n.get("node_id")] = body if not isinstance(body, dict) or "data" in body else {"data": body}
        params = (json.loads(full["rq"] or "{}").get("workflowparams")) or {}
        for i, uid in enumerate(updates, 1):
            code = nodes_of(doc)["code_node_CfNeed%d" % i][0]["data"]["script"]["code"]
            src = re.search(r"\[\{\{node:([A-Za-z0-9_]+)\.", code)
            if src and src.group(1) not in outs:
                continue
            web = "web" if "$_v" in json.dumps(params)[:200000] else "other"
            try:
                got = run(code, outs, params)
                c[(web, uid, got["need"])] += 1
            except Exception as e:
                c[(web, uid, "ERROR " + str(e)[:80])] += 1
    print("==", name, "| replayed", len(rows), "recorded runs")
    for k, v in sorted(c.items()):
        print("    ", k, v)
