#!/usr/bin/env python3
"""Regression for the GD_UNUSED_FN_NEW detectBinHuMigrations change (BUG-014).

Replays code_node_b71wypDJ (BASE vs PROD) on every recorded prod run where the detector is
live (saveAs Created and isPacking=1 or isLoadingBay=1) in a date window, checks the BASE replay
reproduces what prod recorded, and reports every run whose PROD output differs.

usage: python3 regress_detector.py <from YYYY-MM-DD> <to YYYY-MM-DD> > report.txt"""
import concurrent.futures, datetime, json, os, sys
import replay_tests as rt

E = 1288834974657


def sid(dt):
    dt = (dt - datetime.timedelta(hours=8)).replace(tzinfo=datetime.timezone.utc)
    return (int(dt.timestamp() * 1000) - E) << 22


def run_ids(start, end):
    ids, cur = [], start
    while cur < end:
        nxt = min(cur + datetime.timedelta(hours=12), end)
        ids += [r["id"] for r in rt.db(
            f"SELECT id FROM su_code_workflow_inst WHERE workflow_id=2032273338771128322 "
            f"AND id BETWEEN {sid(cur)} AND {sid(nxt)} AND status='Complete' "
            f"AND (JSON_EXTRACT(request_json_data,'$.request_json.isPacking')=1 "
            f"OR JSON_EXTRACT(request_json_data,'$.request_json.isLoadingBay')=1) "
            f"AND JSON_UNQUOTE(JSON_EXTRACT(request_json_data,'$.request_json.saveAs'))='Created'")]
        cur = nxt
    return ids


def kinds(o):
    return sorted((m["movement_type"], round(float(m["quantity"]), 8)) for m in o.get("inventoryMovements") or [])


def one(run_id):
    params, nodes = rt.trace(run_id)
    rt._cache.pop(run_id, None)  # 700 full GD payloads would not fit in memory
    if not (nodes.get("code_node_b71wypDJ") or {}).get("data"):
        return run_id, "no-node", None
    old, new = rt.both("GD_UNUSED_FN_NEW", "code_node_b71wypDJ", params, nodes, rt.run_time_ms(run_id))
    if not rt.same_as_recorded(old, nodes["code_node_b71wypDJ"]["data"]):
        return run_id, "BASE!=recorded", None
    if rt.same(old, new):
        return run_id, "same", None
    return run_id, "DIFF", {"tenant": params.get("organization_id"), "doc": params.get("doc_no"),
                            "base": kinds(old), "prod": kinds(new)}


if __name__ == "__main__":
    start = datetime.datetime.strptime(sys.argv[1], "%Y-%m-%d")
    end = datetime.datetime.strptime(sys.argv[2], "%Y-%m-%d")
    ids = run_ids(start, end)
    print(f"{len(ids)} detector runs between {sys.argv[1]} and {sys.argv[2]}", flush=True)
    tally = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for run_id, verdict, detail in pool.map(one, ids):
            tally[verdict] = tally.get(verdict, 0) + 1
            if verdict != "same":
                print(f"{verdict} {run_id} {json.dumps(detail, ensure_ascii=False) if detail else ''}", flush=True)
    print("TALLY", json.dumps(tally), flush=True)
