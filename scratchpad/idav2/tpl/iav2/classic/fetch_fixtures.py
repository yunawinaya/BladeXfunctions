"""Re-pull the recorded classic IA_SAVE runs test_v12.js replays (read-only: SELECT through .dbtools/db).
usage: python3 scratchpad/iav2/classic/fetch_fixtures.py [--dev] [--prod]   (default: both)
classic/fixture_paths.json names the runs and the folders: DEV runs -> classic/fixtures/<run>.json; the PROD run (prod business
data) -> prod_dir OUTSIDE the repo (env IAV2_PROD_FIXTURES overrides), never into the working tree. Each fixture keeps the run's
request_json_data and the raw response_json_data TEXT of the nodes the tests replay (19-digit ids stay exact: iaParseJ)."""
import sys
sys.dont_write_bytecode = True
import json  # noqa: E402
import os  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "lib"))
from dbq import q  # noqa: E402

PATHS = json.load(open(os.path.join(HERE, "fixture_paths.json"), encoding="utf-8"))
PROD_DIR = os.environ.get("IAV2_PROD_FIXTURES") or PATHS["prod_dir"]
NODES = ["code_fillback", "code_required", "wf_check_required", "code_item_ids", "search_items", "code_validate", "get_persisted_ia", "code_idem_guard",
         "code_batch_decide", "code_batch_number", "code_persisted", "search_movements", "code_receipt_prep", "code_item_txn", "code_hu_unloads", "return_ok"]


def pull(env, run, folder):
    row = q(env, "SELECT workflow_id, workflow_name, status, current_node_id, request_json_data, nodes_data FROM su_code_workflow_inst WHERE id = %s" % run)[0]
    assert row["workflow_name"] == "IA_SAVE" and str(row["workflow_id"]) == "2098335576774463489", (run, row["workflow_name"])
    nodes = {n.get("node_id"): n for n in json.loads(row["nodes_data"] or "[]")}
    out = {"env": env.strip("-"), "run": run, "status": row["status"], "exit": row["current_node_id"], "request": row["request_json_data"],
           "nodes": {k: nodes[k].get("response_json_data") for k in NODES if k in nodes}}
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, run + ".json")
    open(path, "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    print("%s %s %s exit=%s -> %s" % (env, run, row["status"], row["current_node_id"], path))


want = [a for a in sys.argv[1:] if a in ("--dev", "--prod")] or ["--dev", "--prod"]
if "--prod" in want:
    assert not os.path.abspath(PROD_DIR).startswith(REPO + os.sep), "the prod fixtures must live outside the repo: " + PROD_DIR
    for run in PATHS["prod_runs"]:
        pull("--prod", run, PROD_DIR)
if "--dev" in want:
    for run in PATHS["dev_runs"]:
        pull("--dev", run, os.path.join(HERE, "fixtures"))
