"""Recorded STOCK_COUNT runs whose Review branch built a Stock Adjustment (nodes_data holds code_review_build_sa), read-only,
as fixtures for the golden tests of the shared review chain (test_review_golden.js) and its SQL adapter (test_review_shape.py).

Per run the RAW trace texts are kept (a code node's request_json_data = { code, variableMap, responseConfig }; a fetch node's
response_json_data = its output): the trace prints Java Longs as bare numbers, which the tests read as the digit strings a
code node received (test/prepare/load.js J). Kept nodes: the lifted bodies, the review fetches, the SA insert.

usage: python3 fetch_sc_runs.py <--prod|--dev> <out.json> [--ids id,id]
Fixtures hold tenant data: fixtures/.gitignore keeps them out of the repo.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "lib"))
from dbq import q  # noqa: E402

SC_WF = "2066808904123076610"
KEEP = ("code_review_prep", "code_review_required", "code_review_build_sa", "code_review_mark", "code_fillback", "search_item", "search_item_balance",
        "search_item_batch_balance", "search_bin_location", "search_uom", "search_batch", "get_sa_prefix", "sql_review_costs", "add_node_sa",
        "code_capture_sa")


def main():
    env, out = sys.argv[1], sys.argv[2]
    assert env in ("--prod", "--dev")
    ids = sys.argv[sys.argv.index("--ids") + 1].split(",") if "--ids" in sys.argv else None
    assert all(i.isdigit() for i in ids or [])
    where = f"id IN ({','.join(ids)})" if ids else "nodes_data LIKE '%code_review_build_sa%'"
    heads = q(env, f"SELECT CAST(id AS CHAR) id FROM su_code_workflow_inst WHERE workflow_id = {SC_WF} AND {where} ORDER BY id")
    runs = []
    for h in heads:
        r = q(env, f"SELECT CAST(id AS CHAR) id, tenant_id, status, current_node_id, request_json_data, nodes_data FROM su_code_workflow_inst WHERE id = {h['id']}")[0]
        rec = {"id": r["id"], "env": env[2:], "tenant": r["tenant_id"], "status": r["status"], "exit": r["current_node_id"],
               "request": r["request_json_data"], "order": [], "nodes": {}}
        for n in json.loads(r["nodes_data"] or "[]"):
            nid = n.get("node_id")
            if not nid:
                continue
            rec["order"].append(nid)
            if nid in KEEP:
                rec["nodes"][nid] = {"type": n.get("node_type"), "status": n.get("status"), "request": n.get("request_json_data"),
                                     "response": n.get("response_json_data"), "cut": bool(n.get("response_is_writer_file") or n.get("request_is_writer_file"))}
        runs.append(rec)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(runs, fh, ensure_ascii=False)
    print(f"{env}: {len(runs)} STOCK_COUNT review-build runs -> {out}")


if __name__ == "__main__":
    main()
