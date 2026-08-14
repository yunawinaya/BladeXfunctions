"""Offline semantic test of the Customer Statement SQL.

The MySQL query is transpiled to SQLite and the handful of MySQL-only
functions are shimmed as Python UDFs, so the FILTER LOGIC (param
normalisation, switch gating, date parsing, aging buckets) is exercised
for real. Table/column names and the join graph still need a live run.
"""
import json, re, sqlite3, sqlglot, datetime

WF = "Customer Statement/CSgenerateFilterWorkflow.json"
MYSQL = json.load(open(WF))["nodes"][1]["data"]["script"]["code"]

# The SQL ages against CURDATE(), which SQLite resolves to the real today, so any
# expected day-count has to be derived rather than hard-coded -- a literal drifts
# by one every midnight.
TODAY = datetime.date.today()


def substitute(params):
    s = MYSQL
    for k, v in params.items():
        s = s.replace("{{workflowparams:%s}}" % k, v)
    s = s.replace("{{global:firstLvDeptId}}", "7100")
    assert "{{" not in s, "unsubstituted placeholder"
    return s


def to_sqlite(s):
    out = sqlglot.transpile(s, read="mysql", write="sqlite")[0]
    return out.replace("DATE(p.date_to, '1 DAY')", "DATE(p.date_to, '+1 day')")


def connect():
    db = sqlite3.connect(":memory:")
    db.create_function("SUBSTRING_INDEX", 3,
        lambda s, d, n: d.join(s.split(d)[:n]) if n > 0 else d.join(s.split(d)[n:]))
    db.create_function("REGEXP_LIKE", 2, lambda s, p: 1 if re.search(p, s or "") else 0)
    db.create_function("UNIX_TO_TIME", 1,
        lambda x: datetime.datetime.utcfromtimestamp(float(x)).strftime("%Y-%m-%d %H:%M:%S"))
    db.create_function("FIND_IN_SET", 2,
        lambda needle, hay: (hay.split(",").index(needle) + 1) if needle in hay.split(",") else 0)
    db.execute("""CREATE TABLE ar_invoice (id, ar_invoice_no, invoice_date, due_date,
        customer_id, area_id, project_id, agent_id, payment_term_id, payment_status,
        invoice_total_currency, invoice_total, myr_invoice_total, outstanding_amount,
        organization_id, plant_id, is_deleted)""")
    db.execute("CREATE TABLE customer (id, customer_id, customer_com_name)")
    db.execute("CREATE TABLE area (id, area_code)")
    db.execute("CREATE TABLE project (id, project_code)")
    db.execute("CREATE TABLE agent (id, agent_name)")
    db.execute("CREATE TABLE payment_terms (id, term_name)")
    db.executemany("INSERT INTO customer VALUES (?,?,?)", [
        ("1001", "C-001", "Alpha Sdn Bhd"), ("1002", "C-002", "Beta Trading")])
    db.executemany("INSERT INTO area VALUES (?,?)", [("5001", "NORTH"), ("5002", "SOUTH")])
    db.executemany("INSERT INTO project VALUES (?,?)", [("6001", "PRJ-A")])
    db.executemany("INSERT INTO agent VALUES (?,?)", [("7001", "Lee")])
    db.executemany("INSERT INTO payment_terms VALUES (?,?)", [("8001", "30 Days")])

    def inv(no, idate, ddate, cust, area, proj, status="Unpaid", outstanding=100.0,
            org="7100", deleted=0, agent="7001", term="8001", plant="7100"):
        return (no, no, idate, ddate, cust, area, proj, agent, term, status,
                "MYR", 100.0, 100.0, outstanding, org, plant, deleted)

    db.executemany("INSERT INTO ar_invoice VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [
        # aging ladder for customer 1001 (due dates relative to 2026-08-13)
        inv("INV-CUR", "2026-08-01", "2026-09-30", "1001", "5001", "6001"),   # not due -> current
        inv("INV-030", "2026-07-01", "2026-08-01", "1001", "5001", "6001"),   # 12 days -> 1-30
        inv("INV-060", "2026-06-01", "2026-07-01", "1001", "5001", "6001"),   # 43 -> 31-60
        inv("INV-090", "2026-05-01", "2026-06-01", "1001", "5002", None),     # 73 -> 61-90
        inv("INV-90P", "2026-01-01", "2026-02-01", "1001", None, None),       # 193 -> 90+
        # other customer / excluded rows
        inv("INV-BETA", "2026-08-05", "2026-09-05", "1002", "5002", "6001"),
        inv("INV-CANX", "2026-08-05", "2026-09-05", "1001", "5001", "6001", status="Cancelled"),
        inv("INV-DEL",  "2026-08-05", "2026-09-05", "1001", "5001", "6001", deleted=1),
        inv("INV-ORG",  "2026-08-05", "2026-09-05", "1001", "5001", "6001", org="9999"),
        inv("INV-PAID", "2026-08-06", "2026-09-06", "1002", "5002", "6001",
            status="Paid", outstanding=0.0),
        # the real trace row: organization_id NULL, plant_id carries the dept id
        inv("INV-LEGACY", "2026-07-14", "2026-07-14", "1001", "5001", None,
            status="Paid", outstanding=-5567.75, org=None, plant="7100"),
        # both org columns point elsewhere -> must still be excluded
        inv("INV-OTHERORG", "2026-07-14", "2026-07-14", "1001", "5001", None,
            org=None, plant="9999"),
    ])
    return db


ALL_OFF = dict(customer_ids="", area_ids="", project_ids="", date_range="",
               statement_date="", customer_switch="0", area_switch="0",
               project_switch="0", date_range_switch="0", statement_date_switch="0")


def run(**over):
    p = dict(ALL_OFF); p.update(over)
    db = connect()
    cur = db.execute(to_sqlite(substitute(p)))
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def nos(rows):
    return [r["ar_invoice_no"] for r in rows]


FAIL = []
RAN = []
def check(label, got, want):
    ok = got == want
    RAN.append(label)
    print(("PASS  " if ok else "FAIL  ") + label)
    if not ok:
        print("        got  =", got)
        print("        want =", want)
        FAIL.append(label)


# 1. no filters -> everything except Cancelled / deleted / other-org, sorted
check("no filters: excludes Cancelled, is_deleted, other org",
      nos(run()),
      ["INV-90P", "INV-090", "INV-060", "INV-030", "INV-LEGACY", "INV-CUR",
       "INV-BETA", "INV-PAID"])

# --- the bug the live trace exposed -------------------------------------------
check("row with NULL organization_id is found via plant_id",
      "INV-LEGACY" in nos(run()), True)
check("NULL organization_id + foreign plant_id is still excluded",
      "INV-OTHERORG" in nos(run()), False)

# 2. customer filter, JSON-array form
check("customer filter (JSON array)",
      sorted(nos(run(customer_switch="1", customer_ids='["1002"]'))),
      ["INV-BETA", "INV-PAID"])

# 3. same, bare comma list + two ids
check("customer filter (bare list, 2 ids)",
      sorted(nos(run(customer_switch="1", customer_ids="1001,1002"))),
      ["INV-030", "INV-060", "INV-090", "INV-90P", "INV-BETA", "INV-CUR",
       "INV-LEGACY", "INV-PAID"])

# 4. switch OFF but a stale value present -> filter must be ignored
check("stale value behind an OFF switch is ignored",
      len(run(customer_switch="0", customer_ids='["1002"]')), 8)

# 5. switch ON but empty value -> no filter (function blocks this, SQL degrades safely)
check("switch ON with empty value degrades to no filter",
      len(run(customer_switch="1", customer_ids="")), 8)

# 6. unresolved placeholder substitutes as literal `null`
check("literal 'null' param is treated as empty",
      len(run(customer_switch="1", customer_ids="null")), 8)

# 7. date range, string form
check("date range (string array)",
      sorted(nos(run(date_range_switch="1", date_range='["2026-07-01","2026-08-31"]'))),
      ["INV-030", "INV-BETA", "INV-CUR", "INV-LEGACY", "INV-PAID"])

# 8. date range boundary is inclusive on the end date
check("date range end date is inclusive",
      nos(run(date_range_switch="1", date_range='["2026-08-01","2026-08-01"]')),
      ["INV-CUR"])

# 9. date range, epoch millis form
ms = lambda d: str(int(datetime.datetime.strptime(d, "%Y-%m-%d")
                       .replace(tzinfo=datetime.timezone.utc).timestamp() * 1000))
check("date range (epoch millis)",
      sorted(nos(run(date_range_switch="1",
                     date_range="[%s, %s]" % (ms("2026-07-01"), ms("2026-08-31"))))),
      ["INV-030", "INV-BETA", "INV-CUR", "INV-LEGACY", "INV-PAID"])

# 10. statement_date is display-only: it must NOT filter rows. Its param and
#     switch are still declared and still bound by the list page, so the values
#     do arrive -- the query simply has to ignore them.
check("statement_date does NOT filter rows (switch on, value set)",
      nos(run(statement_date_switch="1", statement_date="2026-08-05")),
      nos(run()))
check("statement_date does NOT filter rows (value matching no invoice)",
      nos(run(statement_date_switch="1", statement_date="1999-01-01")),
      nos(run()))

# 11. area + project filters
check("area filter", sorted(nos(run(area_switch="1", area_ids='["5002"]'))),
      ["INV-090", "INV-BETA", "INV-PAID"])
check("project filter", sorted(nos(run(project_switch="1", project_ids='["6001"]'))),
      ["INV-030", "INV-060", "INV-BETA", "INV-CUR", "INV-PAID"])

# 12. filters AND together
check("customer AND area AND together",
      nos(run(customer_switch="1", customer_ids='["1001"]',
              area_switch="1", area_ids='["5002"]')),
      ["INV-090"])

# 13. aging buckets land in exactly one column each, and sum to outstanding
BUCKETS = ["aging_current", "aging_1_30", "aging_31_60", "aging_61_90", "aging_90_plus"]
rows = {r["ar_invoice_no"]: r for r in run()}
placement = {n: [b for b in BUCKETS if rows[n][b] != 0] for n in
             ["INV-CUR", "INV-030", "INV-060", "INV-090", "INV-90P"]}
check("each invoice lands in exactly one aging bucket", placement, {
    "INV-CUR": ["aging_current"], "INV-030": ["aging_1_30"],
    "INV-060": ["aging_31_60"], "INV-090": ["aging_61_90"],
    "INV-90P": ["aging_90_plus"]})
check("buckets sum to outstanding_amount",
      all(round(sum(r[b] for b in BUCKETS), 2) == r["outstanding_amount"]
          for r in rows.values()), True)
check("a fully-paid invoice contributes 0 to every bucket",
      [rows["INV-PAID"][b] for b in BUCKETS], [0, 0, 0, 0, 0])

# 14. aging is anchored to CURDATE() and nothing else. statement_date must not
#     move the reference date in either switch position -- back-dating it used to
#     re-age every row, and that is exactly the behaviour being removed.
DUE_030 = datetime.date(2026, 8, 1)          # INV-030 is dated 2026-07-01, due 2026-08-01
check("aging is measured from today, not from any param",
      rows["INV-030"]["days_overdue"], max((TODAY - DUE_030).days, 0))
for label, over in [
    ("switch off", dict(statement_date_switch="0", statement_date="2026-10-01")),
    ("switch on, back-dated", dict(statement_date_switch="1", statement_date="2026-07-01")),
    ("switch on, future-dated", dict(statement_date_switch="1", statement_date="2027-01-01")),
]:
    got = {r["ar_invoice_no"]: r["days_overdue"] for r in run(**over)}
    # .get() rather than [] on purpose: if a statement_date predicate ever comes
    # back, these rows vanish instead of re-aging, and the check must report a
    # clean FAIL (None != n) rather than dying on a KeyError.
    check("statement_date does NOT move the aging reference (%s)" % label,
          {n: got.get(n) for n in rows}, {n: rows[n]["days_overdue"] for n in rows})

# 15. missing lookups become '' rather than dropping the row (LEFT JOIN)
check("null area/project become empty strings, row survives",
      [rows["INV-90P"]["area_code"], rows["INV-90P"]["project_code"],
       rows["INV-90P"]["customer_id"]], ["", "", "C-001"])

print("\n%d/%d passed" % (len(RAN) - len(FAIL), len(RAN)))
print("FAILURES:", FAIL if FAIL else "none")
raise SystemExit(1 if FAIL else 0)
