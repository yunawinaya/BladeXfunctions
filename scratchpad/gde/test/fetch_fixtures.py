"""Recorded dev GOODS_DELIVERY runs of an Edit + Save as Created from the form or SO_CASCADE (not PICKING's isPicking
re-saves), each with the GD_UNUSED_FN_NEW calls it made (pre-flight checkOnly + the real one) and its REORDER_SET_REDIS
call, as one fixture JSON per run. Fixtures hold tenant data: they go to the session scratchpad, never the repo.

usage: python3 fetch_fixtures.py <out_dir> [--after <instance id>] [--env --dev|--prod] [--ids id,id]
"""
import json, os, sys

sys.path.insert(0, "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/pkv2tools")
from dbq import q  # noqa: E402

GOODS_DELIVERY, UNUSED, REORDER = "2017151544868491265", "2032273338771128322", "2065256261729759233"
COLS = "CAST(id AS CHAR) id, CAST(workflow_id AS CHAR) wf, tenant_id, status, run_time, current_node_id, error_msg, request_json_data, response_json_data, nodes_data"


def window(head):
    # children start after the head and end before it does: a snowflake id bound on the PK (epoch-relative ms << 22)
    return int(head["id"]), int(head["id"]) + ((int(head["run_time"] or 0) + 3000) << 22)


def main():
    out = sys.argv[1]
    env = sys.argv[sys.argv.index("--env") + 1] if "--env" in sys.argv else "--dev"
    after = sys.argv[sys.argv.index("--after") + 1] if "--after" in sys.argv else "2096000000000000000"
    ids = sys.argv[sys.argv.index("--ids") + 1].split(",") if "--ids" in sys.argv else None
    assert after.isdigit() and all(i.isdigit() for i in ids or [])
    os.makedirs(out, exist_ok=True)
    where = f"id IN ({','.join(ids)})" if ids else (
        f"id > {after} AND request_json_data LIKE '%\"pageStatus\":\"Edit\"%' AND request_json_data LIKE '%\"saveAs\":\"Created\"%'"
        " AND request_json_data NOT LIKE '%\"isPicking\":\"Yes\"%'")
    heads = q(env, f"SELECT {COLS} FROM su_code_workflow_inst WHERE workflow_id = {GOODS_DELIVERY} AND {where} ORDER BY id")
    for h in heads:
        params = json.loads(h["request_json_data"]).get("workflowparams") or {}
        gd = params.get("allData") or {}
        gd_id = str(gd.get("id") or "")
        lo, hi = window(h)
        kids = q(env, f"SELECT {COLS} FROM su_code_workflow_inst WHERE workflow_id IN ({UNUSED}, {REORDER}) AND id BETWEEN {lo} AND {hi}"
                      f" AND tenant_id = '{h['tenant_id']}' ORDER BY id")
        fx = {"tenant_id": h["tenant_id"], "doc_no": gd.get("delivery_no"), "gd_id": gd_id, "stored_status": gd.get("gd_status"),
              "head": h, "unused": None, "preflight": None, "reorder": None}
        for k in kids:
            kp = json.loads(k["request_json_data"]).get("workflowparams") or {}
            # REORDER_SET_REDIS gets line arrays, not the GD id: inside the head's window it is the head's own call
            if k["wf"] == REORDER:
                fx["reorder"] = fx["reorder"] or k
                continue
            if k["request_json_data"].find(gd_id) < 0 and str(kp.get("doc_id") or "") != gd_id:
                continue
            if str(kp.get("checkOnly") or "") == "1":
                fx["preflight"] = fx["preflight"] or k
            else:
                fx["unused"] = fx["unused"] or k
        path = os.path.join(out, h["id"] + ".json")
        json.dump(fx, open(path, "w"))
        lines = sum(1 + len(r.get("children") or []) for r in gd.get("table_gd") or [])
        print(f"{h['id']} {h['tenant_id']} {fx['doc_no']} stored={fx['stored_status']} lines={lines} status={h['status']} "
              f"unused={'Y' if fx['unused'] else '-'} preflight={'Y' if fx['preflight'] else '-'} reorder={'Y' if fx['reorder'] else '-'}")


if __name__ == "__main__":
    main()
