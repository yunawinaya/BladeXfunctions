"""commit_reads.py --dev <tenant> <payload.json> <out.json>: COMMIT's C0 / C3 / C3H / C4 / C5 SQL, taken from the built
Goods Delivery/CompleteV2/GD_COMPLETE_COMMIT.json, tokens filled from the payload, run read-only."""
import json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "pkv2tools"))
from dbq import q  # noqa: E402

env, tenant, pfile, out = sys.argv[1:5]
P = json.load(open(pfile))
m = P["manifest"]
def part(name):
    rows = sorted([r for r in P["rows"] if r["step_name"].split("|")[2] == name], key=lambda r: r["step_name"])
    return json.loads("".join(r["result_ref"] for r in rows))
res, so, hu = part("RES"), part("SO"), part("HU")
hu_ids = sorted({str(u["handling_unit_id"]) for u in hu if str(u.get("handling_unit_id") or "").isdigit()}) or ["0"]
ids = [u["id"] for u in res["updates"]] or ["0"]
so_ids = so.get("soIds") or ["0"]
line_ids = [r["so_line_item_id"] for r in so["tableGD"] + so["bundleParents"] if r.get("so_line_item_id")] or ["0"]
fill = {
    "{{node:code_node_CCguard.data.tenantId}}": tenant, "{{node:code_node_CCguard.data.jobId}}": m["job_id"], "{{node:code_node_CCentry.data.gdId}}": m["gd_id"],
    "{{node:code_node_CCc3ids.data.idsJson}}": json.dumps(ids), "{{node:code_node_CCc3ids.data.createLike}}": m["job_id"] + "|C|%",
    "{{node:code_node_CCc4ids.data.soIdsJson}}": json.dumps(so_ids), "{{node:code_node_CCc4ids.data.lineIdsJson}}": json.dumps(line_ids),
    "{{node:code_node_CCc0ids.data.idsJson}}": json.dumps(ids), "{{node:code_node_CCc0ids.data.huIdsJson}}": json.dumps(hu_ids), "{{node:code_node_CCc3hids.data.idsJson}}": json.dumps(hu_ids),
    "{{node:code_node_CCentry.data.force}}": "Yes" if m.get("force") == 1 else "",
}
doc = json.load(open(os.path.join(HERE, "..", "..", "..", "Goods Delivery", "CompleteV2", "GD_COMPLETE_COMMIT.json")))
nodes = {}
def walk(o):
    if isinstance(o, dict):
        if o.get("type") == "sql-node": nodes[o["id"]] = o["data"]["script"]["code"]
        for v in o.values(): walk(v)
    elif isinstance(o, list):
        for v in o: walk(v)
walk(doc)
result = {}
for key, nid in [("c0rows", "sql_node_CCc0rows"), ("c0hus", "sql_node_CCc0hus"), ("c0huitems", "sql_node_CCc0huitems"), ("c3rows", "sql_node_CCc3rows"), ("c3hhus", "sql_node_CCc3hhus"), ("c3hitems", "sql_node_CCc3hitems"), ("c3hprec", "sql_node_CCc3hprec"), ("c4lines", "sql_node_CCc4lines"), ("c4hdrs", "sql_node_CCc4hdrs"), ("c5raw", "sql_node_CCc5raw")] + (
        [("c0pick", "sql_node_CCc0pick"), ("c0fp", "sql_node_CCc0fp")] if m.get("force") == 1 else []):
    sql = nodes[nid]
    for a, b in fill.items(): sql = sql.replace(a, b)
    left = re.findall(r"\{\{[^}]+\}\}", sql)
    assert not left, (nid, left)
    rows = q(env, sql)
    result[key] = [{k: (str(v) if v is not None else None) for k, v in r.items()} for r in rows]
    print(f"{key:8s} rows={len(rows)}")
json.dump(result, open(out, "w"))
