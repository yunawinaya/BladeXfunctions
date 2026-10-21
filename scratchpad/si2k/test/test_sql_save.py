"""test_sql_save.py [SO:id | GD:id ...]: runs SI_SAVE v84's order / delivery line sql-nodes on dev (read-only) and checks that, once
shaped by siShape (code/si_check.js), they give the same lines (for the columns they read) as the platform's own read of the same
documents (sudu-lowcode data query, the read path v83's search nodes used). Without ids: bundle documents, the largest documents
and recent documents of tenant 000000 (the CLI's tenant)."""
import json, os, re, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "grv2"))
sys.path.insert(0, os.path.join(HERE, ".."))
from dbq import q  # noqa: E402
_saved_argv, argv = sys.argv, sys.argv[1:] if __name__ == "__main__" else []
sys.argv = sys.argv[:1]
import build_si_save as B  # noqa: E402
sys.argv = _saved_argv

SO_KEYS = ["id", "parent_id", "item_name", "item_id", "item_bundle_id", "so_quantity", "return_qty", "invoice_qty", "si_status"]
GD_KEYS = ["id", "parent_id", "material_id", "material_name", "item_bundle_id", "gd_qty", "return_qty", "invoice_qty", "si_status"]


def fill(sql, tenant, ids_key, ids):
    return sql.replace("{{node:code_si_prep.data.tenantId}}", tenant).replace("{{node:code_si_prep.data.%s}}" % ids_key, ",".join(ids))


def shape(rows, line_key):
    js = open(os.path.join(HERE, "..", "code", "si_check.js")).read()
    prog = js + "\nconst rows = JSON.parse(require('fs').readFileSync(0, 'utf8'));\nprocess.stdout.write(JSON.stringify(siShape(rows, %s)));" % json.dumps(line_key)
    out = subprocess.run(["node", "-e", prog], input=json.dumps(rows), capture_output=True, text=True)
    if out.returncode:
        raise RuntimeError(out.stderr)
    return json.loads(out.stdout)


def platform(coll, doc_id):
    out = subprocess.run(["sudu-lowcode", "--full", "data", "query", coll, "--where", json.dumps({"id": doc_id}), "--limit", "1"],
                         capture_output=True, text=True, cwd="/tmp")
    s = out.stdout
    o = json.loads(s[s.find("{"):])
    assert o.get("ok"), o.get("error")

    def find(x):
        if isinstance(x, dict):
            if "id" in x and str(x.get("id")) == doc_id:
                return x
            for v in x.values():
                r = find(v)
                if r is not None:
                    return r
        elif isinstance(x, list):
            for v in x:
                r = find(v)
                if r is not None:
                    return r
    return find(o)


def norm(v):
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, int):
        return v
    if isinstance(v, str) and re.fullmatch(r"-?\d+\.\d+", v):
        f = float(v)
        return int(f) if f.is_integer() else f
    if isinstance(v, str) and re.fullmatch(r"-?\d{1,20}", v):
        return int(v)
    return v


def project(lines, keys):
    out = []
    for l in lines or []:
        o = {k: norm(l[k]) for k in keys if k in l and l[k] is not None and l[k] != ""}
        if isinstance(l.get("children"), list) and l["children"]:
            o["children"] = project(l["children"], keys)
        out.append(o)
    return out


def check(kind, doc_id, tenant):
    sql, key, coll, line_key, keys = ((B.SQL_SO, "soIdsSql", "sales_order", "table_so", SO_KEYS) if kind == "SO" else
                                      (B.SQL_GD, "gdIdsSql", "goods_delivery", "table_gd", GD_KEYS))
    rows = q("--dev", fill(sql, tenant, key, [doc_id]))
    mine = shape(rows, line_key)
    plat = platform(coll, doc_id)
    a = project((mine[0] if mine else {}).get(line_key), keys)
    b = project((plat or {}).get(line_key), keys)
    ok = json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
    print("%s %s %s: %d top lines, %d with children -> %s" % ("ok  " if ok else "FAIL", kind, doc_id, len(a), sum(1 for x in a if "children" in x),
                                                         "same" if ok else "DIFFERS"))
    if not ok:
        for x, y in zip(a, b):
            if json.dumps(x, sort_keys=True) != json.dumps(y, sort_keys=True):
                print("   sql:", json.dumps(x, sort_keys=True)[:400])
                print("   plt:", json.dumps(y, sort_keys=True)[:400])
                break
        if len(a) != len(b):
            print("   line count", len(a), "vs", len(b))
    return ok


def pick(sql):
    return [r["d"] for r in q("--dev", sql)]


def main():
    t = "000000"
    docs = []
    docs += [("SO", d) for d in pick("SELECT CAST(sales_order_id AS CHAR) d FROM sales_order_axszx8cj_sub WHERE tenant_id = '000000' AND is_deleted = 0 "
                                    "AND item_bundle_id IS NOT NULL GROUP BY sales_order_id ORDER BY sales_order_id DESC LIMIT 2")]
    docs += [("GD", d) for d in pick("SELECT CAST(goods_delivery_id AS CHAR) d FROM goods_delivery_fwii8mvb_sub WHERE tenant_id = '000000' AND is_deleted = 0 "
                                    "AND item_bundle_id IS NOT NULL GROUP BY goods_delivery_id ORDER BY goods_delivery_id DESC LIMIT 2")]
    docs += [("SO", d) for d in pick("SELECT CAST(sales_order_id AS CHAR) d FROM sales_order_axszx8cj_sub WHERE tenant_id = '000000' AND is_deleted = 0 "
                                    "AND invoice_qty > 0 GROUP BY sales_order_id ORDER BY sales_order_id DESC LIMIT 2")]
    docs += [("SO", d) for d in pick("SELECT CAST(sales_order_id AS CHAR) d FROM sales_order_axszx8cj_sub WHERE tenant_id = '000000' AND is_deleted = 0 "
                                    "AND sales_order_id > 2105000000000000000 GROUP BY sales_order_id ORDER BY COUNT(*) DESC LIMIT 1")]
    docs += [("GD", d) for d in pick("SELECT CAST(goods_delivery_id AS CHAR) d FROM goods_delivery_fwii8mvb_sub WHERE tenant_id = '000000' AND is_deleted = 0 "
                                    "AND goods_delivery_id > 2105000000000000000 GROUP BY goods_delivery_id ORDER BY COUNT(*) DESC LIMIT 1")]
    docs += [("SO", d) for d in pick("SELECT CAST(id AS CHAR) d FROM sales_order WHERE tenant_id = '000000' AND is_deleted = 0 ORDER BY id DESC LIMIT 2")]
    docs += [("GD", d) for d in pick("SELECT CAST(id AS CHAR) d FROM goods_delivery WHERE tenant_id = '000000' AND is_deleted = 0 ORDER BY id DESC LIMIT 2")]
    if argv:
        docs = [(a.split(":")[0], a.split(":")[1]) for a in argv]
    seen = []
    for k, d in docs:
        if (k, d) not in seen:
            seen.append((k, d))
    bad = sum(0 if check(k, d, t) else 1 for k, d in seen)
    print("%d documents, %d differ" % (len(seen), bad))


if __name__ == "__main__":
    main()
