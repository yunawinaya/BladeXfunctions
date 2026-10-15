"""test_sql_scope.py: every table an sql-node of the four GD_EDIT workflows reads is scoped to the session tenant: its alias
carries `<alias>.tenant_id` in the same statement, or it is listed in PARENT (correlated to / filtered through a row that
is). Ids from the request (the delta's SO / line / material ids) then never reach another tenant's rows.

usage: python3 test_sql_scope.py   (exit 1 on an unscoped table)
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "..", "Goods Delivery", "EditV2")
# alias -> why it is scoped without its own predicate (checked per statement: the parent must be named in it)
PARENT = {
    ("item_mji552rc_sub", "u"): ("u.Item_id = i.id", "an item's UOM rows, correlated to the scoped item"),
    ("item_wu520fpw_sub", "b"): ("b.Item_id = i.id", "an item's default bins, correlated to the scoped item"),
    ("transfer_order_jz8m9w3h_sub", "pi"): ("transfer_order_id IN (SELECT t.id FROM transfer_order t WHERE t.tenant_id", "rows of the scoped Pickings"),
    ("transfer_order_vrqs3cmr_sub", "pr"): ("transfer_order_id IN (SELECT t.id FROM transfer_order t WHERE t.tenant_id", "records of the scoped Pickings"),
    ("gd_publish_step", "lk"): ("WHERE p.tenant_id = j.tenant_id AND p.job_id = CONCAT('GDC|'", "the lock row picked by id from the job's tenant-scoped subquery"),
}
TABLE = re.compile(r"\b(?:FROM|JOIN)\s+([a-z][a-z0-9_]*)\s+(?:AS\s+)?([a-z][a-z0-9_]*)\b", re.I)
KEYWORDS = {"where", "on", "join", "left", "inner", "group", "order", "limit", "union", "set", "and", "or"}


def sql_nodes(doc):
    out = []

    def walk(n):
        if isinstance(n, dict):
            if n.get("type") == "sql-node":
                d = n.get("data") or {}
                out.append((n["id"], ((d.get("script") or {}).get("code") or d.get("sql") or "")))
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(doc)
    return out


bad, seen = 0, 0
for name in ("GD_EDIT_PREPARE", "GD_EDIT_SUBMIT", "GD_EDIT_WORKER", "GD_EDIT_COMMIT"):
    for nid, sql in sql_nodes(json.load(open(os.path.join(OUT, name + ".json")))):
        for table, alias in TABLE.findall(sql):
            if alias.lower() in KEYWORDS or table.upper() == "JSON_TABLE":
                continue
            seen += 1
            if re.search(r"(?<![A-Za-z0-9_])%s\.`?tenant_id`?\s*=" % re.escape(alias), sql):
                continue
            why = PARENT.get((table, alias))
            if why and why[0] in sql:
                continue
            bad += 1
            print("UNSCOPED %s %s: %s %s" % (name, nid, table, alias))
print(json.dumps({"tables": seen, "unscoped": bad}))
sys.exit(1 if bad else 0)
