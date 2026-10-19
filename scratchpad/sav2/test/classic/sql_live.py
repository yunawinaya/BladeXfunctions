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
ok("SA: the stored status of a real SA", q("--dev", fill(SA, tenantId=T, saId=SA_DRAFT)) == [{"stock_adjustment_status": stored[0]["s"]}], stored)
ok("SA: id 0 (a new SA) -> no row", q("--dev", fill(SA, tenantId=T, saId="0")) == [])
ok("SA: the right id in another tenant -> no row", q("--dev", fill(SA, tenantId=OTHER_T, saId=SA_DRAFT)) == [])
ok("SC: no Processing SA of a real SC -> busy_count 0", q("--dev", fill(SCQ, tenantId=T, scId=SC)) == [{"busy_count": 0}])
swapped = SCQ.replace("'Processing'", "'Completed'")
assert swapped != SCQ
ok("SC: status swapped to 'Completed' -> its real linked SA is counted (1)", q("--dev", fill(swapped, tenantId=T, scId=SC)) == [{"busy_count": 1}])
ok("SC: ... and not from another tenant (0)", q("--dev", fill(swapped, tenantId=OTHER_T, scId=SC)) == [{"busy_count": 0}])
ok("SC: id 0 (a new SC) -> 0", q("--dev", fill(swapped, tenantId=T, scId="0")) == [{"busy_count": 0}])
e = q("--dev", "EXPLAIN " + fill(SA, tenantId=T, saId=SA_DRAFT))
ok("SA EXPLAIN: one row by PRIMARY KEY (%s)" % [(x.get("type"), x.get("key")) for x in e], len(e) == 1 and e[0].get("key") == "PRIMARY", e)
e0 = q("--dev", "EXPLAIN " + fill(SCQ, tenantId=T, scId="0"))
ok("SC EXPLAIN id 0: no table access (%s)" % e0[0].get("Extra"), e0[0].get("table") is None and "Impossible WHERE" in str(e0[0].get("Extra")), e0)
e1 = q("--dev", "EXPLAIN " + fill(SCQ, tenantId=T, scId=SC))
n = q("--dev", "SELECT COUNT(*) AS n FROM stock_adjustment")[0]["n"]
print("info SC EXPLAIN stored id: type %s, key %s, rows %s (stock_adjustment has no index on stock_count_id; %s rows on dev)"
      % (e1[0].get("type"), e1[0].get("key"), e1[0].get("rows"), n))
print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
