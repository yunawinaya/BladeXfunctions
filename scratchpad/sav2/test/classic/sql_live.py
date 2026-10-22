"""(d) The guard SQL as BUILT, run read-only on dev (lib/dbq.py -> .dbtools/db, SELECT / EXPLAIN only) on real rows.
usage: python3 test/classic/sql_live.py
Dev has no Processing SA, so the SC read is also run with its status literal swapped to 'Completed' to prove the filters match
a real linked SA (SA 2110229114286899201 of SC 2110229071278505985, tenant 000000). EXPLAIN shows each access path."""
import json
import os
import re
import sys

sys.dont_write_bytecode = True  # no __pycache__ next to the builders

HERE = os.path.dirname(os.path.abspath(__file__))
SAV2 = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(SAV2, "lib"))
sys.path.insert(0, SAV2)
from dbq import q  # noqa: E402
import build_classic as B  # noqa: E402

T, SA_DRAFT, SC, OTHER_T = "000000", "2094647004894920705", "2110229071278505985", "496474"
fails = []


def ok(label, cond, extra=""):
    print(("ok   " if cond else "FAIL ") + label + ("" if cond else "  " + str(extra)[:400]))
    if not cond:
        fails.append(label)


def built_sql(name, nid):
    doc = json.load(open(os.path.join(B.OUT_DIRS[name], name + ".json"), encoding="utf-8"))
    return B.index(doc)[nid]["data"]["script"]["code"]


def fill(sql, **kw):
    out = re.sub(r"\{\{node:[^}]+\.data\.(\w+)\}\}", lambda m: kw[m.group(1)], sql)
    assert "{{" not in out
    return out


SA = built_sql("STOCK_ADJUSTMENT", "sql_node_SAguard")
SCQ = built_sql("STOCK_COUNT", "sql_node_SCguard")
stored = q("--dev", "SELECT stock_adjustment_status AS s FROM stock_adjustment WHERE id = %s" % SA_DRAFT)
NOLOCK = dict(lockTenantId="0", orgId="0", lockKeysJson="[]")
ok("SA: the stored status of a real SA", q("--dev", fill(SA, tenantId=T, saId=SA_DRAFT, **NOLOCK)) == [{"stock_adjustment_status": stored[0]["s"], "lock_key": None,
   "owner_operation_id": None}], stored)
ok("SA: id 0 (a new SA) -> no row", q("--dev", fill(SA, tenantId=T, saId="0", **NOLOCK)) == [])
ok("SA: the right id in another tenant -> no row", q("--dev", fill(SA, tenantId=OTHER_T, saId=SA_DRAFT, **NOLOCK)) == [])
# the lock part on real dev rows: the SAV2T test items' ITEM / COST keys (tenant 496474), free now -> no row; the held test flipped
# to match FREE rows -> exactly those rows (key list / org / tenant matching proven on real data)
LT, LORG = "496474", "1901545950162329602"
KEYS = ["COST|2111092118006435842|1942795438353035266", "ITEM|2111092118006435842|2098295393555369986"]
LK = dict(lockTenantId=LT, orgId=LORG, lockKeysJson=json.dumps(KEYS))
real = q("--dev", "SELECT lock_key, free_token FROM inventory_balance_lock WHERE tenant_id = '%s' AND organization_id = '%s' AND lock_key IN (%s) AND is_deleted = 0"
         % (LT, LORG, ",".join("'%s'" % k for k in KEYS)))
ok("SA lock part: the 2 test keys exist on dev", sorted(r["lock_key"] for r in real) == KEYS, real)
held_now = [r for r in q("--dev", fill(SA, tenantId=T, saId="0", **LK))]
ok("SA lock part: free keys -> no row (held now: %d)" % len(held_now), held_now == [] or all(str(r["free_token"]) == "0" for r in real), held_now)
flip = SA.replace("l.free_token = 0", "l.free_token = 1").replace("COALESCE(l.owner_operation_id, '') <> ''", "COALESCE(l.owner_operation_id, '') = ''")
assert flip != SA
got = q("--dev", fill(flip, tenantId=T, saId="0", **LK))
ok("SA lock part flipped to free rows -> exactly the 2 keys", sorted(r["lock_key"] for r in got) == KEYS and all(r["stock_adjustment_status"] is None for r in got), got)
ok("SA lock part flipped, another tenant (000000) -> no row", q("--dev", fill(flip, tenantId=T, saId="0", **dict(LK, lockTenantId=T))) == [])
ok("SA lock part flipped, another organization -> no row", q("--dev", fill(flip, tenantId=T, saId="0", **dict(LK, orgId="1"))) == [])
ok("SC: no Processing SA of a real SC -> busy_count 0", q("--dev", fill(SCQ, tenantId=T, scId=SC)) == [{"busy_count": 0}])
swapped = SCQ.replace("'Processing'", "'Completed'")
assert swapped != SCQ
ok("SC: status swapped to 'Completed' -> its real linked SA is counted (1)", q("--dev", fill(swapped, tenantId=T, scId=SC)) == [{"busy_count": 1}])
ok("SC: ... and not from another tenant (0)", q("--dev", fill(swapped, tenantId=OTHER_T, scId=SC)) == [{"busy_count": 0}])
ok("SC: id 0 (a new SC) -> 0", q("--dev", fill(swapped, tenantId=T, scId="0")) == [{"busy_count": 0}])
e = q("--dev", "EXPLAIN " + fill(SA, tenantId=T, saId=SA_DRAFT, **LK))
sa_rows = [x for x in e if x.get("table") == "g"]
lk_rows = [x for x in e if x.get("table") == "l"]
ok("SA EXPLAIN: the status by PRIMARY KEY, the lock rows by an index (%s)" % [(x.get("table"), x.get("type"), x.get("key")) for x in e],
   len(sa_rows) == 1 and sa_rows[0].get("key") == "PRIMARY" and len(lk_rows) == 1 and lk_rows[0].get("type") != "ALL" and lk_rows[0].get("key"), e)
e0 = q("--dev", "EXPLAIN " + fill(SCQ, tenantId=T, scId="0"))
ok("SC EXPLAIN id 0: no table access (%s)" % e0[0].get("Extra"), e0[0].get("table") is None and "Impossible WHERE" in str(e0[0].get("Extra")), e0)
e1 = q("--dev", "EXPLAIN " + fill(SCQ, tenantId=T, scId=SC))
n = q("--dev", "SELECT COUNT(*) AS n FROM stock_adjustment")[0]["n"]
print("info SC EXPLAIN stored id: type %s, key %s, rows %s (stock_adjustment has no index on stock_count_id; %s rows on dev)"
      % (e1[0].get("type"), e1[0].get("key"), e1[0].get("rows"), n))
print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
