"""The GLOBAL_ALLOCATION runs a recorded save made (its auto-allocation loop: one child run per line), added to the
fixture as "alloc" (id order = loop order). Read-only; fixtures stay in the session scratchpad.

usage: python3 fetch_alloc.py <fixture.json> [...]
"""
import json, sys

sys.path.insert(0, "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/pkv2tools")
from dbq import q  # noqa: E402

GLOBAL_ALLOCATION = "2032298961937842178"
COLS = "CAST(id AS CHAR) id, CAST(workflow_id AS CHAR) wf, tenant_id, status, run_time, current_node_id, error_msg, request_json_data, response_json_data, nodes_data"

for path in sys.argv[1:]:
    fx = json.load(open(path))
    h = fx["head"]
    lo, hi = int(h["id"]), int(h["id"]) + ((int(h["run_time"] or 0) + 3000) << 22)
    assert str(h["tenant_id"]).isdigit()
    kids = q("--dev", f"SELECT {COLS} FROM su_code_workflow_inst WHERE workflow_id = {GLOBAL_ALLOCATION} AND id BETWEEN {lo} AND {hi}"
                      f" AND tenant_id = '{h['tenant_id']}' ORDER BY id")
    fx["alloc"] = kids
    # Get Batch No (search_node_xc9mUWL8) runs inside the loop and is not in the trace: the batch numbers of the batches the
    # allocations name (a batch number never changes), read now
    bids = set()
    for k in kids:
        for x in json.loads(k["nodes_data"] or "[]"):
            if x.get("node_id") == "code_node_hDa6pSw5":
                for a in (json.loads(x.get("response_json_data") or "{}").get("data") or {}).get("allocationData") or []:
                    if str(a.get("batch_id") or "").isdigit():
                        bids.add(str(a["batch_id"]))
    fx["batches"] = q("--dev", "SELECT CAST(id AS CHAR) id, batch_number FROM batch WHERE id IN (%s)" % ",".join(sorted(bids))) if bids else []
    json.dump(fx, open(path, "w"))
    print(f"{h['id']} {fx['doc_no']}: {len(kids)} GLOBAL_ALLOCATION run(s)")
