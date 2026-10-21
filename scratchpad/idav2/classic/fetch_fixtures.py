"""Re-pull the recorded dev IDA_SAVE runs test_v7.js replays (read-only: SELECT through .dbtools/db).
usage: python3 scratchpad/idav2/classic/fetch_fixtures.py
classic/fixture_paths.json names the runs (dev only: IDA has no prod tables). Each fixture keeps the run's request_json_data and the
raw response_json_data TEXT of the nodes the tests replay (19-digit ids stay exact: idaParseJ)."""
import sys
sys.dont_write_bytecode = True
import json  # noqa: E402
import os  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "lib"))
from dbq import q  # noqa: E402

PATHS = json.load(open(os.path.join(HERE, "fixture_paths.json"), encoding="utf-8"))
NODES = ["code_fillback", "code_required", "wf_check_required", "code_item_ids", "search_items", "search_batches", "code_validate", "code_precheck_prep",
         "code_batch_plan", "get_batches_final", "code_apply_batches", "add_ida", "code_persisted", "code_issue_prep", "search_movements", "code_cost_alloc",
         "code_hu_unloads", "code_item_txn", "code_doc_id", "return_ok"]


def pull(run, folder):
    row = q("--dev", "SELECT workflow_id, workflow_name, status, current_node_id, request_json_data, nodes_data FROM su_code_workflow_inst WHERE id = %s" % run)[0]
    assert row["workflow_name"] == "IDA_SAVE" and str(row["workflow_id"]) == "2107305535347552257", (run, row["workflow_name"])
    nodes = {n.get("node_id"): n for n in json.loads(row["nodes_data"] or "[]")}
    out = {"env": "dev", "run": run, "status": row["status"], "exit": row["current_node_id"], "request": row["request_json_data"],
           "nodes": {k: nodes[k].get("response_json_data") for k in NODES if k in nodes}}
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, run + ".json")
    open(path, "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    print("dev %s %s exit=%s nodes=%d -> %s" % (run, row["status"], row["current_node_id"], len(out["nodes"]), path))


for run in PATHS["dev_runs"]:
    pull(run, os.path.join(HERE, "fixtures"))
