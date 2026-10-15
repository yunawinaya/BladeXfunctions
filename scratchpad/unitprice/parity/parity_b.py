"""(b) Read parity on current data (READ-ONLY): for a sample of recent recorded requests, the bulk workflow's SQL vs the classic's
per-line SQL (exact text, placeholders rendered as the platform renders them), run back to back on the same database.
Compared per request: config, party price tag, item rows; per line + source: the history row (id, price); per line: the price
tag rows after the quantity filter, in order (ids + every column the answer uses).
usage: python3 parity_b.py --dev|--prod [sample size]"""
import collections, concurrent.futures as cf, json, re, sys
sys.path.insert(0, "../../grv2")
from dbq import q
from js import run
from runs import load
from bulk_sql import render, coerce
import classic_sql as C

ENV = "--prod" if "--prod" in sys.argv else "--dev"
SIZE = int(([a for a in sys.argv[1:] if a.isdigit()] or ["200"])[0])
TAG_COLS = ["unit_price", "min_price", "max_price", "discount", "discount_type", "tax", "tax_percent"]


def guard(v):
    raw = ("" if v is None else str(v)).strip()
    return "" if raw == "" else raw if re.fullmatch(r"[0-9]+", raw) else "0"


def sql_qty(v):
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str) and re.fullmatch(r"\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*", v):
        return float(v)
    return None


def in_range(t, qv):
    lo, hi = t["min_order_qty"], t["max_order_qty"]
    if lo is None or hi is None:
        return False
    lo, hi = float(lo), float(hi)
    return (lo == 0 or (qv is not None and lo <= qv)) and (hi == 0 or (qv is not None and hi >= qv))


def diag_hist(sql):
    a = "SELECT r.src, r.item_id, r.uom_id, r.unit_price\n"
    b = "ROW_NUMBER() OVER"
    assert a in sql and b in sql
    return sql.replace(a, "SELECT r.src, r.item_id, r.uom_id, r.unit_price, CAST(r.id AS CHAR) AS rid\n").replace("h.unit_price,\n", "h.unit_price, h.id,\n", 1)


def diag_tag(sql):
    a = "       t.max_price\n"
    assert a in sql
    return sql.replace(a, "       t.max_price, CAST(t.rid AS CHAR) AS rid\n")


SIDE_FIELDS = ("%s_unit_price", "%s_min_price", "%s_max_price", "min_%s_qty", "max_%s_qty", "mat_%s_tax_id", "%s_tax_percent")


def first_uom(rows, line):
    for r in rows:
        if str(r["id"]) == str(line.get("item_id")):
            for c in json.loads(r["uom_conversion_json"] or "[]"):
                if str(c.get("alt_uom_id")) == str(line.get("uom_id")):
                    return c
            return "no-uom"
    return "no-item"


def batch(stmts, n=20):
    """[(key, sql)] -> {key: rows | "ERROR"}: the exact statements, n per call as derived tables"""
    out = {}
    for i in range(0, len(stmts), n):
        chunk = stmts[i:i + n]
        try:
            rows = q(ENV, " UNION ALL ".join("SELECT '%s' AS k__, t.* FROM (%s) t" % (k, sq) for k, sq in chunk))
        except RuntimeError:
            rows = []
            for k, sq in chunk:
                try:
                    rows += [dict(r, k__=k) for r in q(ENV, sq)]
                except RuntimeError:
                    out[k] = "ERROR"
        for r in rows:
            out.setdefault(r.pop("k__"), []).append(r)
    return out


def pick(runs, size):
    """the latest distinct requests, spread over tenant x document type, multi-line runs first"""
    seen, by = set(), collections.defaultdict(list)
    for r in reversed(runs):
        p = r["params"]
        if not p or r["status"] != "Complete":
            continue
        k = json.dumps([r["tenant_id"], p.get("document_type"), p.get("supp_cust_id"), p.get("plant_id"),
                        [(i.get("item_id"), i.get("uom_id"), i.get("quantity")) for i in p.get("item_data") or []]])
        if k in seen:
            continue
        seen.add(k)
        by[(r["tenant_id"], p.get("document_type"))].append(r)
    for v in by.values():
        v.sort(key=lambda r: -len(r["params"]["item_data"]))
    out = []
    while len(out) < size and any(by.values()):
        for k in list(by):
            if by[k]:
                out.append(by[k].pop(0))
    return out[:size]


def one(r, keys, plan):
    p = r["params"]
    res = {"id": r["id"], "checks": collections.Counter(), "diffs": []}
    ck = res["checks"]

    def diff(kind, msg):
        res["diffs"].append(kind + ": " + msg)
        ck[kind + " DIFF"] += 1

    # bulk reads (exact node SQL) + the diagnostic copies with ids
    cfg = coerce("sql_node_UPcfg", q(ENV, render("sql_node_UPcfg", keys)))
    items = coerce("sql_node_UPitems", q(ENV, render("sql_node_UPitems", keys, plan)))
    hist = coerce("sql_node_UPhist", q(ENV, render("sql_node_UPhist", keys, plan)))
    hist_d = q(ENV, diag_hist(render("sql_node_UPhist", keys, plan)))
    tag = coerce("sql_node_UPtag", q(ENV, render("sql_node_UPtag", keys, plan)))
    tag_d = q(ENV, diag_tag(render("sql_node_UPtag", keys, plan)))
    if json.dumps(coerce("sql_node_UPhist", [{k: v for k, v in x.items() if k != "rid"} for x in hist_d])) != json.dumps(hist):
        diff("diag", "the diagnostic history copy returned other rows")
    if json.dumps(coerce("sql_node_UPtag", [{k: v for k, v in x.items() if k != "rid"} for x in tag_d])) != json.dumps(tag):
        diff("diag", "the diagnostic price tag copy returned other rows")
    # classic: config get-node, party get-node, Get Item List
    doc = keys["document_type"]
    org = keys["organizationId"]
    ccfg = q(ENV, "SELECT CAST(id AS CHAR) AS id, CAST(config_sequence AS CHAR) AS val FROM price_history_config WHERE organization_id = '%s' "
                  "AND document_type = '%s' AND is_deleted = 0 ORDER BY id" % (org, doc))
    mine_cfg = [x for x in cfg if x["kind"] == "cfg"]
    ck["config"] += 1
    if [(x["id"], json.loads(x["val"]) if x["val"] else None) for x in ccfg] != [(x["id"], json.loads(x["val"]) if x["val"] else None) for x in mine_cfg]:
        diff("config", "classic %s bulk %s" % (ccfg, mine_cfg))
    rec_cfg = r["cfg"]["data"] if r["cfg"] else None
    if rec_cfg is not None and (rec_cfg["count"] != len(mine_cfg) or (rec_cfg["count"] and rec_cfg["data"].get("config_sequence") != json.loads(mine_cfg[0]["val"]))):
        ck["config changed since the run"] += 1
    supp = p.get("supp_cust_id")
    tag_id = None
    if supp and supp != "":
        table = "customer" if doc == "sd" else "supplier_head"
        crow = q(ENV, "SELECT price_tag_id FROM %s WHERE id = '%s' AND is_deleted = 0" % (table, str(supp).replace("'", "")))
        tag_id = crow[0]["price_tag_id"] if crow else None
        mine_tag = [x["val"] for x in cfg if x["kind"] == "tag"]
        ck["party tag"] += 1
        if (mine_tag[0] if mine_tag else None) != tag_id:
            diff("party tag", "classic %r bulk %r" % (tag_id, mine_tag))
    csv = ",".join(dict.fromkeys(str(i.get("item_id") if i.get("item_id") is not None else "").strip() for i in p["item_data"]
                                 if re.fullmatch(r"[0-9]+", str(i.get("item_id") if i.get("item_id") is not None else "").strip())))
    citems = coerce("sql_node_UPitems", q(ENV, C.items_sql(csv)))
    ck["items"] += 1
    # per line: the UOM row each side's .find returns, on the fields the resolver reads (the bulk read is projected)
    for li, line in enumerate(p["item_data"]):
        ca, ba = first_uom(citems, line), first_uom(items, line)
        if isinstance(ca, str) or isinstance(ba, str):
            if isinstance(ca, str) != isinstance(ba, str):
                diff("items", "line %d: classic %s bulk %s" % (li, ca if isinstance(ca, str) else "row", ba if isinstance(ba, str) else "row"))
            continue
        side = keys["side"]
        if any(ca.get(f % side) != ba.get(f % side) for f in SIDE_FIELDS):
            diff("items", "line %d: classic %s bulk %s" % (li, ca, ba))
    # classic per line: Fetch latest record per source of the sequence, Fetch price tag at the line's quantity (exact statements,
    # 20 per call as derived tables; a price tag statement with more than one row is re-run alone for its own row order)
    srcs = list(dict.fromkeys(C.SOURCE[s["rules"]] for s in plan["sequence"] if isinstance(s, dict) and s.get("rules") in C.SOURCE))
    hmap = {(x["src"], x["item_id"], x["uom_id"]): x for x in hist_d}
    tmap = collections.defaultdict(list)
    for x in tag_d:
        tmap[(x["item_id"], x["uom_id"])].append(x)
    plant_s, party_s = guard(p.get("plant_id")), guard(supp)
    fetch_from = "Customer" if doc == "sd" else "Supplier"
    tag_rule = any(isinstance(s, dict) and s.get("rules") in ("Customer Price Tag", "Supplier Price Tag") for s in plan["sequence"])
    hstmts, tstmts = [], []
    for li, line in enumerate(p["item_data"]):
        item, uom = line.get("item_id"), line.get("uom_id")
        for src in srcs:
            hstmts.append(("h%d_%s" % (li, src), C.hist_sql(src, item, uom, plant_s, party_s)))
        if tag_rule and supp and supp != "":
            qty = line.get("quantity", None)
            if qty == "" or uom == "":
                ck["price tag: classic SQL fails (blank quantity / UOM)"] += 1
                continue
            tstmts.append(("t%d" % li, C.tag_sql(item, uom, qty, tag_id, party_s, fetch_from)))
    hres, tres = batch(hstmts), batch(tstmts)
    for k, rows in list(tres.items()):
        if rows != "ERROR" and len(rows) > 1:
            tres[k] = q(ENV, dict(tstmts)[k])
            ck["price tag lines with >1 row (order checked alone)"] += 1
    for li, line in enumerate(p["item_data"]):
        item, uom = line.get("item_id"), line.get("uom_id")
        for src in srcs:
            crow = hres.get("h%d_%s" % (li, src), [])
            mine = hmap.get((src, str(item), str(uom)))
            ck["history line x source"] += 1
            if crow == "ERROR":
                ck["history: classic SQL fails"] += 1
            elif bool(crow) != bool(mine):
                diff("history", "line %d %s: classic %s bulk %s" % (li, src, [(x["id"], x["unit_price"]) for x in crow], mine and (mine["rid"], mine["unit_price"])))
            elif crow:
                ck["history rows found"] += 1
                if str(crow[0]["id"]) != mine["rid"] or float(crow[0]["unit_price"]) != float(mine["unit_price"]):
                    diff("history", "line %d %s: classic (%s, %s) bulk (%s, %s)" % (li, src, crow[0]["id"], crow[0]["unit_price"], mine["rid"], mine["unit_price"]))
        k = "t%d" % li
        if k not in dict(tstmts):
            continue
        crow = tres.get(k, [])
        if crow == "ERROR":
            ck["price tag: classic SQL fails"] += 1
            continue
        mine = [x for x in tmap.get((str(item), str(uom)), []) if in_range(x, sql_qty(line.get("quantity")))]
        ck["price tag line"] += 1
        cl = [(str(x["id"]),) + tuple(None if x[c] is None else str(x[c]) for c in TAG_COLS) for x in crow]
        bl = [(x["rid"],) + tuple(None if x[c] is None else str(x[c]) for c in TAG_COLS) for x in mine]
        if cl != bl:
            diff("price tag", "line %d q=%r: classic %s bulk %s" % (li, line.get("quantity"), cl[:3], bl[:3]))
        elif cl:
            ck["price tag rows found"] += 1
    res["bulk"] = {"keys": keys, "plan": plan, "items": items, "hist": hist, "tag": tag}
    return res


def main():
    runs = load(ENV.strip("-"))
    sample = pick(runs, SIZE)
    print("sample", len(sample), "requests,", sum(len(r["params"]["item_data"]) for r in sample), "lines,",
          len(set(r["tenant_id"] for r in sample)), "tenants", collections.Counter(r["params"]["document_type"] for r in sample))
    a = lambda r: [r["params"].get("document_type"), r["params"].get("supp_cust_id"), r["params"].get("plant_id"), r["params"].get("item_data")]
    keys = run([(r["id"], "priceKeys", a(r) + [r["tenant_id"], r["org"]]) for r in sample])
    # the plan needs the config read: the bulk config SQL first, then the shipped plan JS
    cfgs = {}
    with cf.ThreadPoolExecutor(6) as ex:
        for r, rows in zip(sample, ex.map(lambda r: coerce("sql_node_UPcfg", q(ENV, render("sql_node_UPcfg", keys[r["id"]][0]))), sample)):
            cfgs[r["id"]] = rows
    plans = run([(r["id"], "pricePlan", [r["params"].get("document_type"), keys[r["id"]][0], cfgs[r["id"]]]) for r in sample])
    total, diffs = collections.Counter(), []
    results = {}
    with cf.ThreadPoolExecutor(6) as ex:
        futs = {ex.submit(one, r, keys[r["id"]][0], plans[r["id"]][0]): r for r in sample}
        for f in cf.as_completed(futs):
            r = futs[f]
            try:
                res = f.result()
            except Exception as e:
                total["ERROR"] += 1
                diffs.append((r["id"], ["error " + str(e)[:300]]))
                continue
            total.update(res["checks"])
            results[r["id"]] = res
            if len(results) % 25 == 0:
                print("  ..", len(results), "requests done", flush=True)
            if res["diffs"]:
                diffs.append((r["id"], res["diffs"]))
    for k in sorted(total):
        print("%-52s %d" % (k, total[k]))
    print("requests with a difference:", len(diffs))
    for rid, d in diffs[:40]:
        print(rid, " | ".join(d)[:600])
    json.dump({rid: res["bulk"] for rid, res in results.items()}, open("%s/b_reads_%s.json" % (C.FX, ENV.strip("-")), "w"))


if __name__ == "__main__":
    main()
