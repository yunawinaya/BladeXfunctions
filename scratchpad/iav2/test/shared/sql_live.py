"""Read-only live check of code/shared/sql.py (dev) and of price.js against the classic's stored receipts (prod, SELECT only).

python3 scratchpad/iav2/test/shared/sql_live.py [--ia <dev IA id>] [--no-prod]
ia_v2_job_id does not exist until the form publish: every reference reads NULL here (sqlcheck's missing_cols rule)."""
import importlib.util
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
IAV2 = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(IAV2, "lib"))
from dbq import q  # noqa: E402
import v2build as V  # noqa: E402

spec = importlib.util.spec_from_file_location("ia_shared_sql", os.path.join(IAV2, "code", "shared", "sql.py"))
S = importlib.util.module_from_spec(spec)
spec.loader.exec_module(S)

MISSING = {"h.ia_v2_job_id": "NULL", "g.ia_v2_job_id": "NULL"}
problems = []


def run(env, name, sql, expect=None):
    for a, b in MISSING.items():
        sql = sql.replace(a, b)
    try:
        rows = q(env, sql)
    except Exception as e:
        problems.append(name + ": " + str(e)[:300])
        print("FAIL %-14s %s" % (name, str(e)[:300]))
        return []
    cols = list(rows[0].keys()) if rows else []
    bad = expect is not None and rows and sorted(cols) != sorted(expect)
    if bad:
        problems.append(name + ": columns " + str(cols))
    print("%s %-14s rows=%-4d cols=%s" % ("COLS" if bad else "ok  ", name, len(rows), ",".join(cols)[:110]))
    return rows


def node(script, payload):
    r = subprocess.run(["node", "-e", script], input=json.dumps(payload), capture_output=True, text=True, cwd=IAV2)
    if r.returncode:
        raise RuntimeError(r.stderr[:800])
    return json.loads(r.stdout)


argv = sys.argv[1:]
ia = argv[argv.index("--ia") + 1] if "--ia" in argv else None
pick = q("--dev", "SELECT CAST(h.id AS CHAR) AS id, h.tenant_id, h.organization_id, h.item_id, h.stock_movement_no FROM sm_item_assembly h WHERE h.is_deleted = 0 "
                  + ("AND h.id = %s " % ia if ia else "AND h.item_assembly_status = 'Completed' ") + "ORDER BY h.id DESC LIMIT 1")[0]
IA, T, ORG, ITEM = pick["id"], pick["tenant_id"], pick["organization_id"], pick["item_id"]
print("dev IA %s (%s) tenant %s org %s" % (IA, pick["stock_movement_no"], T, ORG))

lines = run("--dev", "FP_LINES", V.sub(S.FP_LINES, T=T, IA=IA), ["j"])
header = run("--dev", "FP_HEADER", V.sub(S.FP_HEADER, T=T, IA=IA), ["j"])
run("--dev", "OWNER", V.sub(S.OWNER, T=T, IA=IA), ["db_now", "ia_id", "item_assembly_status", "ia_v2_job_id", "stock_movement_no", "lock_ref", "lock_step"])
facts = run("--dev", "FACTS", S.facts(V.sub, T=T, IA=IA, KEY="IA:" + ORG + ":" + IA + ":0000000000000000:1", ORG=ORG), S.FACTS_COLS)
facts_add = run("--dev", "FACTS (Add)", S.facts(V.sub, T=T, IA="0", KEY="IA:" + ORG + ":new-x:0000000000000000:1", ORG=ORG), S.FACTS_COLS)
item_ids = sorted({ITEM} | {json.loads(r["j"])["item_selection"] for r in lines})
items = run("--dev", "ITEMS", V.sub(S.ITEMS, T=T, ITEMS=",".join(item_ids)), ["j"])
run("--dev", "OUT_TOTALS", V.sub(S.OUT_TOTALS, T=T, IA=IA, JOB=IA), ["n", "total"])
classic_out = q("--dev", V.sub(S.OUT_TOTALS.replace("\n   AND m.operation_effect_key LIKE 'IAC|@JOB|I|%'", ""), T=T, IA=IA, JOB=IA))
print("     classic rows of the same IA without the op-key bound: n=%s total=%s" % (classic_out[0]["n"], classic_out[0]["total"]))
for side in ("I", "R"):
    run("--dev", "OP_STATE " + side, S.op_state(V.sub, T=T, JOB="0", SIDE=side), ["intents", "review", "done_summary"])
run("--dev", "BATCH_ROWS", V.sub(S.BATCH_ROWS, T=T, ORG=ORG, ITEM=ITEM), None)
run("--dev", "CLASSIC_GUARD", V.sub(S.CLASSIC_GUARD, T=T, IA=IA), ["ia_id", "item_assembly_status"])
if facts:
    f = facts[0]
    print("     facts: status=%s no=%s issued_by_job=%s completed_under=%s batch_cfg=%s key_job=%s" % (f["item_assembly_status"], f["stock_movement_no"], f["issued_by_job"],
                                                                                        f["completed_under"], f["batch_cfg"], f["key_job"]))
if facts_add and facts_add[0]["ia_id"] is not None:
    problems.append("FACTS (Add) found a stored IA for id 0")

# RV_MOVES = the classic IA_REVERT v4 sql_node_iaRvMovs (its own text, its guard's tokens) for the same IA
rv = run("--dev", "RV_MOVES", V.sub(S.RV_MOVES, T=T, IA=IA), S.RV_MOVES_COLS)
wf_rv = json.load(open(os.path.join(IAV2, "base", "IA_REVERT.v4.json"), encoding="utf-8"))
def _walk(nodes):
    for n in nodes or []:
        if isinstance(n, dict):
            yield n
            yield from _walk(n.get("blocks"))
classic_sql = [n for n in _walk(wf_rv["nodes"]) if n["id"] == "sql_node_iaRvMovs"][0]["data"]["script"]["code"]
classic_sql = (classic_sql.replace("{{node:code_node_iaRvParams.data.iaIdSql}}", IA).replace("{{node:code_node_iaRvParams.data.orgSql}}", ORG)
               .replace("{{node:code_node_iaRvParams.data.iaNoSql}}", pick["stock_movement_no"]))
classic_rows = q("--dev", classic_sql)
same_rows = json.dumps(classic_rows, sort_keys=True, default=str) == json.dumps(rv, sort_keys=True, default=str)
print("     RV_MOVES = the classic's sql_node_iaRvMovs rows: %s (%d rows)" % (same_rows, len(rv)))
if not same_rows:
    problems.append("RV_MOVES differs from the classic's sql_node_iaRvMovs")
im = node("""
const S = require('./code/shared/fingerprint.js');
const p = JSON.parse(require('fs').readFileSync(0, 'utf8'));
console.log(JSON.stringify({ a: S.iaMovesFingerprint(p.rows), b: S.iaMovesFingerprint(p.rows.slice().reverse()) }));
""", {"rows": rv})
print("     moves fingerprint %s (stable: %s)" % (im["a"], im["a"] == im["b"]))

# the fingerprint over the read rows: j rows, parsed rows and a re-ordered copy agree
fp = node("""
const S = require('./code/shared/fingerprint.js'); const C = require('./code/shared/ia_common.js');
const p = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const parsed = C.iaRows(p.lines);
const out = { raw: S.iaLineFingerprint(p.lines, p.header), parsed: S.iaLineFingerprint(parsed, C.iaRows(p.header)),
  reversed: S.iaLineFingerprint(parsed.slice().reverse(), C.iaRows(p.header)[0]) };
console.log(JSON.stringify(out));
""", {"lines": lines, "header": header})
print("     fingerprint %s (raw = parsed = reversed: %s)" % (fp["raw"], fp["raw"] == fp["parsed"] == fp["reversed"]))
if not (fp["raw"] == fp["parsed"] == fp["reversed"]):
    problems.append("fingerprint differs by row shape: " + json.dumps(fp))
# price.js against every classic receipt on prod: unit_price = q8(OUT sum / qty + assembly_cost), stored at the tenant's price rule
if "--no-prod" not in argv:
    PRICE = """SELECT CAST(h.id AS CHAR) AS ia_id, h.tenant_id, h.stock_movement_no, h.item_qty, i.material_costing_method AS method,
       CAST(i.assembly_cost AS CHAR) AS assembly_cost,
       (SELECT CAST(COALESCE(SUM(m.total_price), 0) AS CHAR) FROM inventory_movement m
         WHERE m.tenant_id = h.tenant_id AND m.id > h.id AND m.is_deleted = 0 AND m.movement = 'OUT' AND m.transaction_type = 'IA'
           AND m.organization_id = h.organization_id AND m.trx_no = h.stock_movement_no) AS out_total,
       (SELECT CAST(JSON_OBJECT('n', COUNT(*), 'unit_price', MAX(m.unit_price), 'base_qty', MAX(m.base_qty), 'quantity', MAX(m.quantity)) AS CHAR)
          FROM inventory_movement m
         WHERE m.tenant_id = h.tenant_id AND m.id > h.id AND m.is_deleted = 0 AND m.movement = 'IN' AND m.transaction_type = 'IA'
           AND m.organization_id = h.organization_id AND m.trx_no = h.stock_movement_no) AS receipt
  FROM sm_item_assembly h
  JOIN item i ON i.id = CAST(h.item_id AS UNSIGNED) AND i.tenant_id = h.tenant_id
 WHERE h.is_deleted = 0 AND h.item_assembly_status IN ('Completed', 'Fully Posted')
 ORDER BY h.id"""
    rows = q("--prod", PRICE)
    res = node("""
const P = require('./code/shared/price.js'); const C = require('./code/shared/ia_common.js');
const rows = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const out = { checked: 0, fixed: 0, multi: 0, classicOk: 0, v2Ok: 0, bad: [] };
for (const r of rows) {
  const rc = JSON.parse(r.receipt);
  if (Number(rc.n) !== 1) { out.multi++; continue; }
  if (r.method === 'Fixed Cost') { out.fixed++; continue; }
  out.checked++;
  const classic = P.receiptUnitPrice({ outTotals: [r.out_total], receiptBaseQty: r.item_qty, assemblyCost: r.assembly_cost });
  const v2 = P.receiptUnitPrice({ outTotals: [r.out_total], receiptBaseQty: rc.base_qty, assemblyCost: r.assembly_cost });
  if (C.iaSameStored(classic, rc.unit_price)) out.classicOk++;
  if (C.iaSameStored(v2, rc.unit_price)) out.v2Ok++;
  else out.bad.push({ ia: r.ia_id, no: r.stock_movement_no, out: r.out_total, qty: r.item_qty, base: rc.base_qty, stored: rc.unit_price, v2: v2, classic: classic });
}
console.log(JSON.stringify(out));
""", rows)
    print("prod receipts: %d IAs, %d checked (FIFO / WA, one receipt), %d Fixed Cost skipped, %d not exactly one receipt; classic formula matches %d, V2 formula %d"
          % (len(rows), res["checked"], res["fixed"], res["multi"], res["classicOk"], res["v2Ok"]))
    for b in res["bad"][:10]:
        print("     V2 differs:", json.dumps(b))
    if res["v2Ok"] != res["checked"]:
        problems.append("%d prod receipts differ from receiptUnitPrice" % (res["checked"] - res["v2Ok"]))

print("problems: %d%s" % (len(problems), (" - " + "; ".join(problems)) if problems else ""))
sys.exit(1 if problems else 0)
