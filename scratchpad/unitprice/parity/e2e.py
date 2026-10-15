"""End to end on the live DB (read-only): the bulk workflow's nodes in order for one request -> its answer + timings."""
import json, sys, time
sys.path.insert(0, "../../grv2")
from dbq import q
from js import run
from bulk_sql import render, coerce


def bulk(env, params, tenant, org, timing=None):
    t = timing if timing is not None else {}
    a = [params.get("document_type"), params.get("supp_cust_id"), params.get("plant_id"), params.get("item_data")]
    chk = run([("c", "check", a)])["c"][0]
    if chk["status"] == "Failed":
        return {"error401": chk["message"]}
    keys = run([("k", "priceKeys", a + [tenant, org])])["k"][0]
    t0 = time.time(); cfg = coerce("sql_node_UPcfg", q(env, render("sql_node_UPcfg", keys))); t["cfg"] = time.time() - t0
    plan = run([("p", "pricePlan", [params.get("document_type"), keys, cfg])])["p"][0]
    out = {}
    for nid in ("sql_node_UPitems", "sql_node_UPhist", "sql_node_UPtag"):
        t0 = time.time(); out[nid] = coerce(nid, q(env, render(nid, keys, plan))); t[nid] = time.time() - t0
    res, err, ms = run([("r", "resolvePrices", [params.get("item_data"), keys, plan, out["sql_node_UPitems"], out["sql_node_UPhist"], out["sql_node_UPtag"]])])["r"]
    t["resolve_ms"] = ms
    if err:
        raise RuntimeError(err)
    return {"res": res, "keys": keys, "plan": plan, "cfg": cfg, "reads": out}


if __name__ == "__main__":
    from runs import load
    env = sys.argv[1]
    rid = sys.argv[2]
    r = [x for x in load(env.strip("-")) if x["id"] == rid][0]
    tm = {}
    b = bulk(env, r["params"], r["tenant_id"], r["org"], tm)
    print("timing", tm)
    print("plan", json.dumps(b["plan"])[:400])
    print("hist", b["reads"]["sql_node_UPhist"]); print("tag", b["reads"]["sql_node_UPtag"])
    print("BULK   ", json.dumps(b["res"], sort_keys=True)[:1500])
    print("CLASSIC", json.dumps(r["response"]["data"], sort_keys=True)[:1500])
