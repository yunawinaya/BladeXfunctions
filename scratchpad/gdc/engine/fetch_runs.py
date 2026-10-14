"""Pull recorded SUBTRACT_INVENTORY_NEW / ADD_INVENTORY_NEW runs (read-only) into JSONL fixtures for replay.js.

usage: python3 fetch_runs.py <--prod|--dev> <SUBTRACT|ADD> <count> <out.jsonl> [--before <instance id>] [--like <text>] [--scan <ids>]
Fixtures hold customer data: write them to the session scratchpad, never into the repo.
"""
import json, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pkv2tools"))
from dbq import q  # noqa: E402

WF = {"SUBTRACT": "SUBTRACT_INVENTORY_NEW", "ADD": "ADD_INVENTORY_NEW"}
KEEP = {
    "SUBTRACT": ["code_node_TC1cqaOy", "code_node_wBfvXM2G", "get_node_uaq6Z1ej", "get_node_GjRiq3dT", "code_node_DUBS9GZF",
                 "search_node_NCi8U4My", "search_node_7bvv7f8g", "code_node_BnKFTznr", "code_node_7l9u4Zca", "code_node_XQVptQ8K",
                 "code_node_mQnskse9", "code_node_XLW4aVTn", "code_node_fVEv7HuP", "code_node_YqMfJIMz", "code_node_oz7GGSQA",
                 "get_node_ZGsF9gxG"],
    "ADD": ["code_node_3XzQSsce", "code_node_mvszWJ8p", "code_node_3SC3WFhc", "code_node_BDhmDHrJ", "code_node_BzebhJnQ",
            "code_node_GMSJTmJr", "code_node_aFO7peip", "get_node_kePN6D3V", "code_node_IohK2kdK", "get_node_dzqHveJM",
            "code_node_fhf8Pn2f", "search_node_lPUQktoS", "code_node_wFHVEysj", "search_node_EhZwGMYs", "code_node_BmARJUfl",
            "get_node_MuNnpfmj"],
}


def ids_as_text(v):
    if isinstance(v, dict):
        return {k: ids_as_text(x) for k, x in v.items()}
    if isinstance(v, list):
        return [ids_as_text(x) for x in v]
    if isinstance(v, int) and not isinstance(v, bool) and abs(v) > 2 ** 53:
        return str(v)
    return v


def main():
    env, kind, count, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
    before = sys.argv[sys.argv.index("--before") + 1] if "--before" in sys.argv else None
    like = sys.argv[sys.argv.index("--like") + 1] if "--like" in sys.argv else None
    scan = int(sys.argv[sys.argv.index("--scan") + 1]) if "--scan" in sys.argv else 100
    if like and not all(ch.isalnum() or ch in " _-" for ch in like):
        raise SystemExit("--like takes letters, digits, space, _ and - only")
    wf_id = q(env, f"SELECT CAST(id AS CHAR) id FROM su_code_workflow WHERE name='{WF[kind]}' AND is_deleted=0 LIMIT 1")[0]["id"]
    got = 0
    cursor = before
    with open(out, "w") as fh:
        while got < count:
            bound = f"AND id < {cursor}" if cursor else ""
            ids = [r["id"] for r in q(env, f"SELECT CAST(id AS CHAR) id FROM su_code_workflow_inst WHERE workflow_id={wf_id} {bound} ORDER BY id DESC LIMIT {scan}")]
            if not ids:
                break
            rows = q(env, "SELECT CAST(id AS CHAR) id, tenant_id, status, current_node_id, request_json_data, nodes_data FROM su_code_workflow_inst WHERE id IN (" + ",".join(ids) + ")" + (f" AND request_json_data LIKE '%{like}%'" if like else ""))
            for r in rows:
                try:
                    params = json.loads(r["request_json_data"]).get("workflowparams") or {}
                    nodes = {}
                    for n in json.loads(r["nodes_data"] or "[]"):
                        if n.get("node_id") in KEEP[kind]:
                            try:
                                nodes[n["node_id"]] = json.loads(n.get("response_json_data") or "null")
                            except ValueError:
                                nodes[n["node_id"]] = None
                except (ValueError, TypeError):
                    continue
                rec = {"id": r["id"], "tenant": r["tenant_id"], "status": r["status"], "exit": r["current_node_id"], "params": params, "nodes": nodes}
                fh.write(json.dumps(ids_as_text(rec), ensure_ascii=False) + "\n")
                got += 1
            cursor = ids[-1]
    print(f"{got} {kind} runs from {env} -> {out}")


if __name__ == "__main__":
    main()
