"""COMMIT's two lookups of the SO a new-SO job inserted (sql_node_SCfind / SCfind2), as built: the old OR is two UNION
branches, each off for an edit, the Draft branch keeping every old Draft condition under a snowflake id floor. Their
results were proven equal on prod and dev by sql_parity.py; this pins the text offline.

usage: python3 scratchpad/sosave_perf/test/test_find_sql.py [<built SO_SAVE_COMMIT.json>]   (default: out/preshake/)
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "out", "preshake", "SO_SAVE_COMMIT.json")
GATE = "'{{node:code_node_SCgate.data.isEdit}}' = 'NO'"
TENANT = "s.tenant_id = '{{node:code_node_SCguard.data.tenantId}}'"
ORG = "s.organization_id = '{{node:code_node_SCgate.data.organizationId}}'"
TEMP = "s.so_no = '{{node:code_node_SCgate.data.tempNo}}'"
JOB_USER = ("s.create_user = (SELECT j.create_user FROM gd_async_job j WHERE j.tenant_id = '{{node:code_node_SCguard.data.tenantId}}'"
            " AND j.id = {{node:code_node_SCgate.data.jobId}})")
fails = 0


def check(name, ok):
    global fails
    print(("ok   " if ok else "FAIL ") + name)
    fails += 0 if ok else 1


def nodes(path):
    out = {}
    def walk(ns):
        for n in ns:
            out[n["id"]] = n
            walk(n.get("blocks") or [])
    walk(json.load(open(path))["nodes"])
    return out


built = nodes(FILE)
base = nodes(os.path.join(ROOT, "base", "SO_SAVE_COMMIT.v10.json"))
for node_id, since in (("sql_node_SCfind", "{{node:code_node_SCgate.data.draftSince}}"), ("sql_node_SCfind2", "{{node:code_node_SCa.data.draftSince}}")):
    sql = built[node_id]["data"]["script"]["code"]
    old = base[node_id]["data"]["script"]["code"]
    parts = sql.split("\nUNION\n")
    check(f"{node_id}: two branches joined by UNION", len(parts) == 2)
    if len(parts) != 2:
        continue
    where = [p[p.index("\n WHERE ") + 8:] for p in parts]
    conds = [set(c.strip() for c in re.split(r"\n\s+AND ", w)) for w in where]
    check(f"{node_id}: each branch is off for an edit (its first condition is the isEdit gate)", all(w.startswith(GATE) for w in where))
    check(f"{node_id}: the temporary-number branch is the old TEMP condition with the tenant, org and is_deleted",
          conds[0] == {GATE, TEMP, ORG, TENANT, "s.is_deleted = 0"})
    floor = f"s.id >= GREATEST(0, UNIX_TIMESTAMP('{since}') * 1000 - 1288834974657 - 172800000) * 4194304"
    check(f"{node_id}: the Draft branch is the old Draft condition plus the sentinel guard and an id floor 2 days before draftSince",
          conds[1] == {GATE, f"'{since}' < '9999'", floor, TENANT, "s.is_deleted = 0", ORG, "s.so_status = 'Draft'",
                       "COALESCE(s.is_processing, 0) = 1", JOB_USER, f"s.create_time >= '{since}'"})
    check(f"{node_id}: no OR left (the OR made the scan)", " OR " not in sql)
    select = lambda q: q[: q.index("\n  FROM sales_order s")]
    check(f"{node_id}: both branches select the old columns", all(select(p) == select(old) for p in parts))
    holders = set(re.findall(r"\{\{[^}]+\}\}", sql))
    check(f"{node_id}: the only new placeholder is the isEdit gate",
          holders - set(re.findall(r"\{\{[^}]+\}\}", old)) == {"{{node:code_node_SCgate.data.isEdit}}"})

print("all passed" if not fails else f"{fails} FAILED")
raise SystemExit(1 if fails else 0)
