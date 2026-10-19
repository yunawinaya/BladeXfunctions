"""Read-only live checks of package B's SQL (SELECT only through .dbtools/db).
python3 scratchpad/iav2/test/submit/sql_live_submit.py [--no-prod]
1. lib/sqlcheck.py over the BUILT IA_V2_SUBMIT.json + IA_SAVE.json on dev (values from a real dev IA; ia_v2_job_id does not exist until
   the form publish: missing_cols h./g./x.ia_v2_job_id -> NULL).
2. Each screen against dev rows found to trigger it (costing: FIFO + WA rows of one key; WA: a WA item without a WA row at a plant;
   duplicate item_balance / item_batch_balance rows), the read-backs with the job subquery replaced by a real IA id (rows + the
   fingerprint), FACTS with a real key, BACK with a real job's key.
3. The IA_SAVE v12 guard SQL on prod (it ships there): a real prod IA's stored status."""
import sys
sys.dont_write_bytecode = True
import importlib.util
import json
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
IAV2 = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(IAV2, "lib"))
from dbq import q  # noqa: E402
import sqlcheck  # noqa: E402
import v2build as V  # noqa: E402

_spec = importlib.util.spec_from_file_location("ia_submit_sql_live", os.path.join(IAV2, "submit", "submit_sql.py"))
Q = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(Q)
OUT = os.path.join(IAV2, "..", "..", "Item Assembly & BOM", "AsyncV2")
MISSING = {"h.ia_v2_job_id": "NULL", "g.ia_v2_job_id": "NULL", "x.ia_v2_job_id": "NULL"}
problems = []


def run(env, name, sql, expect_rows=None, cols=None):
    for a, b in MISSING.items():
        sql = sql.replace(a, b)
    try:
        rows = q(env, sql)
    except Exception as e:  # noqa: BLE001
        problems.append(name + ": " + str(e)[:300])
        print("FAIL %-34s %s" % (name, str(e)[:300]))
        return []
    got = list(rows[0].keys()) if rows else []
    bad = (expect_rows is not None and (len(rows) > 0) != expect_rows) or (cols is not None and rows and sorted(got) != sorted(cols))
    if bad:
        problems.append("%s: rows=%d cols=%s" % (name, len(rows), got))
    print("%s %-34s rows=%-4d %s" % ("BAD " if bad else "ok  ", name, len(rows), (json.dumps(rows[0], ensure_ascii=False)[:150] if rows else "")))
    return rows


T, IA = "000000", "2102337892356845570"
h = q("--dev", "SELECT h.organization_id, CAST(h.issuing_operation_faci AS CHAR) AS plant, h.item_id, CAST(h.location_id AS CHAR) AS loc FROM sm_item_assembly h "
              "WHERE h.tenant_id = '%s' AND h.id = %s" % (T, IA))[0]
lines = q("--dev", "SELECT l.item_selection, l.temp_qty_data FROM sm_item_assembly_tlm8ve69_sub l WHERE l.tenant_id = '%s' AND l.sm_item_assembly_id = %s AND l.is_deleted = 0" % (T, IA))
ORG, PLANT, PARENT, RBIN = h["organization_id"], h["plant"], h["item_id"], h["loc"]
pairs, bals, bbals, items = [], [], [], [PARENT]
for line in lines:
    items.append(line["item_selection"])
    for p in json.loads(line["temp_qty_data"] or "[]"):
        if float(p.get("sm_quantity") or 0) > 0:
            pairs.append("[%s,%s]" % (line["item_selection"], p.get("batch_id") or 0))
            bals.append("[%s,%s]" % (line["item_selection"], p["location_id"]))
            if p.get("batch_id"):
                bbals.append("[%s,%s,%s]" % (line["item_selection"], p["location_id"], p["batch_id"]))
key = "IA:%s:%s:0000000000000000:1" % (ORG, IA)
vals = {"*": {"tenantId": T, "iaId": IA, "key": key, "organizationId": ORG, "itemIdsSql": "0," + ",".join(items), "pickPairsJson": "[" + ",".join(pairs) + "]",
              "costPairsJson": "[" + ",".join(pairs + ["[%s,0]" % PARENT]) + "]", "balTuplesJson": "[" + ",".join(bals + ["[%s,%s]" % (PARENT, RBIN)]) + "]",
              "batchTuplesJson": "[" + ",".join(bbals) + "]", "plantId": PLANT, "jobId": "0"},
        "missing_cols": MISSING}
print("== 1. sqlcheck: dev IA %s (%d lines, %d picks), org %s plant %s" % (IA, len(lines), len(pairs), ORG, PLANT))
bad = sqlcheck.run(os.path.abspath(OUT), vals, ["IA_V2_SUBMIT", "IA_SAVE"])
if bad:
    problems.append("sqlcheck: %d problems" % bad)

print("== 2. screens and read-backs against rows that trigger them (dev)")
c = q("--dev", "SELECT f.tenant_id, f.organization_id, CAST(f.plant_id AS CHAR) AS plant, CAST(f.material_id AS CHAR) AS m, CAST(COALESCE(f.batch_id, 0) AS CHAR) AS b "
              "FROM fifo_costing_history f JOIN item i ON i.id = f.material_id AND i.is_deleted = 0 AND i.stock_control <> 0 "
              "WHERE f.is_deleted = 0 AND EXISTS (SELECT 1 FROM wa_costing_method w WHERE w.tenant_id = f.tenant_id AND w.is_deleted = 0 AND w.material_id = f.material_id "
              "AND COALESCE(w.batch_id, 0) = COALESCE(f.batch_id, 0) AND w.plant_id = (CAST(f.plant_id AS CHAR) COLLATE utf8mb4_general_ci) AND w.organization_id = f.organization_id) LIMIT 1")
if c:
    c = c[0]
    run("--dev", "COST flags FIFO + WA rows", Q.cost(V.sub, c["tenant_id"], "[[%s,%s]]" % (c["m"], c["b"]), "0," + c["m"], c["plant"], c["organization_id"]), True, ["j"])
    run("--dev", "COST: another batch is not flagged", Q.cost(V.sub, c["tenant_id"], "[[%s,%s]]" % (c["m"], "1"), "0," + c["m"], c["plant"], c["organization_id"]), False)
else:
    print("     (no FIFO + WA key on dev: COST flag case not runnable)")
w = q("--dev", "SELECT i.tenant_id, CAST(i.id AS CHAR) AS m, b.organization_id, CAST(b.plant_id AS CHAR) AS plant FROM item i JOIN item_balance b ON b.material_id = i.id "
              "AND b.tenant_id = i.tenant_id AND b.is_deleted = 0 WHERE i.is_deleted = 0 AND i.stock_control <> 0 AND i.material_costing_method = 'Weighted Average' "
              "AND NOT EXISTS (SELECT 1 FROM wa_costing_method x WHERE x.tenant_id = i.tenant_id AND x.is_deleted = 0 AND x.material_id = i.id "
              "AND x.plant_id = (CAST(b.plant_id AS CHAR) COLLATE utf8mb4_general_ci) AND x.organization_id = b.organization_id) LIMIT 1")
if w:
    w = w[0]
    run("--dev", "WA flags a WA item without a row", Q.wa(V.sub, w["tenant_id"], "[[%s,0]]" % w["m"], w["plant"], w["organization_id"]), True, ["j"])
else:
    print("     (no WA item without a WA row on dev)")
wa_ok = q("--dev", "SELECT w.tenant_id, CAST(w.material_id AS CHAR) AS m, w.organization_id, w.plant_id AS plant FROM wa_costing_method w JOIN item i ON i.id = w.material_id "
                   "AND i.is_deleted = 0 AND i.stock_control <> 0 AND i.material_costing_method = 'Weighted Average' WHERE w.is_deleted = 0 AND w.batch_id IS NULL LIMIT 1")
if wa_ok:
    x = wa_ok[0]
    run("--dev", "WA: an item with its row is not flagged", Q.wa(V.sub, x["tenant_id"], "[[%s,0]]" % x["m"], x["plant"], x["organization_id"]), False)
    run("--dev", "WA: the same item at another plant is flagged", Q.wa(V.sub, x["tenant_id"], "[[%s,0]]" % x["m"], "1", x["organization_id"]), True, ["j"])
    run("--dev", "WA: a batch pick needs its batch's row", Q.wa(V.sub, x["tenant_id"], "[[%s,1]]" % x["m"], x["plant"], x["organization_id"]), True, ["j"])
d = q("--dev", "SELECT b.tenant_id, b.organization_id, CAST(b.plant_id AS CHAR) AS plant, CAST(b.material_id AS CHAR) AS m, CAST(b.location_id AS CHAR) AS l, COUNT(*) AS n "
              "FROM item_balance b WHERE b.is_deleted = 0 GROUP BY b.tenant_id, b.organization_id, b.plant_id, b.material_id, b.location_id HAVING COUNT(*) > 1 LIMIT 1")
if d:
    d = d[0]
    rows = run("--dev", "DUP flags duplicate item_balance rows", Q.dup(V.sub, d["tenant_id"], "[[%s,%s]]" % (d["m"], d["l"]), "[]", "0," + d["m"], d["plant"], d["organization_id"]),
               True, ["j"])
    if rows and json.loads(rows[0]["j"])["t"] != "B":
        problems.append("DUP: item_balance row not typed B")
else:
    print("     (no duplicate item_balance on dev)")
db_ = q("--dev", "SELECT b.tenant_id, b.organization_id, CAST(b.plant_id AS CHAR) AS plant, CAST(b.material_id AS CHAR) AS m, CAST(b.location_id AS CHAR) AS l, "
                 "CAST(b.batch_id AS CHAR) AS bt FROM item_batch_balance b WHERE b.is_deleted = 0 AND b.batch_id IS NOT NULL "
                 "GROUP BY b.tenant_id, b.organization_id, b.plant_id, b.material_id, b.location_id, b.batch_id HAVING COUNT(*) > 1 LIMIT 1")
if db_:
    x = db_[0]
    rows = run("--dev", "DUP flags duplicate item_batch_balance", Q.dup(V.sub, x["tenant_id"], "[]", "[[%s,%s,%s]]" % (x["m"], x["l"], x["bt"]), "0," + x["m"], x["plant"],
                                                                        x["organization_id"]), True, ["j"])
    if rows and json.loads(rows[-1]["j"])["t"] != "T":
        problems.append("DUP: item_batch_balance row not typed T")
else:
    print("     (no duplicate item_batch_balance on dev)")
run("--dev", "DUP: this IA's own tuples", Q.dup(V.sub, T, vals["*"]["balTuplesJson"], vals["*"]["batchTuplesJson"], vals["*"]["itemIdsSql"], PLANT, ORG), None)
run("--dev", "ITEMS of this IA", Q.items(V.sub, T, vals["*"]["itemIdsSql"]), True, ["j"])
real = lambda sql: sql.replace(V.sub(Q.IA_BY_JOB, T=T, JOB="0"), IA)  # noqa: E731
hdr_rows = run("--dev", "FP_HEADER (job subquery -> the IA)", real(Q.header_by_job(V.sub, T, "0")), True, ["j"])
line_rows = run("--dev", "FP_LINES (job subquery -> the IA)", real(Q.lines_by_job(V.sub, T, "0")), True, ["j"])
if hdr_rows and line_rows:
    script = ("const F = require('./code/shared/fingerprint.js'); const x = JSON.parse(require('fs').readFileSync(0, 'utf8'));"
              "process.stdout.write(F.iaLineFingerprint(x.l, x.h));")
    fp = subprocess.run(["node", "-e", script], input=json.dumps({"l": line_rows, "h": hdr_rows}), capture_output=True, text=True, cwd=IAV2).stdout
    print("     lineFingerprint of the read-back: %s" % fp)
    if not fp.startswith("IF1:%d:" % len(line_rows)):
        problems.append("fingerprint of the read-back: " + fp)
run("--dev", "HDR_BY_JOB (no column yet: no rows)", Q.hdr_by_job(V.sub, T, "0"), False)
anyjob = q("--dev", "SELECT j.tenant_id, j.idempotency_key FROM gd_async_job j WHERE j.is_deleted = 0 AND j.correlation_id LIKE '%|%' ORDER BY j.id DESC LIMIT 1")
if anyjob:
    run("--dev", "BACK (a real job's key)", Q.back(V.sub, anyjob[0]["tenant_id"], anyjob[0]["idempotency_key"]), True, Q.BACK_COLS)
run("--dev", "FACTS (Edit, real IA)", Q.facts(V.sub, T, IA, key, ORG), True, Q.FACTS_COLS)
run("--dev", "FACTS (Add: IA 0)", Q.facts(V.sub, T, "0", key, ORG), True, Q.FACTS_COLS)

if "--no-prod" not in sys.argv:
    print("== 3. prod (SELECT only): the costing screen on a real FIFO item with WA rows; the IA_SAVE v12 guard SQL (it ships there)")
    c = q("--prod", "SELECT w.tenant_id, CAST(w.material_id AS CHAR) AS m, CAST(COALESCE(w.batch_id, 0) AS CHAR) AS b, w.organization_id, w.plant_id AS plant "
                    "FROM wa_costing_method w JOIN item i ON i.id = w.material_id AND i.is_deleted = 0 AND i.stock_control <> 0 "
                    "AND i.material_costing_method = 'First In First Out' WHERE w.is_deleted = 0 LIMIT 1")
    if c:
        c = c[0]
        if c["plant"].isdigit():
            run("--prod", "COST flags a FIFO item with WA rows", Q.cost(V.sub, c["tenant_id"], "[[%s,%s]]" % (c["m"], c["b"]), "0," + c["m"], c["plant"], c["organization_id"]),
                True, ["j"])
            run("--prod", "COST: another plant is not flagged", Q.cost(V.sub, c["tenant_id"], "[[%s,%s]]" % (c["m"], c["b"]), "0," + c["m"], "1", c["organization_id"]), False)
    p = q("--prod", "SELECT CAST(id AS CHAR) AS id, tenant_id FROM sm_item_assembly WHERE is_deleted = 0 ORDER BY id DESC LIMIT 1")[0]
    save = json.load(open(os.path.join(OUT, "IA_SAVE.json"), encoding="utf-8"))
    nodes = []
    sqlcheck.walk(save, nodes)
    assert [n["id"] for n in nodes] == ["sql_node_IAguard"], [n["id"] for n in nodes]
    text = sqlcheck.fill(nodes[0]["data"]["script"]["code"], {"tenantId": p["tenant_id"], "iaId": p["id"]})
    run("--prod", "IA_SAVE guard (a real prod IA)", text, True, ["ia_id", "item_assembly_status"])
    run("--prod", "IA_SAVE guard (another tenant: no row)", sqlcheck.fill(nodes[0]["data"]["script"]["code"], {"tenantId": "1", "iaId": p["id"]}), False)
print("PROBLEMS: %d" % len(problems) + ("" if not problems else "\n  " + "\n  ".join(problems)))
sys.exit(1 if problems else 0)
