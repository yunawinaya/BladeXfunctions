"""Recorded dev GD_REVERT_COMPLETED runs, each with the GD_PROCESS_REVERT run it made, one fixture JSON per run. Fixtures hold
tenant data: they go to the session scratchpad, never the repo.

usage: python3 fetch_fixtures.py <out_dir> [--ids id,id] [--env --dev|--prod]
"""
import json, os, sys

sys.path.insert(0, "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/pkv2tools")
from dbq import q  # noqa: E402

HEAD, CHILD = "2058819647368241153", "2058820005398224897"
COLS = "CAST(id AS CHAR) id, CAST(workflow_id AS CHAR) wf, tenant_id, status, run_time, current_node_id, error_msg, request_json_data, response_json_data, nodes_data"


def main():
    out = sys.argv[1]
    env = sys.argv[sys.argv.index("--env") + 1] if "--env" in sys.argv else "--dev"
    ids = sys.argv[sys.argv.index("--ids") + 1].split(",") if "--ids" in sys.argv else None
    assert all(i.isdigit() for i in ids or [])
    os.makedirs(out, exist_ok=True)
    where = f"id IN ({','.join(ids)})" if ids else "id > 2090000000000000000"
    heads = q(env, f"SELECT {COLS} FROM su_code_workflow_inst WHERE workflow_id = {HEAD} AND {where} ORDER BY id")
    for h in heads:
        req = json.loads(h["request_json_data"] or "{}")
        params = req.get("request_json") or req.get("workflowparams") or {}
        gd = params.get("allData") or {}
        lo, hi = int(h["id"]), int(h["id"]) + ((int(h["run_time"] or 0) + 3000) << 22)
        kids = q(env, f"SELECT {COLS} FROM su_code_workflow_inst WHERE workflow_id = {CHILD} AND id BETWEEN {lo} AND {hi} AND tenant_id = '{h['tenant_id']}' ORDER BY id")
        child = next((k for k in kids if str(gd.get("id") or "") in (k["request_json_data"] or "")), None)
        fx = {"tenant_id": h["tenant_id"], "gd_no": gd.get("delivery_no"), "gd_id": str(gd.get("id") or ""), "head": h, "child": child}
        json.dump(fx, open(os.path.join(out, h["id"] + ".json"), "w"))
        lines = sum(1 + len(r.get("children") or []) for r in gd.get("table_gd") or [])
        print(f"{h['id']} {h['tenant_id']} {fx['gd_no']} lines={lines} status={h['status']} exit={h['current_node_id']} child={'Y' if child else '-'}")


if __name__ == "__main__":
    main()
