"""Runs every sql-node of the built GET_ITEM_UNIT_PRICE_BULK READ-ONLY with placeholder values of a real request (every source
and the price tag switched on) and checks the returned columns against each node's declared response_json.
usage: python3 sqlcheck_unitprice.py"""
import json, os, re, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "grv2"))
from dbq import q

WF = "/Users/yunawinaya/Developer/BladeXfunctions/Purchase Order/GetItemUnitPriceBulk/GET_ITEM_UNIT_PRICE_BULK.json"
ENV = "--dev"
# dev tenant 711077: the 2k test PO's supplier + plant (history), a customer and a supplier with price tags
SETS = {
    "--dev": [
        {"tenantId": "711077", "organizationId": "2105190589240086530", "document_type": "procurement", "needFetch": "Yes", "fetchFrom": "Supplier",
         "suppCustIdSafe": "2105485513785249832", "plantIdSafe": "2105190589240086530", "side": "purchase",
         "pairsJson": '[["2105486802904584202","2105486663217483797"],["2105486802904584203","2105486663217483803"]]', "tagIdSql": "0", "needTag": "YES"},
        {"tenantId": "711077", "organizationId": "2105190589240086530", "document_type": "sd", "needFetch": "Yes", "fetchFrom": "Customer",
         "suppCustIdSafe": "2105486129379053588", "plantIdSafe": "2105190589240086530", "side": "sales",
         "pairsJson": '[["2105487062938849327","2105486663217483797"],["2105487062938849326","2105486663217483797"]]', "tagIdSql": "2105485160213811206",
         "needTag": "YES"},
        {"tenantId": "711077", "organizationId": "2105190589240086530", "document_type": "procurement", "needFetch": "Yes", "fetchFrom": "Supplier",
         "suppCustIdSafe": "2105485513785249810", "plantIdSafe": "2105190589240086530", "side": "purchase",
         "pairsJson": '[["2105492402287841328","2105486663217483791"]]', "tagIdSql": "2105485160213811209", "needTag": "YES"},
    ],
}
FLAGS = {"useSQT": "YES", "useSO": "YES", "useSI": "YES", "usePREQ": "YES", "usePO": "YES", "usePI": "YES"}


def walk(n, out):
    if isinstance(n, dict):
        if n.get("type") == "sql-node":
            out.append(n)
        for v in n.values():
            walk(v, out)
    elif isinstance(n, list):
        for v in n:
            walk(v, out)


nodes = []
walk(json.load(open(WF)), nodes)
bad = 0
for vals in SETS[ENV]:
    vals = dict(vals, **FLAGS)
    for n in nodes:
        sql = re.sub(r"\{\{node:[^}]+\.data\.(\w+)\}\}", lambda m: vals[m.group(1)], n["data"]["script"]["code"])
        if not sql.lstrip().upper().startswith(("SELECT", "WITH")):
            bad += 1
            print("FAIL %-18s does not start with SELECT / WITH" % n["id"])
            continue
        declared = [r["name"] for r in n["data"]["response_json"]]
        try:
            rows = q(ENV, sql)
            cols = list(rows[0].keys()) if rows else []
            miss = [c for c in cols if c not in declared]
            extra = [c for c in declared if rows and c not in cols]
            bad += bool(miss or extra)
            print("%s %-18s rows=%-5d %s%s" % ("ok  " if not miss and not extra else "COLS", n["id"], len(rows), ("undeclared " + str(miss)) if miss else "",
                                             (" unreturned " + str(extra)) if extra else ""))
        except BaseException as e:
            bad += 1
            print("FAIL %-18s %s" % (n["id"], str(e)[-400:]))
print("problems:", bad)
