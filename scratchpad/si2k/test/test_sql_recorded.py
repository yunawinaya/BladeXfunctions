"""test_sql_recorded.py <cache dir> <SI_SAVE run id> [env]: SI_SAVE v84's order / delivery line sql-nodes run today on that run's
documents (read-only), shaped by siShape, against what v83's search nodes returned in the recorded run. Static columns must match;
invoice_qty / si_status are reported separately (the run itself moved them)."""
import json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "grv2"))
sys.path.insert(0, HERE)
from dbq import q  # noqa: E402
import test_sql_save as T  # noqa: E402

cache, run_id = sys.argv[1], sys.argv[2]
env = sys.argv[3] if len(sys.argv) > 3 else "dev"
r = json.load(open(os.path.join(cache, "runs", "%s_SI_SAVE_%s.json" % (env, run_id))))
prog = ("const L = require(%s); const r = JSON.parse(require('fs').readFileSync(0,'utf8')); const out = {};"
        "for (const x of L.parseJ(r.nodes_data) || []) if (x && /search_node_(NDKdFanY|lTy219I0)/.test(x.node_id)) out[x.node_id] = L.parseJ(x.response_json_data);"
        "process.stdout.write(JSON.stringify(out));") % json.dumps(os.path.join(HERE, "..", "sim", "lib.js"))
rec = json.loads(subprocess.run(["node", "-e", prog], input=json.dumps(r), capture_output=True, text=True).stdout)
STATIC = {"table_so": [k for k in T.SO_KEYS if k not in ("invoice_qty", "si_status")], "table_gd": [k for k in T.GD_KEYS if k not in ("invoice_qty", "si_status")]}
for nid, kind, sql, key, line_key in (("search_node_NDKdFanY", "SO", T.B.SQL_SO, "soIdsSql", "table_so"), ("search_node_lTy219I0", "GD", T.B.SQL_GD, "gdIdsSql", "table_gd")):
    docs = ((rec.get(nid) or {}).get("data") or {}).get("data") or []
    for doc in docs:
        rows = q("--dev" if env == "dev" else "--prod", T.fill(sql, str(r["tenant_id"]), key, [str(doc["id"])]))
        mine = T.shape(rows, line_key)
        a_all = T.project((mine[0] if mine else {}).get(line_key), T.SO_KEYS if kind == "SO" else T.GD_KEYS)
        b_all = T.project(doc.get(line_key), T.SO_KEYS if kind == "SO" else T.GD_KEYS)
        a = T.project((mine[0] if mine else {}).get(line_key), STATIC[line_key])
        b = T.project(doc.get(line_key), STATIC[line_key])
        n = lambda t: sum(1 + len(x.get("children", [])) for x in t)
        same = json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
        moved = sum(1 for x, y in zip(a_all, b_all) if json.dumps(x, sort_keys=True) != json.dumps(y, sort_keys=True))
        print("%s %s %s: %d lines (%d top) static columns %s; %d top rows with invoice_qty / si_status moved since the run" % (
            "ok  " if same else "FAIL", kind, doc["id"], n(a), len(a), "same" if same else "DIFFER", moved))
        if not same:
            for x, y in zip(a, b):
                if json.dumps(x, sort_keys=True) != json.dumps(y, sort_keys=True):
                    print("   sql:", json.dumps(x, sort_keys=True)[:300]); print("   rec:", json.dumps(y, sort_keys=True)[:300]); break
