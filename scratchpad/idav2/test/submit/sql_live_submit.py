"""Read-only live checks of package B's SQL on dev (SELECT only through .dbtools/db).
python3 scratchpad/idav2/test/submit/sql_live_submit.py
1. lib/sqlcheck.py over the BUILT IDA_V2_SUBMIT.json + IDA_SAVE.json on dev (values from a real dev IDA; ida_v2_job_id / ida_idem_key do not
   exist until the form publish: missing_cols h. / g. / x.ida_v2_job_id + h.ida_idem_key -> NULL, CONTRACT section 13).
2. Each screen against dev rows found to trigger it (costing: FIFO + WA rows of one key; WA: a WA item without a WA row at a plant; duplicate
   item_balance / item_batch_balance rows), BATCH_HOLDERS by hex (case-insensitive, trailing spaces ignored), BNC, ITEMS, the read-backs with
   the job subquery replaced by a real IDA id (rows + the DF1 fingerprint), FACTS (Edit / Add), BACK with a real job's key.
3. The IDA_SAVE v7 guard SQL (IDA has no prod tables until the promotion): a real IDA's stored status; another tenant -> no row."""
import sys
sys.dont_write_bytecode = True
import importlib.util  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import subprocess  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
IDAV2 = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(IDAV2, "lib"))
from dbq import q  # noqa: E402
import sqlcheck  # noqa: E402
import v2build as V  # noqa: E402

_spec = importlib.util.spec_from_file_location("ida_submit_sql_live", os.path.join(IDAV2, "submit", "submit_sql.py"))
Q = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(Q)
OUT = os.path.join(IDAV2, "..", "..", "Item Disassembly", "AsyncV2")
MISSING = {"h.ida_v2_job_id": "NULL", "g.ida_v2_job_id": "NULL", "x.ida_v2_job_id": "NULL", "h.ida_idem_key": "NULL"}
problems = []


def node_js(script, payload):
    return subprocess.run(["node", "-e", script], input=json.dumps(payload), capture_output=True, text=True, cwd=IDAV2).stdout.strip()


def hexjson(numbers):
    return node_js("const C = require('./code/shared/ida_common.js'); process.stdout.write(C.idaHexJson(JSON.parse(require('fs').readFileSync(0, 'utf8'))));", numbers)


def run(name, sql, expect_rows=None, cols=None):
    for a, b in MISSING.items():
        sql = sql.replace(a, b)
    try:
        rows = q("--dev", sql)
    except Exception as e:  # noqa: BLE001
        problems.append(name + ": " + str(e)[:300])
        print("FAIL %-44s %s" % (name, str(e)[:300]))
        return []
    got = list(rows[0].keys()) if rows else []
    bad = (expect_rows is not None and (len(rows) > 0) != expect_rows) or (cols is not None and rows and sorted(got) != sorted(cols))
    if bad:
        problems.append("%s: rows=%d cols=%s" % (name, len(rows), got))
    print("%s %-44s rows=%-4d %s" % ("BAD " if bad else "ok  ", name, len(rows), (json.dumps(rows[0], ensure_ascii=False)[:140] if rows else "")))
    return rows


T, IDA = "000000", "2110985744909729793"
h = q("--dev", "SELECT h.organization_id, CAST(h.issuing_operation_faci AS CHAR) AS plant, CAST(h.item_id AS CHAR) AS item, h.temp_qty_data FROM sm_item_disassembly h "
              "WHERE h.tenant_id = '%s' AND h.id = %s" % (T, IDA))[0]
lines = q("--dev", "SELECT l.item_selection, CAST(l.location_id AS CHAR) AS loc, l.batch_number FROM sm_item_disassembly_tlm8ve69_sub l "
                   "WHERE l.tenant_id = '%s' AND l.sm_item_disassembly_id = %s AND l.is_deleted = 0 ORDER BY l.id" % (T, IDA))
ORG, PLANT, SRC = h["organization_id"], h["plant"], h["item"]
pairs, bals, bbals = [], [], []
for p in json.loads(h["temp_qty_data"] or "[]"):
    if float(p.get("sm_quantity") or 0) > 0:
        pairs.append("[%s,%s]" % (SRC, p.get("batch_id") or 0))
        bals.append("[%s,%s]" % (SRC, p["location_id"]))
        if p.get("batch_id"):
            bbals.append("[%s,%s,%s]" % (SRC, p["location_id"], p["batch_id"]))
items = [SRC] + [line["item_selection"] for line in lines]
typed = [line["batch_number"] for line in lines if line["batch_number"] not in ("-", "Auto-generated batch number", "") and not line["batch_number"].startswith("Batch-006")]
key = "IDA:%s:%s:0000000000000000:1" % (ORG, IDA)
vals = {"*": {"tenantId": T, "idaId": IDA, "key": key, "organizationId": ORG, "itemIdsSql": "0," + ",".join(items), "pickPairsJson": "[" + ",".join(pairs) + "]",
              "costPairsJson": "[" + ",".join(pairs + ["[%s,0]" % i for i in items[1:]]) + "]",
              "balTuplesJson": "[" + ",".join(bals + ["[%s,%s]" % (line["item_selection"], line["loc"]) for line in lines]) + "]",
              "batchTuplesJson": "[" + ",".join(bbals) + "]", "hexJson": hexjson(typed), "plantId": PLANT, "jobId": "0"},
        "missing_cols": MISSING}
print("== 1. sqlcheck: dev IDA %s (%d lines, %d picks, typed %s), org %s plant %s" % (IDA, len(lines), len(pairs), typed, ORG, PLANT))
bad = sqlcheck.run(os.path.abspath(OUT), vals, ["IDA_V2_SUBMIT", "IDA_SAVE"])
if bad:
    problems.append("sqlcheck: %d problems" % bad)

print("== 2. screens and read-backs against rows that trigger them (dev)")
c = q("--dev", "SELECT f.tenant_id, f.organization_id, CAST(f.plant_id AS CHAR) AS plant, CAST(f.material_id AS CHAR) AS m, CAST(COALESCE(f.batch_id, 0) AS CHAR) AS b "
              "FROM fifo_costing_history f JOIN item i ON i.id = f.material_id AND i.is_deleted = 0 AND i.stock_control <> 0 "
              "WHERE f.is_deleted = 0 AND EXISTS (SELECT 1 FROM wa_costing_method w WHERE w.tenant_id = f.tenant_id AND w.is_deleted = 0 AND w.material_id = f.material_id "
              "AND COALESCE(w.batch_id, 0) = COALESCE(f.batch_id, 0) AND w.plant_id = (CAST(f.plant_id AS CHAR) COLLATE utf8mb4_general_ci) AND w.organization_id = f.organization_id) LIMIT 1")
if c:
    c = c[0]
    run("COST flags FIFO + WA rows of one key", Q.cost(V.sub, c["tenant_id"], "[[%s,%s]]" % (c["m"], c["b"]), "0," + c["m"], c["plant"], c["organization_id"]), True, ["j"])
    run("COST: another batch is not flagged", Q.cost(V.sub, c["tenant_id"], "[[%s,%s]]" % (c["m"], "1"), "0," + c["m"], c["plant"], c["organization_id"]), False)
else:
    print("     (no FIFO + WA key on dev: COST flag case not runnable)")
w = q("--dev", "SELECT i.tenant_id, CAST(i.id AS CHAR) AS m, b.organization_id, CAST(b.plant_id AS CHAR) AS plant FROM item i JOIN item_balance b ON b.material_id = i.id "
              "AND b.tenant_id = i.tenant_id AND b.is_deleted = 0 WHERE i.is_deleted = 0 AND i.stock_control <> 0 AND i.material_costing_method = 'Weighted Average' "
              "AND NOT EXISTS (SELECT 1 FROM wa_costing_method x WHERE x.tenant_id = i.tenant_id AND x.is_deleted = 0 AND x.material_id = i.id "
              "AND x.plant_id = (CAST(b.plant_id AS CHAR) COLLATE utf8mb4_general_ci) AND x.organization_id = b.organization_id) LIMIT 1")
if w:
    w = w[0]
    run("WA flags a WA item without a row", Q.wa(V.sub, w["tenant_id"], "[[%s,0]]" % w["m"], w["plant"], w["organization_id"]), True, ["j"])
else:
    print("     (no WA item without a WA row on dev)")
wa_ok = q("--dev", "SELECT w.tenant_id, CAST(w.material_id AS CHAR) AS m, w.organization_id, w.plant_id AS plant FROM wa_costing_method w JOIN item i ON i.id = w.material_id "
                   "AND i.is_deleted = 0 AND i.stock_control <> 0 AND i.material_costing_method = 'Weighted Average' WHERE w.is_deleted = 0 AND w.batch_id IS NULL "
                   "AND w.plant_id REGEXP '^[0-9]+$' LIMIT 1")
if wa_ok:
    x = wa_ok[0]
    run("WA: an item with its row is not flagged", Q.wa(V.sub, x["tenant_id"], "[[%s,0]]" % x["m"], x["plant"], x["organization_id"]), False)
    run("WA: the same item at another plant is flagged", Q.wa(V.sub, x["tenant_id"], "[[%s,0]]" % x["m"], "1", x["organization_id"]), True, ["j"])
    run("WA: a batch pick needs its batch's row", Q.wa(V.sub, x["tenant_id"], "[[%s,1]]" % x["m"], x["plant"], x["organization_id"]), True, ["j"])
d = q("--dev", "SELECT b.tenant_id, b.organization_id, CAST(b.plant_id AS CHAR) AS plant, CAST(b.material_id AS CHAR) AS m, CAST(b.location_id AS CHAR) AS l, COUNT(*) AS n "
              "FROM item_balance b WHERE b.is_deleted = 0 GROUP BY b.tenant_id, b.organization_id, b.plant_id, b.material_id, b.location_id HAVING COUNT(*) > 1 LIMIT 1")
if d:
    d = d[0]
    rows = run("DUP flags duplicate item_balance rows", Q.dup(V.sub, d["tenant_id"], "[[%s,%s]]" % (d["m"], d["l"]), "[]", "0," + d["m"], d["plant"], d["organization_id"]),
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
    rows = run("DUP flags duplicate item_batch_balance", Q.dup(V.sub, x["tenant_id"], "[]", "[[%s,%s,%s]]" % (x["m"], x["l"], x["bt"]), "0," + x["m"], x["plant"],
                                                              x["organization_id"]), True, ["j"])
    if rows and json.loads(rows[-1]["j"])["t"] != "T":
        problems.append("DUP: item_batch_balance row not typed T")
else:
    print("     (no duplicate item_batch_balance on dev)")
V0 = vals["*"]
run("COST: this IDA's own keys (no flag expected)", Q.cost(V.sub, T, V0["costPairsJson"], V0["itemIdsSql"], PLANT, ORG), None)
run("WA: this IDA's own picks", Q.wa(V.sub, T, V0["pickPairsJson"], PLANT, ORG), None)
run("DUP: this IDA's own tuples", Q.dup(V.sub, T, V0["balTuplesJson"], V0["batchTuplesJson"], V0["itemIdsSql"], PLANT, ORG), None)
items_rows = run("ITEMS of this IDA", Q.items(V.sub, T, V0["itemIdsSql"]), True, ["j"])
if items_rows:
    parsed = [json.loads(r["j"]) for r in items_rows]
    ok = len(parsed) == len(set(items)) and all(isinstance(p.get("table_uom_conversion"), list) and all(isinstance(u.get("alt_uom_id"), str) for u in p["table_uom_conversion"])
                                                 for p in parsed)
    print("     ITEMS: %d rows, every table_uom_conversion an array with text alt_uom_id: %s" % (len(parsed), ok))
    if not ok:
        problems.append("ITEMS: rows / conversion shape")
run("BNC of the organization", Q.bnc(V.sub, T, ORG), True, ["j"])
for label, numbers, want in [("BATCH_HOLDERS: the typed number", ["Batch-0003"], True), ("BATCH_HOLDERS: lower case (general_ci)", ["batch-0003"], True),
                             ("BATCH_HOLDERS: trailing spaces ignored", ["Batch-0003  "], True), ("BATCH_HOLDERS: a prefix is not a match", ["Batch-000"], False),
                             ("BATCH_HOLDERS: no number (empty hex list)", [], False), ("BATCH_HOLDERS: another org", ["Batch-0003"], False)]:
    rows = run(label, Q.holders(V.sub, T, "1" if "another org" in label else ORG, hexjson(numbers)), want, ["j"])
    if rows and want and json.loads(rows[0]["j"])["batch_number"] != "Batch-0003":
        problems.append(label + ": not the stored text")
real = lambda sql: sql.replace(V.sub(Q.IDA_BY_JOB, T=T, JOB="0"), IDA)  # noqa: E731
hdr_rows = run("FP_HEADER (job subquery -> the IDA)", real(Q.header_by_job(V.sub, T, "0")), True, ["j"])
line_rows = run("FP_LINES (job subquery -> the IDA)", real(Q.lines_by_job(V.sub, T, "0")), True, ["j"])
if hdr_rows and line_rows:
    fp = node_js("const F = require('./code/shared/fingerprint.js'); const x = JSON.parse(require('fs').readFileSync(0, 'utf8'));"
                 "process.stdout.write(F.idaLineFingerprint(x.l, x.h));", {"l": line_rows, "h": hdr_rows})
    print("     lineFingerprint of the read-back: %s" % fp)
    if not fp.startswith("DF1:%d:" % len(line_rows)):
        problems.append("fingerprint of the read-back: " + fp)
run("FP_HEADER / FP_LINES by job (no column yet: no rows)", Q.lines_by_job(V.sub, T, "0"), False)
run("HDR_BY_JOB (no column yet: no rows)", Q.hdr_by_job(V.sub, T, "0"), False)
anyjob = q("--dev", "SELECT j.tenant_id, j.idempotency_key FROM gd_async_job j WHERE j.is_deleted = 0 AND j.correlation_id LIKE '%|%' ORDER BY j.id DESC LIMIT 1")
if anyjob:
    run("BACK (a real job's key)", Q.back(V.sub, anyjob[0]["tenant_id"], anyjob[0]["idempotency_key"]), True, Q.BACK_COLS)
run("BACK (an unknown key: no row)", Q.back(V.sub, T, key), False)
run("FACTS (Edit, real IDA)", Q.facts(V.sub, T, IDA, key, ORG), True, Q.FACTS_COLS)
run("FACTS (Add: IDA 0)", Q.facts(V.sub, T, "0", key, ORG), True, Q.FACTS_COLS)

print("== 3. the IDA_SAVE v7 guard SQL (the only sql-node of the classic)")
save = json.load(open(os.path.join(OUT, "IDA_SAVE.json"), encoding="utf-8"))
nodes = []
sqlcheck.walk(save, nodes)
assert [n["id"] for n in nodes] == ["sql_node_IDAguard"], [n["id"] for n in nodes]
gsql = nodes[0]["data"]["script"]["code"]
for nid, st in [(IDA, "Completed"), ("2110993307927707649", "Draft")]:
    rows = run("IDA_SAVE guard (dev IDA %s)" % nid, sqlcheck.fill(gsql, {"tenantId": T, "idaId": nid}), True, ["ida_id", "item_disassembly_status"])
    if rows and (rows[0]["ida_id"] != nid or rows[0]["item_disassembly_status"] != st):
        problems.append("guard row of %s: %s" % (nid, rows[0]))
run("IDA_SAVE guard (another tenant: no row)", sqlcheck.fill(gsql, {"tenantId": "1", "idaId": IDA}), False)
run("IDA_SAVE guard (no such IDA: no row)", sqlcheck.fill(gsql, {"tenantId": T, "idaId": "1"}), False)
print("PROBLEMS: %d" % len(problems) + ("" if not problems else "\n  " + "\n  ".join(problems)))
sys.exit(1 if problems else 0)
