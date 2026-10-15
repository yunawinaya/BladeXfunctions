"""(a) Logic parity on recorded GET_ITEM_UNIT_PRICE runs. Per Complete run: keys + plan from the shipped JS; the config and
the item list from the run's own recorded node outputs; history + price tag rows rebuilt from the run's node trace (which rule
hit / missed for each line) and the values its recorded answer carries; then the shipped resolver vs the recorded response,
field by field. usage: python3 parity_a.py [dev|prod ...]"""
import collections, json, sys
from runs import load, segment
from js import run

SOURCE = {"Last Quotation Price": "SQT", "Last Sales Order Price": "SO", "Last Sales Invoice Price": "SI",
          "Last Purchase Requisition Price": "PREQ", "Last Purchase Order Price": "PO", "Last Purchase Invoice Price": "PI"}
TAG_RULES = ("Customer Price Tag", "Supplier Price Tag")
DEF_RULES = ("Default Sales Unit Price", "Default Purchase Unit Price")
TAG_FIELDS = (("unit_price", "unit_price"), ("max_price", "max_price"), ("min_price", "min_price"), ("discount", "discount"),
              ("discount_type", "discount_uom"), ("tax", "tax_rate"), ("tax_percent", "tax_percent"))


def cat_of(rules):
    if rules in SOURCE:
        return "HIST"
    if rules in TAG_RULES:
        return "TAG"
    if rules == "Multi Pricing":
        return "MULTI"
    if rules in DEF_RULES:
        return "DEFAULT"
    return "OTHER"


def trace_cat(ev):
    c = ev["cat"]
    if c == "DEFAULT" and "default_code" not in ev["ran"]:
        return "OTHER"
    return c


def sql_qty(v):
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v.strip()) if v.strip() else None
        except ValueError:
            return None
    return None


def in_range(row, q):
    lo, hi = row["min_order_qty"], row["max_order_qty"]
    if lo is None or hi is None:
        return False
    lo, hi = float(lo), float(hi)
    return (lo == 0 or (q is not None and lo <= q)) and (hi == 0 or (q is not None and hi >= q))


def rebuild(r, plan):
    """-> (hist_rows, tag_rows, problems) from the trace + the recorded answer"""
    p = r["params"]
    lines = p["item_data"]
    out = r["response"]["data"]["data"]
    seq = plan["sequence"]
    segs = segment(r["trace_ids"])
    problems = []
    if len(segs) != len(lines):
        return None, None, ["trace has %d item iterations for %d lines" % (len(segs), len(lines))]
    # the recorded answer per line: the classic appends one object per resolved line, in line order
    resolved = []
    oi = 0
    hist_ev, tag_ev = collections.defaultdict(list), collections.defaultdict(list)
    for i, (line, evs) in enumerate(zip(lines, segs)):
        if len(evs) > len(seq):
            problems.append("line %d: %d rule evaluations for a sequence of %d" % (i, len(evs), len(seq)))
            continue
        for k, ev in enumerate(evs):
            want = cat_of(seq[k].get("rules") if isinstance(seq[k], dict) else None)
            if trace_cat(ev) != want:
                problems.append("line %d rule %d: trace %s, plan %s" % (i, k, trace_cat(ev), want))
        hit = evs[-1]["hit"] if evs else False
        o = None
        if hit:
            if oi >= len(out):
                problems.append("line %d hit but the answer has no object left" % i)
                break
            o = out[oi]
            oi += 1
        pair = (str(line.get("item_id")), str(line.get("uom_id")))
        for k, ev in enumerate(evs):
            c = trace_cat(ev)
            rules = seq[k].get("rules")
            if c == "HIST":
                hist_ev[(SOURCE[rules], pair)].append((i, ev["hit"], o if ev["hit"] else None, line))
            elif c == "TAG" and "tag_sql" in ev["ran"]:
                tag_ev[pair].append((i, ev["hit"], o if ev["hit"] else None, line))
        resolved.append(o)
    if oi != len(out):
        problems.append("answer has %d objects, trace resolved %d" % (len(out), oi))
    hist_rows = []
    for (src, pair), evs in hist_ev.items():
        hits = [e for e in evs if e[1]]
        if hits and len(hits) != len(evs):
            problems.append("history %s %s: hit on some lines, miss on others" % (src, pair))
        if not hits:
            continue
        prices = set(json.dumps(e[2].get("unit_price")) for e in hits)
        price = hits[0][2].get("unit_price") if len(prices) == 1 else 0
        hist_rows.append({"src": src, "item_id": pair[0], "uom_id": pair[1], "unit_price": price})
    tag_rows = []
    for pair, evs in tag_ev.items():
        groups = collections.OrderedDict()
        for i, hit, o, line in evs:
            q = sql_qty(line.get("quantity"))
            if hit:
                groups.setdefault(q, []).append(o)
        for q, objs in groups.items():
            row = {"item_id": pair[0], "uom_id": pair[1]}
            if q is None:
                row["min_order_qty"], row["max_order_qty"] = "0.000", "0.000"
            elif q == 0:
                row["min_order_qty"], row["max_order_qty"] = "-1", "0.0005"
            else:
                row["min_order_qty"], row["max_order_qty"] = repr(q), repr(q)
            for col, f in TAG_FIELDS:
                vals = set(json.dumps(x.get(f)) for x in objs)
                row[col] = objs[0].get(f) if len(vals) == 1 else None
            tag_rows.append(row)
        bounded = [t for t in tag_rows if t["item_id"] == pair[0] and t["uom_id"] == pair[1]]
        bounded.sort(key=lambda t: t["min_order_qty"] == "0.000")
        for i, hit, o, line in evs:
            q = sql_qty(line.get("quantity"))
            matches = [t for t in bounded if in_range(t, q)]
            if not hit and matches:
                problems.append("price tag %s: line %d missed at quantity %r but another line hit" % (pair, i, line.get("quantity")))
    tag_rows.sort(key=lambda t: (t["item_id"], t["uom_id"], t["min_order_qty"] == "0.000"))
    return hist_rows, tag_rows, problems


PROJECTED = "--projected" in sys.argv
SIDE_KEYS = ("%s_unit_price", "%s_min_price", "%s_max_price", "min_%s_qty", "max_%s_qty", "mat_%s_tax_id", "%s_tax_percent")


def project(items, lines, side):
    """the recorded classic item list reshaped as sql_node_UPitems returns it: the requested item + UOM rows, the document's side only"""
    big = lambda v: isinstance(v, str) and v.isdigit() and len(v) <= 19
    want = {}
    for ln in lines:
        it, u = ln.get("item_id"), ln.get("uom_id")
        it, u = (None if it is None else str(it)), (None if u is None else str(u))
        if big(it) and big(u):
            want.setdefault(it, set()).add(u)
    out = []
    for row in items:
        if str(row["id"]) not in want:
            continue
        conv = json.loads(row["uom_conversion_json"]) if row.get("uom_conversion_json") else []
        keep = [dict([("alt_uom_id", c.get("alt_uom_id"))] + [(k % side, c.get(k % side)) for k in SIDE_KEYS]) for c in conv
                if str(c.get("alt_uom_id")) in want[str(row["id"])]]
        out.append({"id": row["id"], "uom_conversion_json": json.dumps(keep)})
    return out


def norm(v):
    return json.dumps(v, sort_keys=True)


def compare(mine, rec):
    diffs = []
    if mine["needOverwrite"] != rec["needOverwrite"]:
        diffs.append("needOverwrite %s vs %s" % (mine["needOverwrite"], rec["needOverwrite"]))
    a, b = mine["data"], rec["data"]
    if len(a) != len(b):
        diffs.append("lines priced %d vs %d" % (len(a), len(b)))
    for i, (x, y) in enumerate(zip(a, b)):
        for k in sorted(set(x) | set(y)):
            if k not in x or k not in y:
                diffs.append("line %d key %s only in %s" % (i, k, "bulk" if k in x else "classic"))
            elif x[k] != y[k] or type(x[k]) is str and type(y[k]) is not str or type(y[k]) is str and type(x[k]) is not str:
                diffs.append("line %d %s: bulk %r classic %r" % (i, k, x[k], y[k]))
    return diffs


def main(envs):
    stats = collections.Counter()
    mism = []
    for env in envs:
        runs = [r for r in load(env) if r["status"] == "Complete" and r["params"] and r["response"]]
        cases = []
        for r in runs:
            p = r["params"]
            cases.append((r["id"], "priceKeys", [p.get("document_type"), p.get("supp_cust_id"), p.get("plant_id"), p.get("item_data"), r["tenant_id"], r["org"]]))
        keys = run(cases)
        cases = []
        for r in runs:
            cfg = r["cfg"]["data"] if r["cfg"] else {"count": 0}
            rows = [{"kind": "cfg", "id": str(cfg["data"].get("id")), "val": json.dumps(cfg["data"].get("config_sequence"))}] if cfg.get("count") else []
            cases.append((r["id"], "pricePlan", [r["params"].get("document_type"), keys[r["id"]][0], rows]))
        plans = run(cases)
        cases, rebuilt = [], {}
        for r in runs:
            plan = plans[r["id"]][0]
            hist, tag, problems = rebuild(r, plan)
            rebuilt[r["id"]] = problems
            if hist is None:
                continue
            items = r["items_out"]["data"] if r["items_out"] else []
            if PROJECTED:
                items = project(items, r["params"]["item_data"], keys[r["id"]][0]["side"])
            cases.append((r["id"], "resolvePrices", [r["params"]["item_data"], keys[r["id"]][0], plan, items, hist, tag]))
        res = run(cases)
        for r in runs:
            stats[env + " runs"] += 1
            stats[env + " lines"] += len(r["params"]["item_data"])
            problems = rebuilt[r["id"]]
            if r["id"] not in res:
                stats[env + " NOT REBUILT"] += 1
                mism.append((env, r["id"], "not rebuilt", problems))
                continue
            out, err, ms = res[r["id"]]
            if err:
                stats[env + " RESOLVER ERROR"] += 1
                mism.append((env, r["id"], "resolver error", [err]))
                continue
            diffs = compare(out, r["response"]["data"])
            if diffs or problems:
                stats[env + " MISMATCH"] += 1
                mism.append((env, r["id"], "mismatch", problems + diffs))
            else:
                stats[env + " identical"] += 1
                stats[env + " identical lines"] += len(r["params"]["item_data"])
    for k in sorted(stats):
        print("%-28s %d" % (k, stats[k]))
    return stats, mism


if __name__ == "__main__":
    envs = [a for a in sys.argv[1:] if not a.startswith("--")] or ["dev"]
    stats, mism = main(envs)
    print("mismatches:", len(mism))
    for m in mism[:60]:
        print(m[0], m[1], m[2], "|", "; ".join(m[3])[:400])
