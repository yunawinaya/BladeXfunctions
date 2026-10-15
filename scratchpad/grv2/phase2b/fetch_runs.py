"""Fetch recorded GR_CREATED / GR_CANCEL_CREATED runs (dev + prod, read-only) into the private fixture folder.
Usage: python3 fetch_runs.py   -> <FIX>/<env>_<workflow>.jsonl (one run per line: id, status, exit, create_time, nodes)"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from dbq import q  # noqa: E402

FIX = "/private/tmp/claude-501/-Users-yunawinaya-Developer-BladeXfunctions/3184bace-c1a2-43fd-9910-40a12d531785/scratchpad/phase2b"
WFS = {"GR_CREATED": 2065278999991267329, "GR_CANCEL_CREATED": 2075037036529123329}


def fetch(env, name, wid):
    ids = [r["id"] for r in q(env, "SELECT CAST(id AS CHAR) AS id FROM su_code_workflow_inst WHERE workflow_id=%d ORDER BY id" % wid)]
    out = os.path.join(FIX, "%s_%s.jsonl" % (env.strip("-"), name))
    with open(out, "w") as f:
        for i in range(0, len(ids), 20):
            chunk = ",".join(ids[i:i + 20])
            rows = q(env, "SELECT CAST(id AS CHAR) AS id, status, current_node_id AS exit_node, CAST(create_time AS CHAR) AS t, "
                          "nodes_data, request_json_data AS req, response_json_data AS resp FROM su_code_workflow_inst WHERE id IN (%s) ORDER BY id" % chunk)
            for r in rows:
                nd = r.pop("nodes_data")
                try:
                    r["nodes"] = json.loads(nd) if isinstance(nd, str) else nd
                except ValueError:
                    r["nodes"] = None
                for k in ("req", "resp"):
                    try:
                        r[k] = json.loads(r[k]) if isinstance(r[k], str) else r[k]
                    except ValueError:
                        pass
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(env, name, len(ids), "runs ->", out)


if __name__ == "__main__":
    os.makedirs(FIX, exist_ok=True)
    for env in ("--dev", "--prod"):
        for name, wid in WFS.items():
            fetch(env, name, wid)
