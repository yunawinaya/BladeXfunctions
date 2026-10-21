"""test_sql_cv.py: runs the lean conversions' sql-nodes on dev (read-only), shapes them with cv.js the way the workflows do, and
checks every field they read against the platform's own read of the same documents (sudu-lowcode data query)."""
import json, os, re, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "grv2"))
sys.path.insert(0, os.path.join(HERE, ".."))
from dbq import q  # noqa: E402
sys.argv = sys.argv[:1]
import build_pi as B  # noqa: E402
from test_sql import platform, norm  # noqa: E402

GR = json.load(open(os.path.join(HERE, "..", "out", "GR_Convert_PI.json")))
PO = json.load(open(os.path.join(HERE, "..", "out", "PO_CONVERT_PI.json")))


def sql_of(doc, nid):
    return B.find(doc, nid)["data"]["script"]["code"]


def fill(sql, vals):
    return re.sub(r"\{\{node:([^}]+)\}\}", lambda m: vals[m.group(1).split(".")[-1]], sql)


def node_js(expr, payload):
    js = open(os.path.join(HERE, "..", "code", "cv.js")).read()
    prog = js + "\nconst P = JSON.parse(require('fs').readFileSync(0, 'utf8'));\nprocess.stdout.write(JSON.stringify(" + expr + "));"
    out = subprocess.run(["node", "-e", prog], input=json.dumps(payload), capture_output=True, text=True)
    if out.returncode:
        raise RuntimeError(out.stderr)
    return json.loads(out.stdout)


def proj(o, keys):
    return {k: norm(o[k]) for k in keys if k in o and o[k] is not None and o[k] != ""}


def proj_lines(lines, keys):
    out = []
    for l in lines or []:
        x = proj(l, keys)
        if isinstance(l.get("children"), list) and l["children"]:
            x["children"] = proj_lines(l["children"], keys)
        out.append(x)
    return out


def same(a, b):
    return json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def show(a, b):
    for k in sorted(set(a) | set(b)):
        if json.dumps(a.get(k), sort_keys=True) != json.dumps(b.get(k), sort_keys=True):
            print("     %s: sql=%s platform=%s" % (k, json.dumps(a.get(k))[:160], json.dumps(b.get(k))[:160]))


bad = 0
T = "000000"
grs = [r["id"] for r in q("--dev", "SELECT CAST(g.id AS CHAR) id FROM goods_receiving g WHERE g.tenant_id = '000000' AND g.is_deleted = 0 "
                                     "AND g.gr_status = 'Completed' AND (g.id = 2102383604918513666 OR g.id IN (SELECT l.goods_receiving_id FROM "
                                     "goods_receiving_eg6l4ywi_sub l WHERE l.parent_or_child = 'Split-Parent' AND l.is_deleted = 0)) ORDER BY g.id DESC LIMIT 3")]
grs += [r["id"] for r in q("--dev", "SELECT CAST(id AS CHAR) id FROM goods_receiving WHERE tenant_id = '000000' AND is_deleted = 0 AND gr_status = 'Completed' ORDER BY id DESC LIMIT 3")]
for g in grs:
    vals = {"tenantId": T, "idsSql": g}
    heads = q("--dev", fill(sql_of(GR, "sql_node_grcvDone"), vals))
    lines = q("--dev", fill(sql_of(GR, "sql_node_grcvLines"), vals))
    mine = node_js("cvDocs(P.h, P.l, 'table_gr', %s, %s)" % (json.dumps(B.bigints("gr", B.GR_HEAD)), json.dumps(B.bigints("grl", B.GR_LINE))), {"h": heads, "l": lines})
    plat = platform("goods_receiving", g)
    a = proj(mine[0], [k for k in B.GR_HEAD if k != "id"]) if mine else {}
    b = proj(plat, [k for k in B.GR_HEAD if k != "id"])
    la, lb = proj_lines(mine[0]["table_gr"] if mine else [], B.GR_LINE), proj_lines(plat.get("table_gr"), B.GR_LINE)
    ok = same(a, b) and same(la, lb)
    # the selected-GR status read + the PO data reads
    hs = node_js("cvRows(P, ['id'])", q("--dev", fill(sql_of(GR, "sql_node_grcvHeads"), vals)))
    ok_h = len(hs) == 1 and hs[0].get("gr_status") == plat.get("gr_status") and [str(x) for x in hs[0].get("po_id", [])] == [str(x) for x in plat.get("po_id", [])]
    po_ids = ",".join(str(x) for x in plat.get("po_id", [])) or "0"
    poh = node_js("cvRows(P, %s)" % json.dumps(B.bigints("po", B.GR_PO_HEAD)), q("--dev", fill(sql_of(GR, "sql_node_grcvPoHeads"), {"tenantId": T, "poIdsSql": po_ids})))
    pol = node_js("cvRows(P, %s)" % json.dumps(B.bigints("pol", B.GR_PO_LINE)), q("--dev", fill(sql_of(GR, "sql_node_grcvPoLines"), vals)))
    ok_p = True
    for ph in poh:
        pp = platform("purchase_order", str(ph["id"]))
        if not same(proj(ph, B.GR_PO_HEAD), proj(pp, B.GR_PO_HEAD)):
            ok_p = False
            show(proj(ph, B.GR_PO_HEAD), proj(pp, B.GR_PO_HEAD))
        flat = []
        for l in pp.get("table_po") or []:
            flat.append(l)
            flat.extend(l.get("children") or [])
        want = {str(l["id"]): proj(l, B.GR_PO_LINE) for l in flat}
        for l in pol:
            if str(l["id"]) in want and not same(proj(l, B.GR_PO_LINE), want[str(l["id"])]):
                ok_p = False
                show(proj(l, B.GR_PO_LINE), want[str(l["id"])])
    good = ok and ok_h and ok_p
    bad += 0 if good else 1
    print("%s GR %s: %d top lines, %d bundles | header %s, lines %s, status/po_id %s, PO reads %s (%d PO lines)" % (
        "ok  " if good else "FAIL", g, len(la), sum(1 for x in la if "children" in x), same(a, b), same(la, lb), ok_h, ok_p, len(pol)))
    if not same(a, b):
        show(a, b)
    if not same(la, lb):
        for x, y in zip(la, lb):
            if not same(x, y):
                show(x, y)
                break

pos = ["2104864017485062145"] + [r["id"] for r in q("--dev", "SELECT CAST(id AS CHAR) id FROM purchase_order WHERE tenant_id = '000000' AND is_deleted = 0 ORDER BY id DESC LIMIT 3")]
for p in pos:
    vals = {"tenantId": T, "idsSql": p}
    heads = q("--dev", fill(sql_of(PO, "sql_node_pocvHeads"), vals))
    lines = q("--dev", fill(sql_of(PO, "sql_node_pocvLines"), vals))
    mine = node_js("cvDocs(P.h, P.l, 'table_po', %s, %s)" % (json.dumps(B.bigints("po", B.PO_HEAD)), json.dumps(B.bigints("pol", B.PO_LINE))), {"h": heads, "l": lines})
    plat = platform("purchase_order", p)
    a, b = proj(mine[0], B.PO_HEAD), proj(plat, B.PO_HEAD)
    la, lb = proj_lines(mine[0]["table_po"], B.PO_LINE), proj_lines(plat.get("table_po"), B.PO_LINE)
    good = same(a, b) and same(la, lb)
    bad += 0 if good else 1
    print("%s PO %s: %d top lines, %d bundles | header %s, lines %s" % ("ok  " if good else "FAIL", p, len(la), sum(1 for x in la if "children" in x), same(a, b), same(la, lb)))
    if not same(a, b):
        show(a, b)
    if not same(la, lb):
        for x, y in zip(la, lb):
            if not same(x, y):
                show(x, y)
                break
print("%d documents, %d differ" % (len(grs) + len(pos), bad))
