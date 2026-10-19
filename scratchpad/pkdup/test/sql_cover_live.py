"""sql_cover_live.py: PICKING_LOOP's double-Picking guard on REAL data, read-only. Takes the code of code_node_CoverIds,
sql_node_Cover and code_node_Cover from Picking/PickingLoopWorkflow.json, builds the call's arrayData from a real Picking's
stored lines, runs CoverIds (node), the SQL (SELECT only, .dbtools/db) and the verdict (node), and checks the outcome.

  A prod 128671 GD-2610-67: PI-20261009-1189/1190/1191 (the second user's 3 Pickings, 8 s after the first 3) added again
    -> REFUSED (the first set holds every unit)
  B prod 128671 GD-2610-14: PI-20261007-1023 (a Full Picking remainder: 2 of 40, PI-0992 picked 38) saved from Draft
    -> passes; the same with 3 -> REFUSED
  C prod 128671 PI-20261013-1502 (300 GDs, 2,096 lines) saved from Draft -> passes, timed
  D dev 496474: the newest live Picking with GD lines, added again as a new Picking -> REFUSED
"""
import json, re, subprocess, sys, time

sys.path.insert(0, "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/pkv2tools")
from dbq import q  # noqa: E402

ROOT = "/Users/yunawinaya/Developer/BladeXfunctions/"
doc = json.load(open(ROOT + "Picking/PickingLoopWorkflow.json"))


def find(n, i):
    if isinstance(n, dict):
        if n.get("id") == i:
            return n
        for v in n.values():
            x = find(v, i)
            if x:
                return x
    elif isinstance(n, list):
        for v in n:
            x = find(v, i)
            if x:
                return x


IDS, SQL, VERDICT = (find(doc, i)["data"]["script"]["code"] for i in ("code_node_CoverIds", "sql_node_Cover", "code_node_Cover"))


def js(code, values):
    body = re.sub(r"\{\{([^}]+)\}\}", lambda m: json.dumps(values[m.group(1)]), code)
    r = subprocess.run(["node", "-e", "console.log(JSON.stringify((function(){" + body + "})()))"], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr[-800:]
    return json.loads(r.stdout.strip().split("\n")[-1])


def picking_items(env, to_pk):
    rows = q(env, """SELECT CAST(i.gd_id AS CHAR) AS gd_id, CAST(i.gd_line_id AS CHAR) AS gd_line_id, i.qty_to_pick, i.line_status, i.row_type
                       FROM transfer_order_jz8m9w3h_sub i WHERE i.transfer_order_id = %s AND i.is_deleted = 0""" % int(to_pk))
    head = q(env, "SELECT CAST(id AS CHAR) AS id, tenant_id, gd_no, to_id, to_status FROM transfer_order WHERE id = %s" % int(to_pk))[0]
    gd_no = head["gd_no"] if isinstance(head["gd_no"], list) else json.loads(head["gd_no"] or "[]")
    return head, {"id": head["id"], "gd_no": gd_no, "to_status": head["to_status"], "table_picking_items": [dict(r, qty_to_pick=float(r["qty_to_pick"] or 0)) for r in rows]}


def guard(env, tenant, array_data, save_as, page):
    ids = js(IDS, {"workflowparams:arrayData": array_data, "workflowparams:saveAs": save_as, "workflowparams:pageStatus": page})
    if ids["check"] != 1:
        return ids, None, {"over": 0, "message": "(not checked)"}, 0.0
    sql = SQL.replace("{{system:tenantId}}", tenant)
    for k in ("lineIdCsv", "gdIdCsv", "ownIdCsv"):
        sql = sql.replace("{{node:code_node_CoverIds.data.%s}}" % k, ids[k])
    assert "{{" not in sql and sql.lstrip().upper().startswith("SELECT")
    t0 = time.time()
    rows = q(env, sql)
    dt = time.time() - t0
    v = js(VERDICT, {"node:sql_node_Cover.data": rows, "node:code_node_CoverIds.data.mine": ids["mine"]})
    return ids, rows, v, dt


bad = 0


def expect(label, v, over, dt, rows):
    global bad
    ok = v["over"] == over
    bad += 0 if ok else 1
    print("%s %s: over=%s (%.2fs, %s rows) %s" % ("ok  " if ok else "FAIL", label, v["over"], dt, len(rows or []), v["message"][:260]))


# A
for pk_no in ("PI-20261009-1189", "PI-20261009-1190", "PI-20261009-1191"):
    pk = q("--prod", "SELECT CAST(id AS CHAR) AS id FROM transfer_order WHERE tenant_id = '128671' AND to_id = '%s'" % pk_no)[0]["id"]
    head, p = picking_items("--prod", pk)
    p.pop("id")
    ids, rows, v, dt = guard("--prod", "128671", [p], "Created", "Add")
    expect("A " + pk_no + " added again", v, 1, dt, rows)
# B
pk = q("--prod", "SELECT CAST(id AS CHAR) AS id FROM transfer_order WHERE tenant_id = '128671' AND to_id = 'PI-20261007-1023'")[0]["id"]
head, p = picking_items("--prod", pk)
p["to_status"] = "Draft"
ids, rows, v, dt = guard("--prod", "128671", [p], "Created", "Edit")
expect("B PI-20261007-1023 remainder (2 of 40) from Draft", v, 0, dt, rows)
for r in p["table_picking_items"]:
    if r["gd_line_id"] == "2107707145830141954":
        r["qty_to_pick"] = 3.0
ids, rows, v, dt = guard("--prod", "128671", [p], "Created", "Edit")
expect("B same with 3 of 40", v, 1, dt, rows)
# C
pk = q("--prod", "SELECT CAST(id AS CHAR) AS id FROM transfer_order WHERE tenant_id = '128671' AND to_id = 'PI-20261013-1502'")[0]["id"]
head, p = picking_items("--prod", pk)
p["to_status"] = "Draft"
ids, rows, v, dt = guard("--prod", "128671", [p], "Created", "Edit")
print("     C lines %d, GDs %d" % (len(ids["lineIdCsv"].split(",")), len(ids["gdIdCsv"].split(","))))
expect("C PI-20261013-1502 (300 GDs) from Draft", v, 0, dt, rows)
# D
d = q("--dev", """SELECT CAST(t.id AS CHAR) AS id FROM transfer_order t WHERE t.tenant_id = '496474' AND t.is_deleted = 0
                  AND t.to_status IN ('Created', 'In Progress') AND JSON_LENGTH(t.gd_no) > 0 ORDER BY t.id DESC LIMIT 1""")
if d:
    head, p = picking_items("--dev", d[0]["id"])
    p.pop("id")
    ids, rows, v, dt = guard("--dev", "496474", [p], "Created", "Add")
    expect("D dev 496474 %s (%s) added again" % (head["to_id"], head["to_status"]), v, 1, dt, rows)
else:
    print("     D: no live Picking with GD lines on dev 496474")
print("%d problem(s)" % bad)
sys.exit(1 if bad else 0)
