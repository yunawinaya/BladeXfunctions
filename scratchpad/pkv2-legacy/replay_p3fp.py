"""The P3 (Full Picking) recount over GD lines the old PICKING already wrote: nothing to write = same values (read-only)."""
import json, re, subprocess, sys
sys.path.insert(0, "..")
from dbq import q

def node(wf, nid):
    d = json.load(open("stage/%s.json" % wf))
    def walk(n):
        if isinstance(n, dict):
            if n.get("id") == nid:
                return n
            for v in n.values():
                r = walk(v)
                if r:
                    return r
        elif isinstance(n, list):
            for v in n:
                r = walk(v)
                if r:
                    return r
    return walk(d)["data"]["script"]["code"]

for env, tenant, pid, label in [("--dev", "000000", "2109854593336840193", "dev PI-20261013-0348"), ("--prod", "128671", "2109684632214704129", "prod PI-20261013-1502")]:
    lines = q(env, "SELECT DISTINCT CAST(gd_line_id AS CHAR) gl FROM transfer_order_jz8m9w3h_sub WHERE tenant_id='%s' AND transfer_order_id=%s AND is_deleted=0 AND gd_line_id IS NOT NULL" % (tenant, pid))
    sql = re.sub(r"\{\{node:([^}]+)\}\}", lambda m: {"tenantId": tenant, "gdLineIdsSql": ",".join(r["gl"] for r in lines)}[m.group(1).split(".")[-1]], node("PICKING_BULK_COMMIT", "sql_node_PCp3fpFacts"))
    facts = q(env, sql)
    js = node("PICKING_BULK_COMMIT", "code_node_PCp3fpPlan").replace("[{{node:get_cache_PCp3fpSt.data}}][0]", "[0,0,0,0]").replace("[{{node:sql_node_PCp3fpFacts.data}}][0]", "FACTS")
    prog = "const FACTS = JSON.parse(require('fs').readFileSync(0, 'utf8'));\nconst out = (function(){\n" + js + "\n})();\nconst rows = out.slices.flatMap(s => s.rows);\nconsole.log(JSON.stringify({count: out.count, lines: out.lines, rows: rows.slice(0, 400)}));"
    r = subprocess.run(["node", "-e", prog], input=json.dumps(facts), capture_output=True, text=True)
    if r.returncode:
        print(r.stderr[:800]); continue
    out = json.loads(r.stdout.strip().splitlines()[-1])
    stored = {f["id"]: f for f in facts if f["kind"] == "L"}
    why = {}
    for w in out["rows"]:
        s = stored[w["id"]]
        diffs = []
        if (s["picking_status"] or "") != w["picking_status"]: diffs.append("status")
        if round(float(s["picked_qty"] or 0), 3) != w["picked_qty"]: diffs.append("qty")
        if (s["picked_view_stock"] or "") != w["picked_view_stock"]: diffs.append("view")
        if (s["prev_temp_qty_data"] or "") != w["prev_temp_qty_data"]: diffs.append("prev")
        try:
            a = sorted((e["location_id"], e.get("batch_id"), e.get("handling_unit_id"), round(float(e["gd_quantity"]), 3)) for e in json.loads(s["picked_temp_qty_data"] or "[]"))
            b = sorted((e["location_id"], e.get("batch_id"), e.get("handling_unit_id"), round(float(e["gd_quantity"]), 3)) for e in json.loads(w["picked_temp_qty_data"]))
            if a != b: diffs.append("bins")
        except Exception:
            diffs.append("bins?")
        why[",".join(diffs)] = why.get(",".join(diffs), 0) + 1
    print(label, "| lines recounted", out["lines"], "| to write", out["count"], "| differences:", why)
    if out["rows"]:
        w = out["rows"][0]; s = stored[w["id"]]
        for k in ["picking_status", "picked_qty", "picked_view_stock", "prev_temp_qty_data", "picked_temp_qty_data"]:
            print("   ", k, "| stored:", repr((s[k] or "")[:150]), "| recount:", repr(str(w[k])[:150]))
