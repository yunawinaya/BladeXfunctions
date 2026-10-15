"""(b) for the items read (READ-ONLY): per line of the sampled requests, the UOM row the classic's Map nodes find in its Get Item List
(first row with the line's alt_uom_id) vs the one the resolver finds in sql_node_UPitems, on every field the resolver reads.
usage: python3 items_b.py --dev|--prod [sample size]"""
import collections, concurrent.futures as cf, json, re, sys
sys.path.insert(0, "../../grv2")
from dbq import q
from js import run
from runs import load
from bulk_sql import render, coerce
import classic_sql as C
from parity_b import pick

ENV = "--prod" if "--prod" in sys.argv else "--dev"
SIZE = int(([a for a in sys.argv[1:] if a.isdigit()] or ["300"])[0])
FIELDS = ("%s_unit_price", "%s_min_price", "%s_max_price", "min_%s_qty", "max_%s_qty", "mat_%s_tax_id", "%s_tax_percent")


def first(rows, item, uom):
    for r in rows:
        if str(r["id"]) == str(item):
            for c in json.loads(r["uom_conversion_json"] or "[]"):
                if str(c.get("alt_uom_id")) == str(uom):
                    return c
            return "no-uom"
    return "no-item"


def one(r, keys):
    p = r["params"]
    csv = ",".join(dict.fromkeys(str(i.get("item_id") if i.get("item_id") is not None else "").strip() for i in p["item_data"]
                                 if re.fullmatch(r"[0-9]+", str(i.get("item_id") if i.get("item_id") is not None else "").strip())))
    classic = q(ENV, C.items_sql(csv)) if csv else []
    bulk = coerce("sql_node_UPitems", q(ENV, render("sql_node_UPitems", keys)))
    side = keys["side"]
    ck, diffs = collections.Counter(), []
    for li, line in enumerate(p["item_data"]):
        a, b = first(classic, line.get("item_id"), line.get("uom_id")), first(bulk, line.get("item_id"), line.get("uom_id"))
        ck["lines"] += 1
        if isinstance(a, str) or isinstance(b, str):
            ck["no UOM row: classic %s, bulk %s" % (a if isinstance(a, str) else "found", b if isinstance(b, str) else "found")] += 1
            if isinstance(a, str) != isinstance(b, str):
                diffs.append("line %d: classic %s bulk %s" % (li, a if isinstance(a, str) else "row", b if isinstance(b, str) else "row"))
            continue
        ck["UOM row found"] += 1
        for f in FIELDS:
            if a.get(f % side) != b.get(f % side):
                diffs.append("line %d %s: classic %r bulk %r" % (li, f % side, a.get(f % side), b.get(f % side)))
    return ck, diffs, len(json.dumps(classic)), len(json.dumps(bulk))


def main():
    sample = pick(load(ENV.strip("-")), SIZE)
    a = lambda r: [r["params"].get("document_type"), r["params"].get("supp_cust_id"), r["params"].get("plant_id"), r["params"].get("item_data")]
    keys = run([(r["id"], "priceKeys", a(r) + [r["tenant_id"], r["org"]]) for r in sample])
    tot, bad, size_c, size_b = collections.Counter(), [], 0, 0
    with cf.ThreadPoolExecutor(6) as ex:
        for r, (ck, diffs, sc, sb) in zip(sample, ex.map(lambda r: one(r, keys[r["id"]][0]), sample)):
            tot.update(ck)
            size_c += sc
            size_b += sb
            if diffs:
                bad.append((r["id"], diffs))
    print("requests %d" % len(sample))
    for k in sorted(tot):
        print("%-48s %d" % (k, tot[k]))
    print("item read size: classic %d KB, bulk %d KB" % (size_c / 1024, size_b / 1024))
    print("requests with a difference:", len(bad))
    for rid, d in bad[:20]:
        print(rid, " | ".join(d)[:500])


if __name__ == "__main__":
    main()
