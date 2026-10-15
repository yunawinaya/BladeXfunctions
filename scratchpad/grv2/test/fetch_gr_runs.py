"""Pull recorded GOODS_RECEIVING "Save as Completed" runs (read-only) with the ADD_INVENTORY and GENERATE_BATCH runs
each one made, into JSONL fixtures for the PREPARE parity harnesses.

usage: python3 fetch_gr_runs.py <--prod|--dev> <out.jsonl> [--scan N] [--max N] [--since-id ID]
  Scans the newest N GOODS_RECEIVING runs (filtered by workflow_id + id only, as prod's statement timeout requires),
  keeps the ones whose request says saveAs "Completed", and for each kept run reads the child runs made between its
  start and end: ADD_INVENTORY (trx_no = the GR's number, transaction_type GRN) and GENERATE_BATCH (organization).
Fixtures hold customer data: write them to the session scratchpad, never into the repo.
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from dbq import q as _q  # noqa: E402
import time  # noqa: E402


def q(env, sql, tries=4):
    # prod's VPN path drops now and then: retry a read a few times before giving up
    for n in range(tries):
        try:
            return _q(env, sql)
        except RuntimeError:
            if n == tries - 1:
                raise
            time.sleep(5 * (n + 1))

GR_WF = "2029090678383042562"
ADD_WF = "2012005532688723970"
GEN_WF = "2060178784435535873"
EPOCH = 1288834974657
BIG = re.compile(r'"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])')


def P(text):
    """JSON with every 16+ digit number read as its exact digit string (the platform's ids)."""
    if text is None or text == "":
        return None
    return json.loads(BIG.sub(lambda m: m.group(0) if m.group(0)[0] == '"' else '"' + m.group(0) + '"', text))


def node_map(nodes_data):
    out, order = {}, []
    for n in P(nodes_data) or []:
        nid = n.get("node_id")
        if not nid:
            continue
        rec = {"type": n.get("node_type"), "status": n.get("status"), "t0": n.get("start_time_millis"), "t1": n.get("end_time_millis"),
               "cut": bool(n.get("response_is_writer_file") or n.get("request_is_writer_file"))}
        try:
            rq = P(n.get("request_json_data"))
        except ValueError:
            rq = None
        if isinstance(rq, dict) and "code" in rq and n.get("node_type") == "code-node":
            rec["code"] = rq.get("code")
            rec["decl"] = [[r.get("name"), r.get("bsonType")] for r in (rq.get("responseConfig") or [])]
        else:
            rec["req"] = rq
        try:
            rec["resp"] = P(n.get("response_json_data"))
        except ValueError:
            rec["resp"] = None
        if nid in out:
            out[nid + "#" + str(len(order))] = rec
        else:
            out[nid] = rec
        order.append(nid)
    return out, order


def children(env, wf, lo, hi, like=None):
    ids = [r["id"] for r in q(env, f"SELECT CAST(id AS CHAR) id FROM su_code_workflow_inst WHERE workflow_id={wf} AND id BETWEEN {lo} AND {hi} ORDER BY id")]
    rows = []
    for i in range(0, len(ids), 40):
        part = ids[i:i + 40]
        cond = f" AND request_json_data LIKE '{like}'" if like else ""
        rows += q(env, "SELECT CAST(id AS CHAR) id, tenant_id, status, current_node_id, request_json_data, response_json_data, nodes_data FROM su_code_workflow_inst "
                       f"WHERE workflow_id={wf} AND id IN ({','.join(part)}){cond} ORDER BY id")
    out = []
    for r in rows:
        nodes, order = node_map(r["nodes_data"])
        rq = P(r["request_json_data"]) or {}
        out.append({"id": r["id"], "status": r["status"], "exit": r["current_node_id"], "params": rq.get("workflowparams") or {},
                    "resp": P(r["response_json_data"]), "nodes": nodes, "order": order})
    return out


def main():
    env, out = sys.argv[1], sys.argv[2]
    scan = int(sys.argv[sys.argv.index("--scan") + 1]) if "--scan" in sys.argv else 300
    cap = int(sys.argv[sys.argv.index("--max") + 1]) if "--max" in sys.argv else 10 ** 9
    since = sys.argv[sys.argv.index("--since-id") + 1] if "--since-id" in sys.argv else "0"
    ids = [r["id"] for r in q(env, f"SELECT CAST(id AS CHAR) id FROM su_code_workflow_inst WHERE workflow_id={GR_WF} AND id > {since} ORDER BY id DESC LIMIT {scan}")]
    kept = 0
    tmp = out + ".part"
    with open(tmp, "w") as fh:
        for i in range(0, len(ids), 20):
            if kept >= cap:
                break
            part = ids[i:i + 20]
            rows = q(env, "SELECT CAST(id AS CHAR) id, tenant_id, status, current_node_id, start_date, end_date, error_msg, request_json_data, response_json_data, nodes_data "
                          f"FROM su_code_workflow_inst WHERE workflow_id={GR_WF} AND id IN ({','.join(part)}) AND request_json_data LIKE '%\"saveAs\":\"Completed\"%'")
            for r in rows:
                if kept >= cap:
                    break
                rq = P(r["request_json_data"]) or {}
                nodes, order = node_map(r["nodes_data"])
                t0 = int(r["start_date"] or ((int(r["id"]) >> 22) + EPOCH))
                t1 = int(r["end_date"] or t0)
                lo = int(r["id"])
                hi = (t1 + 3000 - EPOCH) << 22
                # the number the GR was stored with (code_node_UQWzCg37 answers "issued" when a Created GR still says
                # previous_status Draft): the Edit read-back, else the Add node's row
                rb = ((nodes.get("get_node_UeM3HpzR") or {}).get("resp") or {}).get("data") or {}
                rb = rb.get("data") if isinstance(rb, dict) else None
                ad = ((nodes.get("add_node_nGMSu41b") or {}).get("resp") or {}).get("data")
                ad = ad[0] if isinstance(ad, list) and ad else None
                grno = (rb or {}).get("gr_no") or (ad or {}).get("gr_no") or ((nodes.get("code_node_UQWzCg37") or {}).get("resp") or {}).get("data", {}).get("gr_no")
                org = (rq.get("workflowparams") or {}).get("allData", {}).get("organization_id")
                adds, gens = [], []
                if grno and re.fullmatch(r"[A-Za-z0-9/_.\- ]{1,60}", grno):
                    adds = children(env, ADD_WF, lo, hi, '%"trx_no":"' + grno + '"%')
                if org and re.fullmatch(r"[0-9]{1,20}", str(org)) and "get_cache_node_BGARRfinal" in nodes:
                    gens = children(env, GEN_WF, lo, hi, '%"organization_id":"' + str(org) + '"%')
                rec = {"id": r["id"], "env": env[2:], "tenant": r["tenant_id"], "status": r["status"], "exit": r["current_node_id"],
                       "error": (r.get("error_msg") or "")[:500], "t0": t0, "t1": t1, "params": rq.get("workflowparams") or {},
                       "resp": P(r["response_json_data"]), "nodes": nodes, "order": order, "adds": adds, "gens": gens}
                fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
                kept += 1
    os.replace(tmp, out)
    print(f"{env}: scanned {len(ids)} GOODS_RECEIVING runs, kept {kept} Completed -> {out}")


if __name__ == "__main__":
    main()
