#!/usr/bin/env python3
"""Repair for LSH SI2610-0914 (GD-2610-1847, yen, 2026-10-28 10:05:28): finish what SI_SAVE run 2115263648577490946 never ran.

That run inserted the invoice, then its fork failed at update_node_CTTDlnVN "Update SO": the platform, just restarted
(10:01 / 10:03), refused the sales_order update ("update条件字段[issued_status]不存在或不可持久化"). It was a short-lived glitch:
every later SI_SAVE wrote the same node. Checked on prod:
- written: the invoice, its 14 SO lines and 14 GD lines (invoice_qty / si_status), and the GD header (Fully Invoiced);
- NOT written: the SO header (si_status stays 'Not Created'), and everything after the fork. Of that, only the receivable
  applies: AR_SAVE's add-node. LSH has auto_post_si = 0 (no SI_POST), the invoice is Credit (no CP), auto PI was 'skip'.
  GD_Convert_SI's own steps after "8. Create SI" only cache results.

This script:
1. replays prod SI_SAVE v49's code_node_p0XoMz8H "Map AR Data" on the failed run's recorded inputs;
2. checks itself on reference run 2115265392602648577 (SI2610-0930, eve, 10:12:23, 14 lines, receivable untouched since):
   the replay equals that run's recorded output, and the rows built from it equal the reference receivable's rows column
   for column (ar_invoice, ar_invoice_blade_dept, ar_invoice_i0seqjfp_sub, ar_invoice_i0seqjfp_sub_closure);
3. writes repair.sql: checks, the SO header update + the receivable inserts (guarded, rerun-safe), and after-checks.

usage: python3 build_repair.py
"""
import json, os, sys
from decimal import Decimal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.environ["PATH"] = "/opt/homebrew/bin:/usr/local/bin:" + os.environ.get("PATH", "")
import replay_tests as rt  # noqa: E402

TENANT = "128671"
FAILED_RUN, REF_RUN = 2115263648577490946, 2115265392602648577
REF_AR = 2115265397941997569
SI_ID, SI_NO = 2115263650477510658, "SI2610-0914"
SO_ID = 2114995590197813251
ID_TIME_MS = 1793156400000            # 2026-10-28 ~11:00 MYT; repair ids use worker 1001, the platform's use other workers
NOW8 = "CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')"
OUT = os.path.join(HERE, "repair.sql")
SYSTEM = {"id", "create_user", "create_dept", "create_time", "update_user", "update_time", "is_deleted", "tenant_id"}


class Raw(str):
    """An SQL expression, written as is."""


def wf(name):
    return json.load(open(os.path.join(HERE, name), encoding="utf-8"))


SI_SAVE, AR_SAVE = wf("SI_SAVE.prod_v49.json"), wf("AR_SAVE.prod_v19.json")


def node(doc, node_id):
    hit = []

    def walk(o):
        if isinstance(o, dict):
            if o.get("id") == node_id and "data" in o:
                hit.append(o)
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(doc)
    assert len(hit) == 1, node_id
    return hit[0]["data"]


TYPES = {}


def columns(table):
    rows = rt.db(f"SELECT column_name c, data_type t FROM information_schema.columns WHERE table_schema = DATABASE() "
                 f"AND table_name = '{table}' ORDER BY ordinal_position")
    TYPES[table] = {r["c"]: r["t"] for r in rows}
    return [r["c"] for r in rows]


# ---------------------------------------------------------------- the receivable payload, as SI_SAVE builds it

def ar_payload(run):
    params, nodes = rt.trace(run)
    out = rt.run(node(SI_SAVE, "code_node_p0XoMz8H")["script"]["code"], params, nodes, rt.run_time_ms(run))
    return out, nodes.get("code_node_p0XoMz8H")


def mapped(out):
    """AR_SAVE add_node_0V51yd6W: each prop = {{workflowparams:data.<path>}} of the payload."""
    data, row = out["arData"], {}
    for p in node(AR_SAVE, "add_node_0V51yd6W")["props"]["list"]:
        v = p["value"]
        assert v.startswith("{{workflowparams:data.") and v.endswith("}}"), p
        cur = data
        for k in v[len("{{workflowparams:data."):-2].split("."):
            cur = cur.get(k) if isinstance(cur, dict) else None
        row[p["prop"]] = cur
    return row


# ---------------------------------------------------------------- values as the platform stores them

EMPTY_TO_NULL = set()   # (table, column) where the reference shows the platform stored '' as NULL


def same_value(mine, db, col):
    if mine == db or (mine is None and db is None):
        return True
    if mine == "" and db is None:
        EMPTY_TO_NULL.add(col)
        return True
    if mine is None and db == "":
        return False
    if isinstance(db, str) and len(db) >= 10 and db[4] == "-" and isinstance(mine, str) and mine[:10] == db[:10]:
        return True
    try:
        return Decimal(str(mine)) == Decimal(str(db))
    except Exception:
        return str(mine) == str(db)


def compare(label, table, mine, db, skip=()):
    bad = [(c, mine.get(c), db.get(c)) for c in db
           if c not in SYSTEM and c not in skip and not same_value(mine.get(c), db.get(c), (table, c))]
    assert not bad, (label, bad)


def as_stored(table, row):
    """'' -> NULL where the reference shows the platform does it, or the column cannot hold text."""
    out = {}
    for c, v in row.items():
        t = TYPES[table].get(c, "")
        if v == "" and ((table, c) in EMPTY_TO_NULL or t in ("bigint", "int", "decimal", "datetime", "date", "tinyint", "json")):
            v = None
        out[c] = v
    return out


def header_values(m):
    """The ar_invoice columns the add-node writes, plus the subform column that stays NULL."""
    row = {c: m.get(c) for c in AR_COLS if c not in SYSTEM}
    row["table_ar_invoice"] = None
    return row


def line_values(item):
    return {c: item.get(c) for c in LINE_COLS if c not in SYSTEM and c not in ("ar_invoice_id", "parent_id")}


# ---------------------------------------------------------------- self-check on the reference receivable

AR_COLS, LINE_COLS = columns("ar_invoice"), columns("ar_invoice_i0seqjfp_sub")
CL_COLS, J_COLS = columns("ar_invoice_i0seqjfp_sub_closure"), columns("ar_invoice_blade_dept")


def check_reference():
    out, recorded = ar_payload(REF_RUN)
    assert rt.same_as_recorded(out, recorded.get("data", recorded)), "replay differs from the reference run's recorded output"
    m = mapped(out)
    [db] = rt.db(f"SELECT * FROM ar_invoice WHERE id = {REF_AR}")
    assert db["create_time"] == db["update_time"], "the reference receivable was touched since"
    unmapped = {c: db[c] for c in AR_COLS if c not in SYSTEM and c not in m and db[c] not in (None, "")}
    assert unmapped == {"invoice_total_myr": "MYR"}, ("columns filled outside the add-node props", unmapped)
    compare("header", "ar_invoice", dict(header_values(m), invoice_total_myr="MYR"), db)
    lines = rt.db(f"SELECT * FROM ar_invoice_i0seqjfp_sub WHERE ar_invoice_id = {REF_AR} ORDER BY id")
    items = m["table_ar_invoice"]
    assert len(items) == len(lines) and all(not i.get("children") for i in items), (len(items), len(lines))
    for i, (item, line) in enumerate(zip(items, lines)):
        assert line["parent_id"] is None and line["ar_invoice_id"] == REF_AR
        compare(f"line {i}", "ar_invoice_i0seqjfp_sub", line_values(item), line, skip=("ar_invoice_id", "parent_id"))
    ids = ",".join(str(l["id"]) for l in lines)
    cl = rt.db(f"SELECT * FROM ar_invoice_i0seqjfp_sub_closure WHERE descendant_id IN ({ids})")
    assert sorted((c["ancestor_id"], c["descendant_id"], c["depth"]) for c in cl) == sorted((l["id"], l["id"], 1) for l in lines)
    j = rt.db(f"SELECT * FROM ar_invoice_blade_dept WHERE ar_invoice_id = {REF_AR}")
    assert [(r["left_field"], str(r["blade_dept_id"])) for r in j] == [("plant_id", str(m["plant_id"]))], j
    for t, rows in (("lines", lines), ("closure", cl), ("junction", j)):
        assert all(r["create_user"] == db["create_user"] and r["create_dept"] == db["create_dept"] and r["sub_tenant_id"
                   if "sub_tenant_id" in r else "sub_tenant_id_d_8qhtx"] is None for r in rows), t
    print(f"reference SI2610-0930: replay = recorded; header, {len(lines)} lines, {len(cl)} closure rows and the plant link "
          f"match the receivable column for column")


# ---------------------------------------------------------------- the repair rows

def snowflake(i):
    return ((ID_TIME_MS - 1288834974657) << 22) | (1001 << 12) | i


def lit(v):
    if isinstance(v, Raw):
        return str(v)
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float, Decimal)):
        return str(v)
    return "'" + str(v).replace("\\", "\\\\").replace("'", "''") + "'"


def build_rows():
    out, _ = ar_payload(FAILED_RUN)
    m = mapped(out)
    [si] = rt.db(f"SELECT sales_invoice_no, invoice_total, create_user, create_dept FROM sales_invoice WHERE id = {SI_ID} AND tenant_id = '{TENANT}'")
    assert m["ar_invoice_no"] == SI_NO and Decimal(str(m["invoice_total"])) == Decimal(str(si["invoice_total"])), (m["ar_invoice_no"], m["invoice_total"])
    user, dept = si["create_user"], si["create_dept"]
    sysc = {"create_user": user, "create_dept": dept, "create_time": Raw(NOW8), "update_user": user,
            "update_time": Raw(NOW8), "is_deleted": 0, "tenant_id": TENANT}
    n = iter(range(4096))
    hid = snowflake(next(n))
    header = dict(as_stored("ar_invoice", dict(header_values(m), invoice_total_myr="MYR")), id=hid, **sysc)
    junction = {"id": snowflake(next(n)), "ar_invoice_id": hid, "left_field": "plant_id", "blade_dept_id": m["plant_id"], **sysc,
                "sub_tenant_id": None}
    lines, closure = [], []
    for item in m["table_ar_invoice"]:
        assert not item.get("children"), "bundle lines are not handled here"
        lid = snowflake(next(n))
        row = dict(as_stored("ar_invoice_i0seqjfp_sub", line_values(item)), id=lid, ar_invoice_id=hid, parent_id=None, **sysc)
        lines.append(row)
        closure.append({"id": snowflake(next(n)), "ancestor_id": lid, "descendant_id": lid, "depth": 1, **sysc, "sub_tenant_id": None})
    for t, cols, rows in (("ar_invoice", AR_COLS, [header]), ("ar_invoice_i0seqjfp_sub", LINE_COLS, lines),
                          ("ar_invoice_i0seqjfp_sub_closure", CL_COLS, closure), ("ar_invoice_blade_dept", J_COLS, [junction])):
        for r in rows:
            missing = [c for c in cols if c not in r and c not in ("sub_tenant_id", "sub_tenant_id_d_8qhtx", "ar_invoice_no_sn")]
            assert not missing, (t, missing)
    return m, header, junction, lines, closure


def typed(table, col, v):
    """Snowflake ids reach the code-nodes as strings; a BIGINT column gets them as integer literals (never via DOUBLE)."""
    if TYPES[table].get(col) == "bigint" and isinstance(v, str) and v.lstrip("-").isdigit():
        return int(v)
    return v


def insert(table, cols, rows, guard):
    use = [c for c in cols if any(c in r for r in rows)]
    vals = ",\n".join("  ROW(" + ", ".join(lit(typed(table, c, r.get(c))) for c in use) + ")" for r in rows)
    return (f"INSERT INTO {table} ({', '.join(use)})\nSELECT v.* FROM (VALUES\n{vals}\n) AS v({', '.join(use)})\n"
            f"WHERE {guard};")


def render(m, header, junction, lines, closure):
    hid = header["id"]
    total = Decimal(str(m["invoice_total"]))
    no_ar = (f"NOT EXISTS (SELECT 1 FROM ar_invoice a WHERE a.tenant_id = '{TENANT}' AND a.ar_invoice_no = '{SI_NO}' "
             f"AND a.is_deleted = 0)")
    has_hdr = f"EXISTS (SELECT 1 FROM ar_invoice a WHERE a.id = {hid})"
    line_ids = ", ".join(str(l["id"]) for l in lines)
    return f"""-- LSH (tenant {TENANT}) SI2610-0914 / GD-2610-1847 / SO-Tom-036035: finish SI_SAVE run {FAILED_RUN} (yen, 2026-10-28 10:05:28).
-- Built by build_repair.py (see its docstring). Run the parts in order; stop if any check differs.
-- What it writes: the SO header's invoice status (as update_node_CTTDlnVN), and the receivable AR_SAVE's add-node would
-- have inserted: ar_invoice + its plant link + {len(lines)} lines + {len(closure)} closure rows. Ids use worker 1001.
-- Every statement is guarded, so running it twice changes nothing the second time.

-- PART 1: checks (all must match)
SELECT so_no, si_status FROM sales_order WHERE tenant_id = '{TENANT}' AND id = {SO_ID};
--   expect: SO-Tom-036035 | Not Created
SELECT sales_invoice_no, si_status, invoice_total FROM sales_invoice WHERE tenant_id = '{TENANT}' AND id = {SI_ID};
--   expect: {SI_NO} | Completed | {total:.8f}
SELECT COUNT(*) AS receivables FROM ar_invoice WHERE tenant_id = '{TENANT}' AND ar_invoice_no = '{SI_NO}' AND is_deleted = 0;
--   expect: 0

-- PART 2: the repair (expected rows affected: 1 / 1 / 1 / {len(lines)} / {len(closure)})
UPDATE sales_order
   SET si_status = 'Fully Invoiced', update_user = {header['update_user']}, update_time = {NOW8}
 WHERE tenant_id = '{TENANT}' AND id = {SO_ID} AND si_status = 'Not Created' AND is_deleted = 0;

{insert("ar_invoice", AR_COLS, [header], no_ar)}

{insert("ar_invoice_blade_dept", J_COLS, [junction], has_hdr + f" AND NOT EXISTS (SELECT 1 FROM ar_invoice_blade_dept j WHERE j.id = {junction['id']})")}

{insert("ar_invoice_i0seqjfp_sub", LINE_COLS, lines, has_hdr + f" AND NOT EXISTS (SELECT 1 FROM ar_invoice_i0seqjfp_sub s WHERE s.id IN ({line_ids}))")}

{insert("ar_invoice_i0seqjfp_sub_closure", CL_COLS, closure, f"EXISTS (SELECT 1 FROM ar_invoice_i0seqjfp_sub s WHERE s.id = {lines[0]['id']}) AND NOT EXISTS (SELECT 1 FROM ar_invoice_i0seqjfp_sub_closure c WHERE c.descendant_id IN ({line_ids}))")}

-- PART 3: after-checks
SELECT so_no, si_status FROM sales_order WHERE tenant_id = '{TENANT}' AND id = {SO_ID};
--   expect: SO-Tom-036035 | Fully Invoiced
SELECT ar_invoice_no, payment_status, invoice_total, outstanding_amount, (SELECT COUNT(*) FROM ar_invoice_i0seqjfp_sub s WHERE s.ar_invoice_id = a.id) AS lines_,
       (SELECT COUNT(*) FROM ar_invoice_i0seqjfp_sub_closure c JOIN ar_invoice_i0seqjfp_sub s ON s.id = c.descendant_id WHERE s.ar_invoice_id = a.id) AS closure_,
       (SELECT COUNT(*) FROM ar_invoice_blade_dept j WHERE j.ar_invoice_id = a.id) AS links
  FROM ar_invoice a WHERE a.tenant_id = '{TENANT}' AND a.ar_invoice_no = '{SI_NO}' AND a.is_deleted = 0;
--   expect: {SI_NO} | Unpaid | {total:.8f} | {total:.8f} | {len(lines)} | {len(closure)} | 1
"""


def main():
    check_reference()
    m, header, junction, lines, closure = build_rows()
    sql = render(m, header, junction, lines, closure)
    open(OUT, "w", encoding="utf-8").write(sql)
    print(f"{SI_NO}: receivable {m['invoice_total']} with {len(lines)} lines; SO header -> Fully Invoiced; wrote {OUT}")


if __name__ == "__main__":
    main()
