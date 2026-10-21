"""test_sql_cv.py: runs the lean SI conversions' sql-nodes on dev (read-only), shapes them with cv.js the way the workflows do, and
checks every column the lifted code reads - type and value, a bundle's items under `children`, documents and lines in id order -
against the platform's own read of the same documents (sudu-lowcode data query, the read the old search nodes got). Small, bundle
and 2,000-line documents of tenants 000000, 496474 and 711077.  usage: python3 test_sql_cv.py"""
import json, os, re, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "grv2"))
sys.path.insert(0, os.path.join(HERE, ".."))
from dbq import q  # noqa: E402
_argv, sys.argv = sys.argv, sys.argv[:1]
import build_si_convert as B  # noqa: E402
sys.argv = _argv

GDW = json.load(open(os.path.join(HERE, "..", "out", "GD_Convert_SI.json")))
SOW = json.load(open(os.path.join(HERE, "..", "out", "SO_Convert_SI.json")))
CV = open(os.path.join(HERE, "..", "code", "cv.js")).read()


def sql_of(doc, nid):
    return B.find(doc, nid)["data"]["script"]["code"]


def fill(sql, vals):
    return re.sub(r"\{\{node:([^}]+)\}\}", lambda m: vals[m.group(1).split(".")[-1]], sql)


def node_js(expr, payload):
    prog = CV + "\nconst P = JSON.parse(require('fs').readFileSync(0, 'utf8'));\nprocess.stdout.write(JSON.stringify(" + expr + "));"
    out = subprocess.run(["node", "-e", prog], input=json.dumps(payload), capture_output=True, text=True)
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


def pick(o, cols):
    return {c: o[c] for c in cols if c in o and o[c] is not None and o[c] != ""}


def pick_lines(lines, cols):
    out = []
    for l in lines or []:
        x = pick(l, cols)
        if isinstance(l.get("children"), list) and l["children"]:
            x["children"] = pick_lines(l["children"], cols)
        out.append(x)
    return out


def flat(lines):
    for l in lines or []:
        yield l
        yield from flat(l.get("children"))


def J(v):
    return json.dumps(v, sort_keys=True, ensure_ascii=False)


def first_diff(a, b, path=""):
    if J(a) == J(b):
        return None
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            d = first_diff(a.get(k), b.get(k), path + "." + k)
            if d:
                return d
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return "%s: %d vs %d rows" % (path, len(a), len(b))
        for i, (x, y) in enumerate(zip(a, b)):
            d = first_diff(x, y, "%s[%d]" % (path, i))
            if d:
                return d
    return "%s: sql=%s platform=%s" % (path, J(a)[:120], J(b)[:120])


bad = 0
checks = 0


def report(ok, what, detail=""):
    global bad, checks
    checks += 1
    bad += 0 if ok else 1
    print("%s %s%s" % ("ok  " if ok else "FAIL", what, "" if ok else "\n       " + detail))


def gd_case(tenant, gd):
    vals = {"tenantId": tenant, "idsSql": gd}
    plat = platform("goods_delivery", gd)
    heads = node_js("cvRows(P, ['id'])", q("--dev", fill(sql_of(GDW, "sql_node_gdcvHeads"), vals)))
    a = pick(heads[0], ["id", "gd_status", "so_id"]) if heads else {}
    report(J(a) == J(pick(plat, ["id", "gd_status", "so_id"])), "GD %s %s: selected-GD read (status, so_id)" % (tenant, plat.get("delivery_no")),
           first_diff(a, pick(plat, ["id", "gd_status", "so_id"])) or "")
    done = q("--dev", fill(sql_of(GDW, "sql_node_gdcvDone"), vals))
    lines = q("--dev", fill(sql_of(GDW, "sql_node_gdcvLines"), vals))
    mine = node_js("cvDocs(P.h, P.l, 'table_gd', %s, %s)" % (json.dumps(B.bigints(B.GD, B.GD_HEAD)), json.dumps(B.bigints(B.GDL, B.GD_LINE))),
                   {"h": done, "l": lines})
    if plat.get("gd_status") != "Completed":
        report(mine == [], "GD %s %s: not Completed -> no row" % (tenant, plat.get("delivery_no")))
        return
    ha, hb = pick(mine[0], B.GD_HEAD), pick(plat, B.GD_HEAD)
    la, lb = pick_lines(mine[0]["table_gd"], B.GD_LINE), pick_lines(plat.get("table_gd"), B.GD_LINE)
    kids = sum(len(x.get("children") or []) for x in lb)
    report(J(ha) == J(hb), "GD %s %s: header (%d columns read)" % (tenant, plat.get("delivery_no"), len(hb)), first_diff(ha, hb) or "")
    report(J(la) == J(lb), "GD %s %s: %d top lines, %d bundle items" % (tenant, plat.get("delivery_no"), len(lb), kids), first_diff(la, lb) or "")
    so_ids = [str(x) for x in plat.get("so_id") or []]
    vals["soIdsSql"] = ",".join(so_ids) or "0"
    soh = node_js("cvRows(P, %s)" % json.dumps(B.bigints(B.SO, B.GD_SO_HEAD)), q("--dev", fill(sql_of(GDW, "sql_node_gdcvSoHeads"), vals)))
    sol = node_js("cvRows(P, %s)" % json.dumps(B.bigints(B.SOL, B.GD_SO_LINE)), q("--dev", fill(sql_of(GDW, "sql_node_gdcvSoLines"), vals)))
    plat_so = {s: platform("sales_order", s) for s in so_ids}
    want_h = [pick(plat_so[s], B.GD_SO_HEAD) for s in sorted(so_ids, key=int) if plat_so[s]]
    report(J([pick(x, B.GD_SO_HEAD) for x in soh]) == J(want_h), "GD %s %s: its %d sales order header(s)" % (tenant, plat.get("delivery_no"), len(want_h)),
           first_diff([pick(x, B.GD_SO_HEAD) for x in soh], want_h) or "")
    asked = {str(l.get("so_line_item_id")) for l in flat(plat.get("table_gd")) if l.get("so_line_item_id")}
    by_id = {}
    for s in plat_so.values():
        for l in flat((s or {}).get("table_so")):
            by_id[str(l["id"])] = l
    want_l = [pick(by_id[i], B.GD_SO_LINE) for i in sorted(asked & set(by_id), key=int)]
    got_l = [pick(x, B.GD_SO_LINE) for x in sol]
    report(J(got_l) == J(want_l), "GD %s %s: the %d order lines behind its lines (%d asked, %d not under its orders)" % (
        tenant, plat.get("delivery_no"), len(want_l), len(asked), len(asked - set(by_id))), first_diff(got_l, want_l) or "")


def so_case(tenant, so):
    vals = {"tenantId": tenant, "idsSql": so}
    plat = platform("sales_order", so)
    heads = node_js("cvRows(P, ['id'])", q("--dev", fill(sql_of(SOW, "sql_node_socvHeads"), vals)))
    a = pick(heads[0], ["id", "so_status"]) if heads else {}
    report(J(a) == J(pick(plat, ["id", "so_status"])), "SO %s %s: selected-SO read (status)" % (tenant, plat.get("so_no")), first_diff(a, pick(plat, ["id", "so_status"])) or "")
    done = q("--dev", fill(sql_of(SOW, "sql_node_socvDone"), vals))
    lines = q("--dev", fill(sql_of(SOW, "sql_node_socvLines"), vals))
    mine = node_js("cvDocs(P.h, P.l, 'table_so', %s, %s)" % (json.dumps(B.bigints(B.SO, B.SO_HEAD)), json.dumps(B.bigints(B.SOL, B.SO_LINE))),
                   {"h": done, "l": lines})
    if plat.get("so_status") == "Draft":
        report(mine == [], "SO %s %s: Draft -> no row" % (tenant, plat.get("so_no")))
        return
    ha, hb = pick(mine[0], B.SO_HEAD), pick(plat, B.SO_HEAD)
    la, lb = pick_lines(mine[0]["table_so"], B.SO_LINE), pick_lines(plat.get("table_so"), B.SO_LINE)
    kids = sum(len(x.get("children") or []) for x in lb)
    report(J(ha) == J(hb), "SO %s %s: header (%d columns read)" % (tenant, plat.get("so_no"), len(hb)), first_diff(ha, hb) or "")
    report(J(la) == J(lb), "SO %s %s: %d top lines, %d bundle items" % (tenant, plat.get("so_no"), len(lb), kids), first_diff(la, lb) or "")


def ids(sql):
    return [r["id"] for r in q("--dev", sql)]


gds = [("496474", "2109546651970158594"), ("711077", "2106374831031631873")]
gds += [("000000", i) for i in ids("SELECT CAST(g.id AS CHAR) id FROM goods_delivery g WHERE g.tenant_id = '000000' AND g.is_deleted = 0 AND g.gd_status = 'Completed' "
                                   "AND g.id IN (SELECT l.goods_delivery_id FROM goods_delivery_fwii8mvb_sub l WHERE l.parent_id IS NOT NULL AND l.is_deleted = 0) "
                                   "ORDER BY g.id DESC LIMIT 2")]
gds += [("000000", i) for i in ids("SELECT CAST(id AS CHAR) id FROM goods_delivery WHERE tenant_id = '000000' AND is_deleted = 0 AND gd_status = 'Completed' "
                                   "ORDER BY id DESC LIMIT 3")]
gds += [("000000", i) for i in ids("SELECT CAST(id AS CHAR) id FROM goods_delivery WHERE tenant_id = '000000' AND is_deleted = 0 AND gd_status = 'Created' "
                                   "ORDER BY id DESC LIMIT 1")]
sos = [("711077", "2106922323483758594"), ("496474", "2112424324921135106"), ("000000", "2094609420550471682")]
sos += [("000000", i) for i in ids("SELECT CAST(s.id AS CHAR) id FROM sales_order s WHERE s.tenant_id = '000000' AND s.is_deleted = 0 AND s.so_status <> 'Draft' "
                                   "AND s.id IN (SELECT l.sales_order_id FROM sales_order_axszx8cj_sub l WHERE l.parent_id IS NOT NULL AND l.is_deleted = 0) "
                                   "ORDER BY s.id DESC LIMIT 2")]
sos += [("000000", i) for i in ids("SELECT CAST(id AS CHAR) id FROM sales_order WHERE tenant_id = '000000' AND is_deleted = 0 AND so_status <> 'Draft' "
                                   "ORDER BY id DESC LIMIT 3")]
sos += [("000000", i) for i in ids("SELECT CAST(id AS CHAR) id FROM sales_order WHERE tenant_id = '000000' AND is_deleted = 0 AND so_status = 'Draft' "
                                   "ORDER BY id DESC LIMIT 1")]
for t, g in dict.fromkeys(gds):
    gd_case(t, g)
for t, s in dict.fromkeys(sos):
    so_case(t, s)
print("%d checks on %d GDs and %d SOs, %d differ" % (checks, len(dict.fromkeys(gds)), len(dict.fromkeys(sos)), bad))
