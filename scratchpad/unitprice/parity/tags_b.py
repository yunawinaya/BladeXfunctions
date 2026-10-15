"""(b) price tag row order (READ-ONLY): item + UOM + party groups with 2+ live rows valid today (tiered quantity prices). Per group
and quantity (null, 0, each row's bounds and points between): the classic's per-line SQL vs the bulk's set SQL + the resolver's
quantity filter, as ordered row lists. usage: python3 tags_b.py --dev|--prod [groups per side]"""
import collections, json, sys
sys.path.insert(0, "../../grv2")
from dbq import q
from bulk_sql import render, coerce
import classic_sql as C
from parity_b import in_range, sql_qty, diag_tag, TAG_COLS

ENV = "--prod" if "--prod" in sys.argv else "--dev"
N = int(([a for a in sys.argv[1:] if a.isdigit()] or ["40"])[0])
VALID = "((@F_from IS NULL AND @F_to IS NULL) OR (@F_from < CURDATE() AND @F_to IS NULL) OR (@F_from IS NULL AND @F_to > CURDATE()) OR (@F_from < CURDATE() AND @F_to > CURDATE()))"
tot, bad = collections.Counter(), []
for who, table, pre, party, doc in (("Customer", "item_i9q0d8uj_sub", "cust", "customer_id", "sd"), ("Supplier", "item_qd8nxw32_sub", "sup", "supplier_id", "procurement")):
    valid = VALID.replace("@F", "x.%s_price_date" % pre)
    groups = q(ENV, f"""SELECT x.tenant_id, CAST(x.Item_id AS CHAR) item, CAST(x.{pre}_price_uom AS CHAR) uom, x.{party} party, COUNT(*) n,
       GROUP_CONCAT(CONCAT(x.{pre}_min_order_qty, ':', x.{pre}_max_order_qty) ORDER BY x.id) bounds
  FROM {table} x WHERE x.is_deleted = 0 AND x.{party} REGEXP '^[0-9]+$' AND {valid}
 GROUP BY x.tenant_id, x.Item_id, x.{pre}_price_uom, x.{party} HAVING COUNT(*) > 1 ORDER BY COUNT(*) DESC, MAX(x.id) DESC LIMIT {N}""")
    tot[who + " groups"] += len(groups)
    for g in groups:
        qs = {None, 0}
        for b in g["bounds"].split(","):
            lo, hi = (float(v) if v not in ("", "None") else None for v in b.split(":"))
            for v in (lo, hi):
                if v is not None:
                    qs.update({v, v + 0.5, max(v - 0.5, 0)})
        # the party's own tag id, as the classic's get-node reads it
        crow = q(ENV, "SELECT price_tag_id FROM %s WHERE id = '%s' AND is_deleted = 0" % ("customer" if who == "Customer" else "supplier_head", g["party"]))
        tag_id = crow[0]["price_tag_id"] if crow else None
        keys = {"pairsJson": json.dumps([[g["item"], g["uom"]]]), "tenantId": g["tenant_id"], "fetchFrom": who, "suppCustIdSafe": g["party"]}
        plan = {"needTag": "YES", "tagIdSql": tag_id if tag_id and str(tag_id).isdigit() else "0"}
        mine_all = q(ENV, diag_tag(render("sql_node_UPtag", keys, plan)))
        for qty in sorted(qs, key=lambda v: -1 if v is None else v):
            rows = q(ENV, C.tag_sql(g["item"], g["uom"], qty, tag_id, g["party"], who))
            cl = [(str(x["id"]),) + tuple(None if x[c] is None else str(x[c]) for c in TAG_COLS) for x in rows]
            bl = [(x["rid"],) + tuple(None if x[c] is None else str(x[c]) for c in TAG_COLS) for x in mine_all if in_range(x, sql_qty(qty))]
            tot[who + " quantity checks"] += 1
            tot[who + " checks with 2+ rows"] += len(cl) > 1
            if cl != bl:
                bad.append((who, g["item"], g["uom"], g["party"], qty, [c[0] for c in cl], [b[0] for b in bl]))
for k in sorted(tot):
    print("%-36s %d" % (k, tot[k]))
print("differences:", len(bad))
for b in bad[:20]:
    print(b)
