"""alloc_rows.py <fixture.json>...: the auto allocation's reads (prepare/sql.py aitem / abal / ares / aref) executed READ-ONLY on
dev for each recorded run that allocated, with the materials and SO lines its GLOBAL_ALLOCATION calls asked for (the GD's
lines are allocated by now, so the stored-line part finds nothing), saved as ../gde-allocrows/<fixture file name> for
test_alloc_shape.js. Only SELECTs run; the rows stay in the session scratchpad.

usage: python3 alloc_rows.py <fixture.json>...
"""
import importlib.util, json, os, re, sys

sys.path.insert(0, "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/pkv2tools")
from dbq import q  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("gde_prepare_sql", os.path.join(HERE, "..", "prepare", "sql.py"))
S = importlib.util.module_from_spec(spec)
spec.loader.exec_module(S)
BIG = re.compile(r'"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])')


def P(t):
    return json.loads(BIG.sub(lambda m: m.group(0) if m.group(0)[0] == '"' else '"' + m.group(0) + '"', t or "{}"))


for path in sys.argv[1:]:
    fx = json.load(open(path))
    if not fx.get("alloc"):
        continue
    all_data = (P(fx["head"]["request_json_data"]).get("workflowparams") or {}).get("allData") or {}
    asks = [(P(k["request_json_data"]).get("workflowparams") or P(k["request_json_data"]).get("request_json") or {}) for k in fx["alloc"]]
    mats = sorted({str(a.get("material_id")) for a in asks if str(a.get("material_id") or "").isdigit()})
    lines = sorted({str(a.get("parent_line_id")) for a in asks if str(a.get("parent_line_id") or "").isdigit()})
    tok = {"tenantId": str(fx["tenant_id"]), "gdId": str(all_data.get("id")), "organizationId": str(all_data.get("organization_id")),
           "deltaAllocMaterialIdsSql": ",".join(mats) or "0", "deltaAllocLineIdsSql": "0", "deltaSoLineIdsQuoted": ",".join("'%s'" % x for x in lines) or "'0'"}
    assert all(re.fullmatch(r"[0-9,']+", v) for v in tok.values()), tok
    out = {}
    for key in ("aitem", "abal", "ares", "aref"):
        sql = re.sub(r"\{\{node:code_node_GEentry\.data\.(\w+)\}\}", lambda m: tok[m.group(1)], S.SQL[key])
        assert sql.lstrip().upper().startswith("SELECT") and "{{" not in sql, key
        out[key] = q("--dev", sql)
    dst_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(path))), "gde-allocrows")
    os.makedirs(dst_dir, exist_ok=True)
    dst = os.path.join(dst_dir, os.path.basename(path))
    json.dump({"tokens": tok, "rows": out}, open(dst, "w"))
    print(os.path.basename(path), fx.get("doc_no"), {k: len(v) for k, v in out.items()}, "materials", len(mats))
