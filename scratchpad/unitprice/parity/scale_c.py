"""(c) Scale: the synthetic 2,000-line request (c_request_2000.json, dev tenant 711077) through every node of the bulk workflow
on dev (READ-ONLY): SQL server time (EXPLAIN ANALYZE) and wall time, resolver time, and the node data the platform would record
(each node's request incl. substituted values + its response, as the classic's recorded runs store them).
usage: python3 scale_c.py [--dev|--prod] [request.json]"""
import json, os, re, sys, time
sys.path.insert(0, "../../grv2")
from dbq import q
from js import run, FX
from bulk_sql import render, coerce, SQL

ENV = "--prod" if "--prod" in sys.argv else "--dev"
REQ = ([a for a in sys.argv[1:] if a.endswith(".json")] or [FX + "/c_request_2000.json"])[0]
CODE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "code")


def analyze(sql):
    rows = q(ENV, "EXPLAIN ANALYZE " + sql)
    text = list(rows[0].values())[0]
    m = re.search(r"actual time=[\d.]+\.\.([\d.]+)", text)
    return float(m.group(1)) if m else None, text


def wall(sql, n=3):
    """median wall time of n runs minus the helper's own cost (median of SELECT 1): query + transfer"""
    ts = []
    for _ in range(n):
        t0 = time.time()
        rows = q(ENV, sql)
        ts.append(time.time() - t0)
    return rows, max(sorted(ts)[n // 2] - OVERHEAD, 0)


def _overhead(n=5):
    ts = []
    for _ in range(n):
        t0 = time.time()
        q(ENV, "SELECT 1 AS one")
        ts.append(time.time() - t0)
    return sorted(ts)[n // 2]


OVERHEAD = _overhead()


def size(o):
    return len(json.dumps(o, ensure_ascii=False, separators=(",", ":")))


def code_entry(name, varmap, resp):
    req = {"code": open(os.path.join(CODE, name)).read(), "variableMap": varmap, "responseConfig": [], "scriptType": "js"}
    return size(json.dumps(req, ensure_ascii=False)) + size({"code": 200, "data": resp, "msg": "ok", "success": True})


def main():
    c = json.load(open(REQ))
    p, tenant, org = c["params"], c["tenant"], c["org"]
    a = [p["document_type"], p["supp_cust_id"], p["plant_id"], p["item_data"]]
    out = run([("c", "check", a), ("k", "priceKeys", a + [tenant, org])])
    chk, keys = out["c"][0], out["k"][0]
    t_js = out["c"][2] + out["k"][2]
    cfg_sql = render("sql_node_UPcfg", keys)
    cfg_ms, _ = analyze(cfg_sql)
    cfg_rows, cfg_wall = wall(cfg_sql)
    cfg = coerce("sql_node_UPcfg", cfg_rows)
    pl = run([("p", "pricePlan", [p["document_type"], keys, cfg])])["p"]
    plan = pl[0]
    t_js += pl[2]
    reads, timing, sqltext = {}, {"sql_node_UPcfg": (cfg_ms, cfg_wall)}, {"sql_node_UPcfg": cfg_sql}
    for nid in ("sql_node_UPitems", "sql_node_UPhist", "sql_node_UPtag"):
        s = render(nid, keys, plan)
        sqltext[nid] = s
        ms, plan_text = analyze(s)
        rows, w = wall(s)
        reads[nid] = coerce(nid, rows)
        timing[nid] = (ms, w)
        if nid == "sql_node_UPhist":
            hist_plan = plan_text
    r = run([("r", "resolvePrices", [p["item_data"], keys, plan, reads["sql_node_UPitems"], reads["sql_node_UPhist"], reads["sql_node_UPtag"]])])["r"]
    res, err, res_ms = r
    if err:
        raise SystemExit(err)
    print("lines %d, pairs %d, sequence %s" % (len(p["item_data"]), keys["pairCount"], [s.get("rules") for s in plan["sequence"]]))
    print("rows: items %d, history %d, price tag %d -> priced %d, needOverwrite %s" % (len(reads["sql_node_UPitems"]), len(reads["sql_node_UPhist"]),
          len(reads["sql_node_UPtag"]), len(res["data"]), res["needOverwrite"]))
    print("from:", json.dumps(dict(__import__("collections").Counter(o.get("from") for o in res["data"]))))
    for nid, (ms, w) in timing.items():
        print("  %-18s EXPLAIN ANALYZE top %8.1f ms   wall - helper cost (median of 3) %6.0f ms" % (nid, ms or -1, w * 1000))
    print("  code nodes (check + keys + plan) %.1f ms, resolver %.1f ms" % (t_js, res_ms))
    para = max(timing[n][1] for n in ("sql_node_UPitems", "sql_node_UPhist", "sql_node_UPtag")) * 1000
    print("  helper cost subtracted: %.0f ms" % (OVERHEAD * 1000))
    print("  critical path: config %.0f + max(items, history, tag) %.0f + code nodes %.0f + resolver %.0f = %.0f ms (+ platform per-node overhead)" % (
          timing["sql_node_UPcfg"][1] * 1000, para, t_js, res_ms, timing["sql_node_UPcfg"][1] * 1000 + para + res_ms + t_js))
    # node data: what each node would record
    vm = lambda **kw: {k.replace("__", ":"): v for k, v in kw.items()}
    nd = {
        "workflow request (request_json + workflowparams)": 2 * size(p),
        "code_node_UPcheck": code_entry("check.js", vm(workflowparams__document_type=p["document_type"], workflowparams__supp_cust_id=p["supp_cust_id"],
                                                       workflowparams__plant_id=p["plant_id"], workflowparams__item_data=p["item_data"]), chk),
        "code_node_UPkeys": code_entry("keys.js", vm(workflowparams__document_type=p["document_type"], workflowparams__supp_cust_id=p["supp_cust_id"],
                                                     workflowparams__plant_id=p["plant_id"], workflowparams__item_data=p["item_data"]), keys),
        "sql_node_UPcfg": len(sqltext["sql_node_UPcfg"]) + size(cfg),
        "code_node_UPplan": code_entry("plan.js", {"keys": keys, "cfg": cfg}, plan),
        "sql_node_UPitems": len(sqltext["sql_node_UPitems"]) + size(reads["sql_node_UPitems"]),
        "sql_node_UPhist": len(sqltext["sql_node_UPhist"]) + size(reads["sql_node_UPhist"]),
        "sql_node_UPtag": len(sqltext["sql_node_UPtag"]) + size(reads["sql_node_UPtag"]),
        "code_node_UPresolve": code_entry("resolve.js", {"item_data": p["item_data"], "keys": keys, "plan": plan, "items": reads["sql_node_UPitems"],
                                                          "hist": reads["sql_node_UPhist"], "tag": reads["sql_node_UPtag"]}, res),
        "end (response)": size(res),
        "context (workflowparams + request_json)": 2 * size(p),
    }
    tot = sum(nd.values())
    for k, v in nd.items():
        print("  %-48s %8.0f KB" % (k, v / 1024))
    print("  %-48s %8.2f MB" % ("TOTAL recorded per run (nodes_data + request + context)", tot / 1048576))
    print("\nhistory plan (EXPLAIN ANALYZE, top):\n" + "\n".join(hist_plan.split("\n")[:40]))
    json.dump({"res": res, "keys": keys, "plan": plan}, open(FX + "/c_result.json", "w"))


if __name__ == "__main__":
    main()
