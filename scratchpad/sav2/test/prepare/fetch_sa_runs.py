"""Recorded classic STOCK_ADJUSTMENT runs (read-only) with the SUBTRACT_INVENTORY / ADD_INVENTORY runs each one made, as
slim fixtures for test_sa_golden.js (golden test 3: the lifted qrsgEz2F / GmKmvMGe -> the ENGINE movements).

Per run: request (pageStatus, saveAs, allData), the recorded top-level node outputs the loop bodies read
(code_node_O4tWJ5JH = the loop source and its stock_adjustment_status, get_node_Rs3nGg9f = the Edit read-back,
add_node_Yk7ukSPp = the Add insert), and the children in id order (= the classic loop order): { wf: ADD | SUBTRACT, params }.
Nodes inside a loop are not traced, so the children's own request params ARE the workflow_node_p9gVSMG0 / ABYSBRCw inputs.
A child belongs to the run when it starts inside [run id, run id + (run_time + 3 s)] (snowflake bound on the PK), same
tenant, transaction_type SA and trx_no = the run's number (other SAs of that tenant can run in the same window).

usage: python3 fetch_sa_runs.py <--prod|--dev> <out.json> [--ids id,id]
Fixtures hold tenant data: fixtures/.gitignore keeps them out of the repo.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "lib"))
from dbq import q  # noqa: E402

SA_WF = "2032025505853816833"
ADD, SUB = "2012005532688723970", "2012096660219564034"
KEEP = ("code_node_O4tWJ5JH", "get_node_Rs3nGg9f", "add_node_Yk7ukSPp", "code_node_WFXy3gHI")


def main():
    env, out = sys.argv[1], sys.argv[2]
    assert env in ("--prod", "--dev")
    ids = sys.argv[sys.argv.index("--ids") + 1].split(",") if "--ids" in sys.argv else None
    assert all(i.isdigit() for i in ids or [])
    where = f"id IN ({','.join(ids)})" if ids else "1 = 1"
    heads = q(env, f"SELECT CAST(id AS CHAR) id FROM su_code_workflow_inst WHERE workflow_id = {SA_WF} AND {where} ORDER BY id")
    runs = []
    for h in heads:
        r = q(env, "SELECT CAST(id AS CHAR) id, tenant_id, status, run_time, current_node_id, error_msg, request_json_data, nodes_data "
                   f"FROM su_code_workflow_inst WHERE id = {h['id']}")[0]
        try:
            wp = json.loads(r["request_json_data"]).get("workflowparams") or {}
            nodes = json.loads(r["nodes_data"] or "[]")
        except (ValueError, TypeError):
            continue
        rec = {"id": r["id"], "env": env[2:], "tenant": r["tenant_id"], "status": r["status"], "exit": r["current_node_id"],
               "error": (r.get("error_msg") or "")[:300], "pageStatus": wp.get("pageStatus"), "saveAs": wp.get("saveAs"),
               "allData": wp.get("allData"), "nodes": {}, "order": [], "children": []}
        for n in nodes:
            nid = n.get("node_id")
            if not nid:
                continue
            rec["order"].append(nid)
            if nid in KEEP:
                try:
                    rec["nodes"][nid] = json.loads(n.get("response_json_data") or "null")
                except ValueError:
                    rec["nodes"][nid] = None
        lo = int(r["id"])
        hi = lo + ((int(r["run_time"] or 0) + 3000) << 22)
        kids = q(env, "SELECT CAST(id AS CHAR) id, CAST(workflow_id AS CHAR) wf, status, request_json_data FROM su_code_workflow_inst "
                      f"WHERE workflow_id IN ({ADD}, {SUB}) AND id BETWEEN {lo} AND {hi} AND tenant_id = '{r['tenant_id']}' ORDER BY id")
        for k in kids:
            try:
                p = json.loads(k["request_json_data"]).get("workflowparams") or {}
            except (ValueError, TypeError):
                continue
            if p.get("transaction_type") != "SA":
                continue
            p.pop("itemData", None)
            rec["children"].append({"id": k["id"], "wf": "ADD" if k["wf"] == ADD else "SUBTRACT", "status": k["status"], "params": p})
        runs.append(rec)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(runs, fh, ensure_ascii=False)
    print(f"{env}: {len(runs)} STOCK_ADJUSTMENT runs, {sum(len(x['children']) for x in runs)} SA movements -> {out}")


if __name__ == "__main__":
    main()
