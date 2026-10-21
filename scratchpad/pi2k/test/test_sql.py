"""test_sql.py [doc ids ...]: runs PI_SAVE v20's sql-nodes on dev (read-only) and checks that, once shaped by piShape, they give
the same lines (for the columns they read) as the platform's own read of the same documents (sudu-lowcode data query, the
read path the old search nodes used). Without ids: a bundle PO, a bundle GR, split GRs and recent documents of tenant 000000."""
import json, os, re, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "grv2"))
sys.path.insert(0, os.path.join(HERE, ".."))
from dbq import q  # noqa: E402
_saved_argv, argv = sys.argv, sys.argv[1:] if __name__ == "__main__" else []
sys.argv = sys.argv[:1]
import build_pi as B  # noqa: E402
sys.argv = _saved_argv

PO_KEYS = ["id", "parent_id", "item_id", "item_bundle_id", "quantity", "invoice_qty", "pi_status"]
GR_KEYS = ["id", "parent_id", "item_id", "item_bundle_id", "received_qty", "invoice_qty", "pi_status", "parent_or_child", "po_line_item_id", "line_index"]


def fill(sql, tenant, ids_key, ids):
    return (sql.replace("{{node:code_pi_prep.data.tenantId}}", tenant).replace("{{node:code_pi_prep.data.%s}}" % ids_key, ",".join(ids)))


def shape(rows, line_key):
    js = open(os.path.join(HERE, "..", "code", "check.js")).read()
    prog = js + "\nconst rows = JSON.parse(require('fs').readFileSync(0, 'utf8'));\nprocess.stdout.write(JSON.stringify(piShape(rows, %s)));" % json.dumps(line_key)
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
    if isinstance(v, str) and re.fullmatch(r"-?\d+\.\d+", v):
        f = float(v)
        return int(f) if f.is_integer() else f
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
    sql, key, coll, line_key, keys = ((B.SQL_PI_PO, "poIdsSql", "purchase_order", "table_po", PO_KEYS) if kind == "PO" else
                                      (B.SQL_PI_GR, "grIdsSql", "goods_receiving", "table_gr", GR_KEYS))
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


def main():
    t = "000000"
    docs = [("PO", "2104864017485062145"), ("GR", "2102383604918513666"), ("PO", "2069333011458768897")]
    split = q("--dev", "SELECT CAST(goods_receiving_id AS CHAR) g FROM goods_receiving_eg6l4ywi_sub WHERE tenant_id = '000000' AND is_deleted = 0 "
                       "AND parent_or_child = 'Split-Parent' GROUP BY goods_receiving_id ORDER BY goods_receiving_id DESC LIMIT 2")
    docs += [("GR", r["g"]) for r in split]
    recent = q("--dev", "SELECT CAST(id AS CHAR) id FROM purchase_order WHERE tenant_id = '000000' AND is_deleted = 0 ORDER BY id DESC LIMIT 2")
    docs += [("PO", r["id"]) for r in recent]
    recent = q("--dev", "SELECT CAST(id AS CHAR) id FROM goods_receiving WHERE tenant_id = '000000' AND is_deleted = 0 ORDER BY id DESC LIMIT 2")
    docs += [("GR", r["id"]) for r in recent]
    if argv:
        docs = [(a.split(":")[0], a.split(":")[1]) for a in argv]
    bad = sum(0 if check(k, d, t) else 1 for k, d in docs)
    print("%d documents, %d differ" % (len(docs), bad))


if __name__ == "__main__":
    main()
