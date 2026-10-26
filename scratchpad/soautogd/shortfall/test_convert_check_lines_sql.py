"""test_convert_check_lines_sql.py: GD_SO_CONVERT_CHECK's sql_node_SClines, taken from the workflow JSON and run READ-ONLY on
DEV through .dbtools/db with its placeholders filled as the platform fills them (text, hand-quoted in the SQL).

1. must-match: dev job 2112387426529939457 (tenant 000000, SO/20261020-049, P-00002 100,000 PCS vs 15,837) -> its one line.
2. edge cases: a CTE named gd_async_job shadows the real table for the statement, so the SQL under test runs unchanged on
   made-up jobs (invalid JSON, 12 errors, QUEUED, CANCEL_GD, a header error, a unit id in the message, a line not in the
   payload, a description line). item / unit_of_measurement stay the real dev tables (P-00002 / PCS exist there).

usage: python3 test_convert_check_lines_sql.py [GD_SO_CONVERT_CHECK.json]
"""
import json
import os
import subprocess
import sys

R = "/Users/yunawinaya/Developer/BladeXfunctions"
P = sys.argv[1] if len(sys.argv) > 1 else R + "/Goods Delivery/AsyncV2/GD_SO_CONVERT_CHECK.json"
DB = R + "/.dbtools/db"
P2 = "2066341864143695874"  # dev item P-00002 / POST 2, base unit PCS
PCS = "2018906563477008389"


def find(o, nid):
    if isinstance(o, dict):
        if o.get("id") == nid:
            return o
        for v in o.values():
            r = find(v, nid)
            if r:
                return r
    elif isinstance(o, list):
        for v in o:
            r = find(v, nid)
            if r:
                return r
    return None


node = find(json.load(open(P, encoding="utf-8")), "sql_node_SClines")
if not node:
    print("FAIL no sql_node_SClines in " + P)
    sys.exit(1)
SQL = node["data"]["script"]["code"]
COLS = [f["name"] for f in node["data"]["response_json"]]


def fill(job_ids, want="1", tenant="000000"):
    vals = {"node:code_node_SCguard.data.jobIdsJson": json.dumps(job_ids), "node:code_node_SCguard.data.wantLines": want,
            "system:tenantId": tenant}
    out = SQL
    for k, v in vals.items():
        out = out.replace("{{" + k + "}}", v)
    assert "{{" not in out, "unfilled placeholder: " + out[out.index("{{"):out.index("{{") + 60]
    return out


def query(sql):
    p = subprocess.run([DB, "--dev", "--json", sql], capture_output=True, text=True)
    lines = [ln for ln in p.stdout.splitlines() if not ln.startswith("[DEV]")]
    if p.returncode != 0 or not lines:
        raise RuntimeError("query failed: " + (p.stderr or p.stdout)[-1500:])
    return json.loads("\n".join(lines))


fails = 0


def t(name, ok, got=None):
    global fails
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  " + json.dumps(got, ensure_ascii=False)[:900]))
    if not ok:
        fails += 1


def norm(rows):
    """the row as the result node sees it: a NULL column is a missing key, so read every column as text"""
    return [{c: ("" if r.get(c) is None else str(r.get(c))) for c in COLS} for r in rows]


# 1. the real dev job
real = norm(query(fill(["2112387426529939457"])))
want = {"job_id": "2112387426529939457", "line_no": "1", "code": "GD_INSUFFICIENT_STOCK",
        "message": "auto allocation: Insufficient stock for item P-00002. Available: 15837, Requested: 100000",
        "item_code": "P-00002", "item_name": "POST 2", "uom": "PCS", "order_qty": "100000", "undelivered_qty": "100000",
        "delivery_qty": "100000", "base_qty": "100000"}
t("dev job 2112387426529939457: its one refused line, item, unit and quantities", len(real) == 1 and all(real[0].get(k) == v for k, v in want.items()), real)
t("not asked (wantLines 0): nothing read", query(fill(["2112387426529939457"], want="0")) == [])
t("another tenant's job: nothing", query(fill(["2112387426529939457"], tenant="711077")) == [])
t("no job ids: nothing", query(fill([])) == [])


# 2. made-up jobs through a CTE that shadows gd_async_job
def line(i, **kw):
    d = {"stable_line_key": "L%d" % i, "line_no": i, "material_id": P2, "material_name": "P-00002", "good_delivery_uom_id": PCS,
         "gd_order_quantity": "10", "gd_undelivered_qty": 8, "gd_qty": "8", "base_qty": 8}
    d.update(kw)
    return d


def err(i, code="GD_INSUFFICIENT_STOCK", msg=None, key=None, no=None):
    return {"code": code, "field": "temp_qty_data", "line_no": i if no is None else no, "stable_line_key": "L%d" % i if key is None else key,
            "message": msg or "auto allocation: Insufficient stock for item P-00002. Available: %d, Requested: 8" % i}


def lit(v):
    return "'" + str(v).replace("\\", "\\\\").replace("'", "''") + "'"


jobs = [
    # id, command, status, error_details, request_payload
    (1, "CREATE_GD_FROM_FORM", "FAILED", json.dumps({"line_errors": [err(i) for i in range(1, 13)], "line_error_count": 12}),
     json.dumps({"lines": [line(i) for i in range(1, 13)]})),
    (2, "CREATE_GD_FROM_FORM", "FAILED", "not json {", json.dumps({"lines": [line(1)]})),
    (3, "CREATE_GD_FROM_FORM", "FAILED", json.dumps({"line_errors": [err(1)]}), "not json either"),
    (4, "CREATE_GD_FROM_FORM", "FAILED",
     json.dumps({"line_errors": [err(1, "GD_INVALID_UOM", "unit %s has no conversion to the base unit of the material" % PCS)]}),
     json.dumps({"lines": [line(1)]})),
    (5, "CREATE_GD_FROM_FORM", "QUEUED", json.dumps({"line_errors": [err(1)]}), json.dumps({"lines": [line(1)]})),
    (6, "CANCEL_GD", "FAILED", json.dumps({"line_errors": [err(1)]}), json.dumps({"lines": [line(1)]})),
    (7, "CREATE_GD_FROM_FORM", "FAILED",
     json.dumps({"line_errors": [{"code": "GD_CREDIT_LIMIT_BLOCKED", "field": "credit_limit", "line_no": None, "stable_line_key": "",
                                  "message": "Credit limit exceeded"}]}), json.dumps({"lines": [line(1)]})),
    (8, "CREATE_GD_FROM_FORM", "FAILED", json.dumps({"line_errors": [err(9), err(2, "GD_INVALID_DATA", "description line refused")]}),
     json.dumps({"lines": [line(1), line(2, material_id="", material_name="FREE TEXT", good_delivery_uom_id="", base_qty=None)]})),
    (9, "CREATE_GD_FROM_FORM", "FAILED", json.dumps({"line_errors": [err(1, msg="x" * 3000)]}), json.dumps({"lines": [line(1)]})),
]
cte = "WITH gd_async_job AS (" + " UNION ALL ".join(
    "SELECT %d AS id, '000000' AS tenant_id, %s AS command, %s AS job_status, 0 AS is_deleted, %s AS error_details, %s AS request_payload"
    % (i, lit(c), lit(st), lit(ed), lit(rp)) for (i, c, st, ed, rp) in jobs) + ") "
rows = norm(query(cte + fill([str(j[0]) for j in jobs])))
by = {}
for r in rows:
    by.setdefault(r["job_id"], []).append(r)
j1 = by.get("1", [])
t("12 line errors: the first 10, in order", [r["line_no"] for r in j1] == [str(i) for i in range(1, 11)], j1)
t("each joined to its payload line (quantities as text)", all(r["delivery_qty"] == "8" and r["undelivered_qty"] == "8" and r["order_qty"] == "10"
                                                             and r["base_qty"] == "8" and r["item_code"] == "P-00002" and r["uom"] == "PCS" for r in j1), j1[:2])
t("invalid error_details: no rows, no error", "2" not in by, by.get("2"))
j3 = by.get("3", [])
t("invalid payload: the line error alone, no item", len(j3) == 1 and j3[0]["line_no"] == "1" and j3[0]["item_code"] == "" and j3[0]["delivery_qty"] == "", j3)
j4 = by.get("4", [])
t("a unit id in the message -> its name", len(j4) == 1 and j4[0]["message"] == "unit PCS has no conversion to the base unit of the material", j4)
t("QUEUED and CANCEL_GD jobs: nothing", "5" not in by and "6" not in by, [by.get("5"), by.get("6")])
j7 = by.get("7", [])
t("a header error: line_no empty, no item", len(j7) == 1 and j7[0]["line_no"] == "" and j7[0]["item_code"] == "" and j7[0]["message"] == "Credit limit exceeded", j7)
j8 = by.get("8", [])
t("an error for a line not in the payload: no item; a description line: its own text as the code, no unit, no name",
  len(j8) == 2 and j8[0]["line_no"] == "9" and j8[0]["item_code"] == "" and j8[1]["item_code"] == "FREE TEXT" and j8[1]["item_name"] == ""
  and j8[1]["uom"] == "" and j8[1]["base_qty"] == "", j8)
j9 = by.get("9", [])
t("a 3,000-character message: the row is kept (message cut, no error)", len(j9) == 1 and 0 < len(j9[0]["message"]) <= 1000, [len(r["message"]) for r in j9])

print("ALL PASSED" if not fails else "%d FAILED" % fails)
sys.exit(1 if fails else 0)
