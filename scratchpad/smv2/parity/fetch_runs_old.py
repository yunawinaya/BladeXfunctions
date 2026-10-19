"""Pull recorded classic ADD_INVENTORY / SUBTRACT_INVENTORY runs of one transaction_type (read-only) into JSONL for replay_old.js.
Copied from scratchpad/grv2/parity/fetch_runs_old.py; LOT changes: default window = the whole prod run log (2026-09-17 on),
itemData slimmed to the fields the engine's item adapter reads (the fixture would otherwise carry each item master twice).

usage: python3 fetch_runs_old.py <--prod|--dev> <ADD|SUBTRACT> <TRANSACTION_TYPE> <out.jsonl> [--since YYYY-MM-DD[THH:MM]] [--until YYYY-MM-DD[THH:MM]] [--scan N]
  TRANSACTION_TYPE is matched exactly in request_json_data ("LOT"). Only SM_LOCATION_TRANSFER passes "LOT" (prod + dev enabled
  workflows checked 2026-10-16).
  --since is a MYT time turned into a snowflake id bound (su_code_workflow_inst is filtered by workflow_id + id only);
  ADD_INVENTORY v65 / SUBTRACT_INVENTORY v58 are enabled since 2026-09-18 15:50 MYT on prod, but prod kept running the
  previous code until 2026-09-22 18:12: each run records the code it ran ("code": v65 | pre-v65).
Fixtures hold customer data: write them to the session scratchpad, never into the repo.
"""
import datetime, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dbq import q  # noqa: E402

WF = {"ADD": "2012005532688723970", "SUBTRACT": "2012096660219564034"}  # ADD_INVENTORY v65 / SUBTRACT_INVENTORY v58
EPOCH = 1288834974657
Q8 = "const q8 = (v) => Number((parseFloat(v) || 0).toFixed(8))"
ITEM_KEYS = ("id", "material_code", "stock_control", "based_uom", "material_costing_method", "purchase_unit_price", "item_batch_management", "table_uom_conversion")
ITEM_NODES = ("code_node_TC1cqaOy", "code_node_3XzQSsce")  # SUBTRACT / ADD "ItemData"


def ids_as_text(v):
    if isinstance(v, dict):
        return {k: ids_as_text(x) for k, x in v.items()}
    if isinstance(v, list):
        return [ids_as_text(x) for x in v]
    if isinstance(v, int) and not isinstance(v, bool) and abs(v) > 2 ** 53:
        return str(v)
    return v


def slim(it):
    if not isinstance(it, dict):
        return it
    return {k: it[k] for k in ITEM_KEYS if k in it}


def main():
    env, kind, ttype, out = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
    since = sys.argv[sys.argv.index("--since") + 1] if "--since" in sys.argv else "2026-09-17"
    until = sys.argv[sys.argv.index("--until") + 1] if "--until" in sys.argv else None
    scan = int(sys.argv[sys.argv.index("--scan") + 1]) if "--scan" in sys.argv else 400
    if env not in ("--prod", "--dev") or kind not in WF or not re.fullmatch(r"[A-Za-z0-9 _-]{1,20}", ttype):
        raise SystemExit(__doc__)

    def to_id(text):
        at = datetime.datetime.fromisoformat(text).replace(tzinfo=datetime.timezone(datetime.timedelta(hours=8)))
        return (int(at.timestamp() * 1000) - EPOCH) << 22

    bound = to_id(since)
    like = '%"transaction_type":"' + ttype + '"%'
    wf_id = WF[kind]
    scanned = got = 0
    cursor = to_id(until) if until else None
    with open(out, "w") as fh:
        while True:
            upper = f"AND id < {cursor}" if cursor else ""
            ids = [r["id"] for r in q(env, f"SELECT CAST(id AS CHAR) id FROM su_code_workflow_inst WHERE workflow_id={wf_id} AND id >= {bound} {upper} ORDER BY id DESC LIMIT {scan}")]
            if not ids:
                break
            scanned += len(ids)
            for i in range(0, len(ids), 50):
                part = ids[i:i + 50]
                rows = q(env, "SELECT CAST(id AS CHAR) id, tenant_id, status, current_node_id, error_msg, request_json_data, nodes_data FROM su_code_workflow_inst "
                         "WHERE workflow_id=" + wf_id + " AND id IN (" + ",".join(part) + ") AND request_json_data LIKE '" + like + "'")
                for r in rows:
                    try:
                        params = json.loads(r["request_json_data"]).get("workflowparams") or {}
                        raw_nodes = json.loads(r["nodes_data"] or "[]")
                    except (ValueError, TypeError):
                        continue
                    if "itemData" in params:
                        params["itemData"] = slim(params["itemData"])
                    nodes, order = {}, []
                    t1 = 0
                    code_seen = set()
                    for n in raw_nodes:
                        t1 = max(t1, int(n.get("end_time_millis") or 0))
                        nid = n.get("node_id")
                        if not nid:
                            continue  # a failed run's last entry
                        if n.get("node_type") == "code-node":
                            # the code that actually ran: v65 / v58 round with q8; the versions before used toFixed(4) / toFixed(3)
                            src = n.get("request_json_data") or ""
                            if Q8 in src:
                                code_seen.add("v65")
                            if "toFixed(4)" in src or "toFixed(3)" in src:
                                code_seen.add("pre-v65")
                        try:
                            resp = json.loads(n.get("response_json_data") or "null")
                        except ValueError:
                            resp = None
                        if nid in ITEM_NODES and isinstance(resp, dict) and isinstance(resp.get("data"), dict) and "itemData" in resp["data"]:
                            resp["data"]["itemData"] = slim(resp["data"]["itemData"])
                        order.append(nid)
                        nodes[nid] = {"type": n.get("node_type"), "status": n.get("status"), "cut": bool(n.get("response_is_writer_file")), "resp": resp}
                    t0 = (int(r["id"]) >> 22) + EPOCH  # run start (snowflake), t1 = last node end: the window its rows were written in
                    rec = {"id": r["id"], "env": env[2:], "tenant": r["tenant_id"], "status": r["status"], "exit": r["current_node_id"],
                           "error": (r.get("error_msg") or "")[:300], "t0": t0, "t1": t1 or t0,
                           "code": "pre-v65" if "pre-v65" in code_seen else "v65" if code_seen else "unknown", "params": params, "order": order, "nodes": nodes}
                    fh.write(json.dumps(ids_as_text(rec), ensure_ascii=False) + "\n")
                    got += 1
            cursor = ids[-1]
    print(f"{env} {kind} {ttype}: scanned {scanned} runs since {since}" + (f" until {until}" if until else "") + f", kept {got} -> {out}")


if __name__ == "__main__":
    main()
